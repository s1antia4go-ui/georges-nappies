from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import uploads
from ..config import get_settings
from ..db import get_db
from ..deps import current_user
from ..models import Block, Conversation, ConversationMember, Favorite, FriendRequest, Friendship, Report, User
from ..realtime import hub
from ..schemas import PreferencesIn, PrivacyIn, ProfileIn, ReportIn, StatusIn
from ..security import limiter
from ..serialize import are_friends, pair, related_user_ids, user_me, user_public

router = APIRouter(prefix="/api", tags=["users"])


async def broadcast_user(db: AsyncSession, user: User) -> None:
    await hub.send_to_users(await related_user_ids(db, user.id), {"type": "user.updated", "user": user_public(user)})


async def broadcast_presence(db: AsyncSession, user: User) -> None:
    await hub.send_to_users(
        await related_user_ids(db, user.id),
        {"type": "presence", "user_id": user.id, "presence": hub.presence(user.id, user.status, user.show_presence),
         "last_seen_at": user.last_seen_at.isoformat() if user.last_seen_at and user.show_presence and user.status != "invisible" else None},
    )


@router.patch("/me/profile")
async def update_profile(body: ProfileIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(user, field, value)
    await db.commit()
    await db.refresh(user)
    await broadcast_user(db, user)
    return {"user": user_me(user)}


@router.put("/me/status")
async def set_status(body: StatusIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    user.status = body.status
    await db.commit()
    await db.refresh(user)
    if hub.is_connected(user.id):
        hub.status[user.id] = (user.status, user.show_presence)
    await broadcast_presence(db, user)
    return {"user": user_me(user)}


@router.patch("/me/privacy")
async def update_privacy(body: PrivacyIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(user, field, value)
    await db.commit()
    await db.refresh(user)
    if hub.is_connected(user.id):
        hub.status[user.id] = (user.status, user.show_presence)
    await broadcast_presence(db, user)
    return {"user": user_me(user)}


@router.patch("/me/preferences")
async def update_preferences(body: PreferencesIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    prefs = dict(user.preferences or {})
    prefs.update(body.model_dump(exclude_none=True))
    user.preferences = prefs
    await db.commit()
    await db.refresh(user)
    return {"user": user_me(user)}


async def _image_upload(user: User, db: AsyncSession, file: UploadFile, kind: str) -> dict:
    limiter.check(f"upload:{user.id}", 20, 600)
    data = await uploads.read_limited(file, get_settings().max_image_bytes)
    max_side = 512 if kind == "avatars" else 1500
    blob, _mime, ext, _w, _h = uploads.process_image(data, max_side)
    path = await uploads.save(kind, blob, ext)
    attr = "avatar_path" if kind == "avatars" else "banner_path"
    old = getattr(user, attr)
    setattr(user, attr, path)
    await db.commit()
    await db.refresh(user)
    await uploads.remove(old)
    await broadcast_user(db, user)
    return {"user": user_me(user)}


@router.post("/me/avatar")
async def upload_avatar(file: UploadFile = File(...), user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await _image_upload(user, db, file, "avatars")


@router.post("/me/banner")
async def upload_banner(file: UploadFile = File(...), user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await _image_upload(user, db, file, "banners")


@router.delete("/me/images/{kind}")
async def remove_image(kind: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if kind not in ("avatar", "banner"):
        raise HTTPException(404, "Not found.")
    attr = f"{kind}_path"
    old = getattr(user, attr)
    setattr(user, attr, None)
    await db.commit()
    await db.refresh(user)
    await uploads.remove(old)
    await broadcast_user(db, user)
    return {"user": user_me(user)}


@router.get("/media/{kind}/{name}")
async def media(kind: str, name: str, user: User = Depends(current_user)):
    """Profile pictures, banners and group icons. Signed-in users only."""
    if kind not in ("avatars", "banners", "groups"):
        raise HTTPException(404, "Not found.")
    data, content_type = await uploads.read(f"{kind}/{name}")
    return Response(data, media_type=content_type, headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"})


async def _blocked_by(db: AsyncSession, blocker: int, blocked: int) -> bool:
    return (await db.get(Block, (blocker, blocked))) is not None


@router.get("/users/{user_id}")
async def get_profile(user_id: int, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    other = await db.get(User, user_id)
    if not other or (other.id != me.id and await _blocked_by(db, other.id, me.id)):
        raise HTTPException(404, "User not found.")
    relationship = "self"
    if other.id != me.id:
        if await _blocked_by(db, me.id, other.id):
            relationship = "blocked"
        elif await are_friends(db, me.id, other.id):
            relationship = "friend"
        else:
            req = (
                await db.execute(
                    select(FriendRequest).where(
                        FriendRequest.status == "pending",
                        or_(
                            and_(FriendRequest.from_user_id == me.id, FriendRequest.to_user_id == other.id),
                            and_(FriendRequest.from_user_id == other.id, FriendRequest.to_user_id == me.id),
                        ),
                    )
                )
            ).scalar_one_or_none()
            relationship = "none" if not req else ("outgoing" if req.from_user_id == me.id else "incoming")

    # Mutual group conversations.
    mine = select(ConversationMember.conversation_id).where(ConversationMember.user_id == me.id)
    mutual = (
        await db.execute(
            select(Conversation)
            .join(ConversationMember, ConversationMember.conversation_id == Conversation.id)
            .where(Conversation.kind == "group", ConversationMember.user_id == other.id, Conversation.id.in_(mine))
        )
    ).scalars().all() if other.id != me.id else []
    fav = (await db.get(Favorite, (me.id, other.id))) is not None
    return {
        "user": user_public(other),
        "relationship": relationship,
        "favorite": fav,
        "mutual_groups": [{"id": c.id, "name": c.name} for c in mutual],
    }


@router.get("/users/search/exact")
async def search_exact(username: str, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Find one account by its exact username (case-insensitive). Respects privacy and blocks."""
    limiter.check(f"search:{me.id}", 30, 60)
    q = username.strip().lstrip("@")
    if not q or len(q) > 20:
        raise HTTPException(404, "No user with that username.")
    other = (await db.execute(select(User).where(func.lower(User.username) == q.lower()))).scalar_one_or_none()
    if not other or other.id == me.id:
        if other and other.id == me.id:
            raise HTTPException(400, "That's your own username.")
        raise HTTPException(404, "No user with that username.")
    if not other.discoverable or await _blocked_by(db, other.id, me.id):
        raise HTTPException(404, "No user with that username.")

    from ..models import SearchHistory
    from sqlalchemy.dialects.postgresql import insert

    await db.execute(
        insert(SearchHistory)
        .values(user_id=me.id, found_user_id=other.id)
        .on_conflict_do_update(index_elements=["user_id", "found_user_id"], set_={"searched_at": func.now()})
    )
    await db.commit()
    return await get_profile(other.id, me, db)


@router.get("/me/search-history")
async def search_history(me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    from ..models import SearchHistory

    rows = await db.execute(
        select(User)
        .join(SearchHistory, SearchHistory.found_user_id == User.id)
        .where(SearchHistory.user_id == me.id)
        .order_by(SearchHistory.searched_at.desc())
        .limit(10)
    )
    return {"users": [user_public(u) for u in rows.scalars()]}


@router.delete("/me/search-history")
async def clear_search_history(me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    from ..models import SearchHistory

    await db.execute(delete(SearchHistory).where(SearchHistory.user_id == me.id))
    await db.commit()
    return {"ok": True}


@router.post("/users/{user_id}/block")
async def block(user_id: int, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if user_id == me.id:
        raise HTTPException(400, "You can't block yourself.")
    if not await db.get(User, user_id):
        raise HTTPException(404, "User not found.")
    from sqlalchemy.dialects.postgresql import insert

    await db.execute(insert(Block).values(blocker_id=me.id, blocked_id=user_id).on_conflict_do_nothing())
    a, b = pair(me.id, user_id)
    await db.execute(delete(Friendship).where(Friendship.user_a == a, Friendship.user_b == b))
    await db.execute(delete(Favorite).where(or_(and_(Favorite.user_id == me.id, Favorite.friend_id == user_id), and_(Favorite.user_id == user_id, Favorite.friend_id == me.id))))
    await db.execute(
        FriendRequest.__table__.update()
        .where(
            FriendRequest.status == "pending",
            or_(
                and_(FriendRequest.from_user_id == me.id, FriendRequest.to_user_id == user_id),
                and_(FriendRequest.from_user_id == user_id, FriendRequest.to_user_id == me.id),
            ),
        )
        .values(status="cancelled", responded_at=func.now())
    )
    await db.commit()
    await hub.send_to_users([me.id, user_id], {"type": "friends.changed"})
    return {"ok": True}


@router.delete("/users/{user_id}/block")
async def unblock(user_id: int, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Block).where(Block.blocker_id == me.id, Block.blocked_id == user_id))
    await db.commit()
    await hub.send_to_users([me.id], {"type": "friends.changed"})
    return {"ok": True}


@router.get("/me/blocked")
async def blocked_list(me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = await db.execute(select(User).join(Block, Block.blocked_id == User.id).where(Block.blocker_id == me.id).order_by(User.username))
    return {"users": [user_public(u) for u in rows.scalars()]}


@router.post("/users/{user_id}/report", status_code=201)
async def report(user_id: int, body: ReportIn, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    limiter.check(f"report:{me.id}", 10, 3600)
    if user_id == me.id:
        raise HTTPException(400, "You can't report yourself.")
    if not await db.get(User, user_id):
        raise HTTPException(404, "User not found.")
    db.add(Report(reporter_id=me.id, reported_id=user_id, reason=body.reason, details=body.details.strip()))
    await db.commit()
    return {"ok": True, "message": "Thanks. Our team will review this report."}
