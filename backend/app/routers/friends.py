from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import current_user
from ..models import Block, Favorite, FriendRequest, Friendship, User
from ..realtime import hub
from ..schemas import FriendRequestIn
from ..security import limiter
from ..serialize import are_friends, is_blocked_either, pair, user_public

router = APIRouter(prefix="/api/friends", tags=["friends"])


def _request_json(r: FriendRequest, other: User) -> dict:
    return {"id": r.id, "from_user_id": r.from_user_id, "to_user_id": r.to_user_id, "created_at": r.created_at.isoformat(), "user": user_public(other)}


@router.get("")
async def list_friends(me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = await db.execute(
        select(User, Friendship.created_at)
        .join(Friendship, or_(and_(Friendship.user_a == me.id, Friendship.user_b == User.id), and_(Friendship.user_b == me.id, Friendship.user_a == User.id)))
        .order_by(func.lower(User.display_name))
    )
    favs = set((await db.execute(select(Favorite.friend_id).where(Favorite.user_id == me.id))).scalars().all())
    friends = [{**user_public(u), "friends_since": since.isoformat(), "favorite": u.id in favs} for u, since in rows.all()]

    incoming = await db.execute(
        select(FriendRequest, User).join(User, User.id == FriendRequest.from_user_id)
        .where(FriendRequest.to_user_id == me.id, FriendRequest.status == "pending").order_by(FriendRequest.created_at.desc())
    )
    outgoing = await db.execute(
        select(FriendRequest, User).join(User, User.id == FriendRequest.to_user_id)
        .where(FriendRequest.from_user_id == me.id, FriendRequest.status == "pending").order_by(FriendRequest.created_at.desc())
    )
    return {
        "friends": friends,
        "incoming": [_request_json(r, u) for r, u in incoming.all()],
        "outgoing": [_request_json(r, u) for r, u in outgoing.all()],
    }


@router.post("/requests", status_code=201)
async def send_request(body: FriendRequestIn, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    limiter.check(f"friendreq:{me.id}", 30, 3600)
    name = body.username.strip().lstrip("@").lower()
    other = (await db.execute(select(User).where(func.lower(User.username) == name))).scalar_one_or_none()
    if other and other.id == me.id:
        raise HTTPException(400, "You can't send a friend request to yourself.")
    if not other or not other.discoverable or (await db.get(Block, (other.id, me.id))):
        raise HTTPException(404, "No user with that username.")
    if await db.get(Block, (me.id, other.id)):
        raise HTTPException(400, "You've blocked this user. Unblock them first.")
    if not other.allow_requests:
        raise HTTPException(403, f"@{other.username} isn't accepting friend requests.")
    if await are_friends(db, me.id, other.id):
        raise HTTPException(409, f"You're already friends with @{other.username}.")

    pending = (
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
    if pending and pending.from_user_id == me.id:
        raise HTTPException(409, f"You've already sent @{other.username} a friend request.")
    if pending:
        # They already asked us: sending one back accepts theirs.
        return await accept(pending.id, me, db)

    req = FriendRequest(from_user_id=me.id, to_user_id=other.id)
    db.add(req)
    try:
        await db.commit()
    except IntegrityError:  # concurrent duplicate caught by the partial unique index
        await db.rollback()
        raise HTTPException(409, f"You've already sent @{other.username} a friend request.") from None
    await db.refresh(req)
    await hub.send_to_users([other.id], {"type": "friend.request", "request": _request_json(req, me)})
    await hub.send_to_users([me.id], {"type": "friends.changed"})
    return {"ok": True, "status": "sent", "message": f"Friend request sent to @{other.username}.", "request": _request_json(req, other)}


async def _get_pending(db: AsyncSession, request_id: int) -> FriendRequest:
    req = await db.get(FriendRequest, request_id, with_for_update=True)
    if not req or req.status != "pending":
        raise HTTPException(404, "That friend request no longer exists.")
    return req


@router.post("/requests/{request_id}/accept")
async def accept(request_id: int, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    req = await _get_pending(db, request_id)
    if req.to_user_id != me.id:
        raise HTTPException(404, "That friend request no longer exists.")
    if await is_blocked_either(db, req.from_user_id, req.to_user_id):
        raise HTTPException(400, "You can't add this user.")
    a, b = pair(req.from_user_id, req.to_user_id)
    req.status = "accepted"
    req.responded_at = func.now()
    # Request status and friendship row change together, in one transaction.
    await db.execute(insert(Friendship).values(user_a=a, user_b=b).on_conflict_do_nothing())
    await db.commit()
    sender = await db.get(User, req.from_user_id)
    await hub.send_to_users([req.from_user_id], {"type": "friend.accepted", "user": user_public(me)})
    await hub.send_to_users([req.from_user_id, me.id], {"type": "friends.changed"})
    return {"ok": True, "status": "accepted", "message": f"You're now friends with @{sender.username}.", "user": user_public(sender)}


@router.post("/requests/{request_id}/decline")
async def decline(request_id: int, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    req = await _get_pending(db, request_id)
    if req.to_user_id == me.id:
        req.status = "declined"
    elif req.from_user_id == me.id:
        req.status = "cancelled"
    else:
        raise HTTPException(404, "That friend request no longer exists.")
    req.responded_at = func.now()
    await db.commit()
    await hub.send_to_users([req.from_user_id, req.to_user_id], {"type": "friends.changed"})
    return {"ok": True}


@router.delete("/{user_id}")
async def remove_friend(user_id: int, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    a, b = pair(me.id, user_id)
    res = await db.execute(delete(Friendship).where(Friendship.user_a == a, Friendship.user_b == b))
    await db.execute(delete(Favorite).where(or_(and_(Favorite.user_id == me.id, Favorite.friend_id == user_id), and_(Favorite.user_id == user_id, Favorite.friend_id == me.id))))
    await db.commit()
    if res.rowcount == 0:
        raise HTTPException(404, "You aren't friends with this user.")
    await hub.send_to_users([me.id, user_id], {"type": "friends.changed"})
    return {"ok": True}


@router.put("/{user_id}/favorite")
async def favorite(user_id: int, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if not await are_friends(db, me.id, user_id):
        raise HTTPException(400, "Only friends can be favourites.")
    await db.execute(insert(Favorite).values(user_id=me.id, friend_id=user_id).on_conflict_do_nothing())
    await db.commit()
    return {"ok": True}


@router.delete("/{user_id}/favorite")
async def unfavorite(user_id: int, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Favorite).where(Favorite.user_id == me.id, Favorite.friend_id == user_id))
    await db.commit()
    return {"ok": True}
