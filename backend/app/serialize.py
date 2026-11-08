"""Turn ORM rows into JSON for the client, and shared relationship queries."""
from collections import defaultdict

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    Attachment,
    Block,
    Conversation,
    ConversationMember,
    Friendship,
    Message,
    Reaction,
    User,
)
from .realtime import hub


def media_url(path: str | None) -> str | None:
    return f"/api/media/{path}" if path else None


def user_public(u: User) -> dict:
    presence = hub.presence(u.id, u.status, u.show_presence)
    return {
        "id": u.id,
        "username": u.username,
        "display_name": u.display_name,
        "avatar_url": media_url(u.avatar_path),
        "banner_url": media_url(u.banner_path),
        "banner_color": u.banner_color,
        "accent_color": u.accent_color,
        "bio": u.bio,
        "created_at": u.created_at.isoformat(),
        "presence": presence,
        "last_seen_at": u.last_seen_at.isoformat() if (u.last_seen_at and u.show_presence and u.status != "invisible") else None,
    }


def user_me(u: User) -> dict:
    return {
        **user_public(u),
        "email": u.email,
        "status": u.status,
        "privacy": {
            "discoverable": u.discoverable,
            "send_read_receipts": u.send_read_receipts,
            "show_presence": u.show_presence,
            "allow_requests": u.allow_requests,
        },
        "preferences": u.preferences or {},
    }


def pair(a: int, b: int) -> tuple[int, int]:
    return (a, b) if a < b else (b, a)


async def are_friends(db: AsyncSession, a: int, b: int) -> bool:
    x, y = pair(a, b)
    return (await db.get(Friendship, (x, y))) is not None


async def is_blocked_either(db: AsyncSession, a: int, b: int) -> bool:
    q = select(Block).where(
        or_(and_(Block.blocker_id == a, Block.blocked_id == b), and_(Block.blocker_id == b, Block.blocked_id == a))
    )
    return (await db.execute(q)).first() is not None


async def related_user_ids(db: AsyncSession, user_id: int) -> set[int]:
    """Everyone who should hear about this user's presence/profile changes."""
    f = await db.execute(
        select(Friendship.user_a, Friendship.user_b).where(or_(Friendship.user_a == user_id, Friendship.user_b == user_id))
    )
    ids = {a if b == user_id else b for a, b in f.all()}
    mine = select(ConversationMember.conversation_id).where(ConversationMember.user_id == user_id)
    m = await db.execute(select(ConversationMember.user_id).where(ConversationMember.conversation_id.in_(mine)).distinct())
    ids.update(m.scalars().all())
    ids.discard(user_id)
    return ids


async def member_ids(db: AsyncSession, conversation_id: int) -> list[int]:
    r = await db.execute(select(ConversationMember.user_id).where(ConversationMember.conversation_id == conversation_id))
    return list(r.scalars().all())


def attachment_json(a: Attachment | None) -> dict | None:
    if not a:
        return None
    return {
        "id": a.id,
        "name": a.original_name,
        "mime": a.mime,
        "size": a.size,
        "width": a.width,
        "height": a.height,
        "url": f"/api/attachments/{a.id}",
        "is_image": a.mime.startswith("image/"),
    }


async def messages_json(db: AsyncSession, msgs: list[Message]) -> list[dict]:
    if not msgs:
        return []
    ids = [m.id for m in msgs]
    reactions: dict[int, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    for r in (await db.execute(select(Reaction).where(Reaction.message_id.in_(ids)).order_by(Reaction.created_at))).scalars():
        reactions[r.message_id][r.emoji].append(r.user_id)

    reply_ids = {m.reply_to_id for m in msgs if m.reply_to_id}
    replies = {}
    if reply_ids:
        for r in (await db.execute(select(Message).where(Message.id.in_(reply_ids)))).scalars():
            replies[r.id] = r

    att_ids = {m.attachment_id for m in msgs if m.attachment_id}
    atts = {}
    if att_ids:
        for a in (await db.execute(select(Attachment).where(Attachment.id.in_(att_ids)))).scalars():
            atts[a.id] = a

    out = []
    for m in msgs:
        deleted = m.deleted_at is not None
        rep = replies.get(m.reply_to_id) if m.reply_to_id else None
        out.append(
            {
                "id": m.id,
                "conversation_id": m.conversation_id,
                "sender_id": m.sender_id,
                "kind": m.kind,
                "body": "" if deleted else m.body,
                "forwarded": m.forwarded,
                "reply_to": (
                    {
                        "id": rep.id,
                        "sender_id": rep.sender_id,
                        "body": "" if rep.deleted_at else rep.body[:200],
                        "deleted": rep.deleted_at is not None,
                        "has_attachment": rep.attachment_id is not None,
                    }
                    if rep
                    else None
                ),
                "attachment": None if deleted else attachment_json(atts.get(m.attachment_id)),
                "created_at": m.created_at.isoformat(),
                "edited_at": m.edited_at.isoformat() if m.edited_at else None,
                "deleted": deleted,
                "pinned_at": m.pinned_at.isoformat() if m.pinned_at and not deleted else None,
                "reactions": [] if deleted else [{"emoji": e, "user_ids": u} for e, u in reactions[m.id].items()],
            }
        )
    return out


async def conversations_json(db: AsyncSession, viewer: User, conv_ids: list[int] | None = None) -> list[dict]:
    """All of the viewer's conversations (or a subset) with members, last message and unread count."""
    q = (
        select(Conversation, ConversationMember)
        .join(ConversationMember, ConversationMember.conversation_id == Conversation.id)
        .where(ConversationMember.user_id == viewer.id)
    )
    if conv_ids is not None:
        q = q.where(Conversation.id.in_(conv_ids))
    rows = (await db.execute(q.order_by(Conversation.last_message_at.desc()))).all()
    if not rows:
        return []
    ids = [c.id for c, _ in rows]

    members: dict[int, list[tuple[ConversationMember, User]]] = defaultdict(list)
    mrows = await db.execute(
        select(ConversationMember, User)
        .join(User, User.id == ConversationMember.user_id)
        .where(ConversationMember.conversation_id.in_(ids))
        .order_by(ConversationMember.joined_at)
    )
    for cm, u in mrows.all():
        members[cm.conversation_id].append((cm, u))

    # Latest visible message per conversation (one query, DISTINCT ON).
    mine = {c.id: me for c, me in rows}
    last_q = (
        select(Message)
        .join(
            ConversationMember,
            and_(ConversationMember.conversation_id == Message.conversation_id, ConversationMember.user_id == viewer.id),
        )
        .where(Message.conversation_id.in_(ids), Message.id >= ConversationMember.visible_from_id)
        .distinct(Message.conversation_id)
        .order_by(Message.conversation_id, Message.id.desc())
    )
    last_msgs = (await db.execute(last_q)).scalars().all()
    last_json = {m["conversation_id"]: m for m in await messages_json(db, list(last_msgs))}

    unread_q = (
        select(Message.conversation_id, func.count())
        .join(
            ConversationMember,
            and_(ConversationMember.conversation_id == Message.conversation_id, ConversationMember.user_id == viewer.id),
        )
        .where(
            Message.conversation_id.in_(ids),
            Message.id > ConversationMember.last_read_id,
            Message.id >= ConversationMember.visible_from_id,
            or_(Message.sender_id != viewer.id, Message.sender_id.is_(None)),
            Message.deleted_at.is_(None),
            Message.kind == "text",
        )
        .group_by(Message.conversation_id)
    )
    unread = dict((await db.execute(unread_q)).all())

    out = []
    for c, me in rows:
        out.append(
            {
                "id": c.id,
                "kind": c.kind,
                "name": c.name,
                "avatar_url": media_url(c.avatar_path),
                "created_by": c.created_by,
                "created_at": c.created_at.isoformat(),
                "last_message_at": c.last_message_at.isoformat(),
                "muted": me.muted,
                "my_role": me.role,
                "unread_count": unread.get(c.id, 0),
                "last_message": last_json.get(c.id),
                "members": [
                    {
                        **user_public(u),
                        "role": cm.role,
                        # Members who turned read receipts off don't reveal how far they've read.
                        "last_read_id": cm.last_read_id if (u.send_read_receipts or u.id == viewer.id) else None,
                        "last_delivered_id": cm.last_delivered_id,
                    }
                    for cm, u in members[c.id]
                ],
            }
        )
    return out


async def require_member(db: AsyncSession, conversation_id: int, user_id: int) -> ConversationMember:
    """Access control for every conversation endpoint: 404 (not 403) so ids can't be probed."""
    from fastapi import HTTPException

    cm = await db.get(ConversationMember, (conversation_id, user_id))
    if not cm:
        raise HTTPException(404, "Conversation not found.")
    return cm
