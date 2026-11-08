"""Conversations, messages, receipts, reactions, pins, attachments.

Access control: every endpoint resolves the caller's membership first (`require_member`), and
message endpoints load the message, then check membership of *its* conversation. Nobody can
read or act on a conversation they don't belong to.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from urllib.parse import quote

from fastapi.responses import Response
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import uploads
from ..config import get_settings
from ..db import get_db
from ..deps import current_user
from ..models import Attachment, Conversation, ConversationMember, Message, Reaction, User
from ..realtime import hub
from ..schemas import (
    AddMembersIn,
    DirectIn,
    ForwardIn,
    GroupIn,
    GroupUpdateIn,
    MessageEditIn,
    MessageIn,
    ReactionIn,
    ReadIn,
)
from ..security import limiter
from ..serialize import are_friends, conversations_json, is_blocked_either, member_ids, messages_json, require_member

router = APIRouter(prefix="/api", tags=["conversations"])


# ---------- helpers shared with the WebSocket endpoint ----------

async def push_conversation(db: AsyncSession, conv_id: int, user_ids, event_type: str = "conversation.updated") -> None:
    """Send each user their own view of a conversation (unread counts differ per person)."""
    for uid in set(user_ids):
        if not hub.is_connected(uid):
            continue
        viewer = await db.get(User, uid)
        if not viewer:
            continue
        data = await conversations_json(db, viewer, [conv_id])
        if data:
            await hub.send_to_users([uid], {"type": event_type, "conversation": data[0]})


async def mark_receipt(db: AsyncSession, user: User, conv_id: int, message_id: int, read: bool) -> None:
    """Advance a member's delivered (and optionally read) pointer and tell the others."""
    cm = await db.get(ConversationMember, (conv_id, user.id))
    if not cm:
        return
    latest = (await db.execute(select(func.max(Message.id)).where(Message.conversation_id == conv_id))).scalar() or 0
    message_id = min(message_id, latest)
    values = {"last_delivered_id": func.greatest(ConversationMember.last_delivered_id, message_id)}
    if read:
        values["last_read_id"] = func.greatest(ConversationMember.last_read_id, message_id)
    res = await db.execute(
        update(ConversationMember)
        .where(ConversationMember.conversation_id == conv_id, ConversationMember.user_id == user.id)
        .values(**values)
        .returning(ConversationMember.last_read_id, ConversationMember.last_delivered_id)
    )
    last_read, last_delivered = res.one()
    await db.commit()
    others = [u for u in await member_ids(db, conv_id) if u != user.id]
    await hub.send_to_users(
        others,
        {
            "type": "receipt",
            "conversation_id": conv_id,
            "user_id": user.id,
            "last_delivered_id": last_delivered,
            "last_read_id": last_read if user.send_read_receipts else None,
        },
    )
    if read:
        # Clears the unread badge on the reader's other devices.
        await hub.send_to_users([user.id], {"type": "read.self", "conversation_id": conv_id, "last_read_id": last_read})


async def mark_all_delivered(db: AsyncSession, user: User) -> None:
    """On connect, everything already stored for this user has reached a device."""
    rows = await db.execute(
        select(ConversationMember.conversation_id, func.max(Message.id))
        .join(Message, Message.conversation_id == ConversationMember.conversation_id)
        .where(ConversationMember.user_id == user.id)
        .group_by(ConversationMember.conversation_id, ConversationMember.last_delivered_id)
        .having(func.max(Message.id) > ConversationMember.last_delivered_id)
    )
    for conv_id, max_id in rows.all():
        await mark_receipt(db, user, conv_id, max_id, read=False)


async def _system_message(db: AsyncSession, conv_id: int, actor_id: int, text: str) -> Message:
    m = Message(conversation_id=conv_id, sender_id=actor_id, kind="system", body=text)
    db.add(m)
    await db.flush()
    await db.execute(update(Conversation).where(Conversation.id == conv_id).values(last_message_at=func.now()))
    return m


async def _broadcast_message(db: AsyncSession, msg: Message, event: str = "message.new", client_id: str | None = None) -> dict:
    data = (await messages_json(db, [msg]))[0]
    await hub.send_to_users(await member_ids(db, msg.conversation_id), {"type": event, "message": data, "client_id": client_id})
    return data


async def _load_message_for(db: AsyncSession, message_id: int, user: User) -> tuple[Message, ConversationMember]:
    msg = await db.get(Message, message_id)
    if not msg:
        raise HTTPException(404, "Message not found.")
    cm = await db.get(ConversationMember, (msg.conversation_id, user.id))
    if not cm or msg.id < cm.visible_from_id:
        raise HTTPException(404, "Message not found.")
    return msg, cm


# ---------- conversations ----------

@router.get("/conversations")
async def list_conversations(me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return {"conversations": await conversations_json(db, me)}


@router.get("/conversations/{conv_id}")
async def get_conversation(conv_id: int, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await require_member(db, conv_id, me.id)
    return {"conversation": (await conversations_json(db, me, [conv_id]))[0]}


@router.post("/conversations/direct")
async def open_direct(body: DirectIn, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if body.user_id == me.id:
        raise HTTPException(400, "You can't start a conversation with yourself.")
    other = await db.get(User, body.user_id)
    if not other or await is_blocked_either(db, me.id, other.id):
        raise HTTPException(404, "User not found.")
    lo, hi = sorted((me.id, other.id))
    key = f"{lo}:{hi}"
    conv = (await db.execute(select(Conversation).where(Conversation.direct_key == key))).scalar_one_or_none()
    if not conv:
        if not await are_friends(db, me.id, other.id):
            raise HTTPException(403, "Add this person as a friend to start a conversation.")
        conv = Conversation(kind="direct", direct_key=key, created_by=me.id)
        db.add(conv)
        try:
            await db.flush()
            db.add_all([ConversationMember(conversation_id=conv.id, user_id=uid) for uid in (lo, hi)])
            await db.commit()
        except IntegrityError:  # the other person opened it at the same moment
            await db.rollback()
            conv = (await db.execute(select(Conversation).where(Conversation.direct_key == key))).scalar_one()
    # Re-joining a DM you left isn't possible (DMs can't be left), so membership always exists.
    return {"conversation": (await conversations_json(db, me, [conv.id]))[0]}


@router.post("/conversations/group", status_code=201)
async def create_group(body: GroupIn, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    limiter.check(f"group:{me.id}", 20, 3600)
    ids = {i for i in body.member_ids if i != me.id}
    if not ids:
        raise HTTPException(400, "Add at least one friend to the group.")
    for uid in ids:
        if not await are_friends(db, me.id, uid):
            raise HTTPException(400, "You can only add friends to a group.")
    conv = Conversation(kind="group", name=body.name, created_by=me.id)
    db.add(conv)
    await db.flush()
    db.add(ConversationMember(conversation_id=conv.id, user_id=me.id, role="owner"))
    db.add_all([ConversationMember(conversation_id=conv.id, user_id=uid) for uid in ids])
    await _system_message(db, conv.id, me.id, f"{me.display_name} created the group “{body.name}”.")
    await db.commit()
    await push_conversation(db, conv.id, ids | {me.id}, "conversation.new")
    return {"conversation": (await conversations_json(db, me, [conv.id]))[0]}


async def _require_group_admin(db: AsyncSession, conv_id: int, me: User) -> tuple[Conversation, ConversationMember]:
    cm = await require_member(db, conv_id, me.id)
    conv = await db.get(Conversation, conv_id)
    if conv.kind != "group":
        raise HTTPException(400, "This is not a group conversation.")
    if cm.role not in ("owner", "admin"):
        raise HTTPException(403, "Only group admins can do that.")
    return conv, cm


@router.patch("/conversations/{conv_id}")
async def rename_group(conv_id: int, body: GroupUpdateIn, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    conv, _ = await _require_group_admin(db, conv_id, me)
    conv.name = body.name
    msg = await _system_message(db, conv_id, me.id, f"{me.display_name} renamed the group to “{body.name}”.")
    await db.commit()
    await _broadcast_message(db, msg)
    await push_conversation(db, conv_id, await member_ids(db, conv_id))
    return {"ok": True}


@router.post("/conversations/{conv_id}/avatar")
async def group_avatar(conv_id: int, file: UploadFile = File(...), me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    conv, _ = await _require_group_admin(db, conv_id, me)
    limiter.check(f"upload:{me.id}", 20, 600)
    data = await uploads.read_limited(file, get_settings().max_image_bytes)
    blob, _m, ext, _w, _h = uploads.process_image(data, 512)
    old, conv.avatar_path = conv.avatar_path, await uploads.save("groups", blob, ext)
    await db.commit()
    await uploads.remove(old)
    await push_conversation(db, conv_id, await member_ids(db, conv_id))
    return {"ok": True}


@router.post("/conversations/{conv_id}/members")
async def add_members(conv_id: int, body: AddMembersIn, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    conv, _ = await _require_group_admin(db, conv_id, me)
    existing = set(await member_ids(db, conv_id))
    if len(existing) + len(body.user_ids) > 100:
        raise HTTPException(400, "Groups can have at most 100 members.")
    latest = (await db.execute(select(func.max(Message.id)).where(Message.conversation_id == conv_id))).scalar() or 0
    added = []
    for uid in set(body.user_ids) - existing:
        if not await are_friends(db, me.id, uid):
            raise HTTPException(400, "You can only add friends to a group.")
        u = await db.get(User, uid)
        # New members don't see history from before they joined.
        db.add(ConversationMember(conversation_id=conv_id, user_id=uid, visible_from_id=latest + 1, last_read_id=latest, last_delivered_id=latest))
        added.append(u)
    if not added:
        return {"ok": True}
    msg = await _system_message(db, conv_id, me.id, f"{me.display_name} added {', '.join(u.display_name for u in added)}.")
    await db.commit()
    await _broadcast_message(db, msg)
    await push_conversation(db, conv_id, [u.id for u in added], "conversation.new")
    await push_conversation(db, conv_id, existing)
    return {"ok": True}


@router.delete("/conversations/{conv_id}/members/{user_id}")
async def remove_member(conv_id: int, user_id: int, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    my = await require_member(db, conv_id, me.id)
    conv = await db.get(Conversation, conv_id)
    if conv.kind != "group":
        raise HTTPException(400, "You can't leave a direct conversation.")
    target = await db.get(ConversationMember, (conv_id, user_id))
    if not target:
        raise HTTPException(404, "That person isn't in this group.")
    leaving = user_id == me.id
    if not leaving:
        if my.role not in ("owner", "admin") or target.role == "owner":
            raise HTTPException(403, "You can't remove this member.")
    target_user = await db.get(User, user_id)
    await db.delete(target)
    await db.flush()
    remaining = (await db.execute(select(ConversationMember).where(ConversationMember.conversation_id == conv_id).order_by(ConversationMember.joined_at))).scalars().all()
    if not remaining:
        await db.delete(conv)
        await db.commit()
        await hub.send_to_users([user_id], {"type": "conversation.removed", "conversation_id": conv_id})
        return {"ok": True}
    if target.role == "owner":
        remaining[0].role = "owner"  # hand ownership to the longest-standing member
    text = f"{me.display_name} left the group." if leaving else f"{me.display_name} removed {target_user.display_name}."
    msg = await _system_message(db, conv_id, me.id, text)
    await db.commit()
    await hub.send_to_users([user_id], {"type": "conversation.removed", "conversation_id": conv_id})
    await _broadcast_message(db, msg)
    await push_conversation(db, conv_id, [m.user_id for m in remaining])
    return {"ok": True}


@router.put("/conversations/{conv_id}/mute")
async def mute(conv_id: int, muted: bool = Query(...), me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    cm = await require_member(db, conv_id, me.id)
    cm.muted = muted
    await db.commit()
    return {"ok": True, "muted": muted}


# ---------- messages ----------

@router.get("/conversations/{conv_id}/messages")
async def list_messages(
    conv_id: int,
    before: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    me: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """Newest-first keyset pagination: pass the oldest id you have as `before` for the next page."""
    cm = await require_member(db, conv_id, me.id)
    q = select(Message).where(Message.conversation_id == conv_id, Message.id >= cm.visible_from_id)
    if before:
        q = q.where(Message.id < before)
    msgs = list((await db.execute(q.order_by(Message.id.desc()).limit(limit + 1))).scalars())
    has_more = len(msgs) > limit
    msgs = list(reversed(msgs[:limit]))
    return {"messages": await messages_json(db, msgs), "has_more": has_more}


@router.get("/conversations/{conv_id}/search")
async def search_messages(conv_id: int, q: str = Query(min_length=1, max_length=100), me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    cm = await require_member(db, conv_id, me.id)
    limiter.check(f"msgsearch:{me.id}", 30, 60)
    pattern = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    rows = await db.execute(
        select(Message)
        .where(
            Message.conversation_id == conv_id,
            Message.id >= cm.visible_from_id,
            Message.deleted_at.is_(None),
            Message.kind == "text",
            Message.body.ilike(pattern, escape="\\"),
        )
        .order_by(Message.id.desc())
        .limit(50)
    )
    return {"messages": await messages_json(db, list(rows.scalars()))}


@router.get("/conversations/{conv_id}/pins")
async def pinned(conv_id: int, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    cm = await require_member(db, conv_id, me.id)
    rows = await db.execute(
        select(Message)
        .where(Message.conversation_id == conv_id, Message.id >= cm.visible_from_id, Message.pinned_at.is_not(None), Message.deleted_at.is_(None))
        .order_by(Message.pinned_at.desc())
    )
    return {"messages": await messages_json(db, list(rows.scalars()))}


async def _check_can_send(db: AsyncSession, conv_id: int, me: User) -> None:
    conv = await db.get(Conversation, conv_id)
    if conv.kind == "direct":
        others = [u for u in await member_ids(db, conv_id) if u != me.id]
        if not others or await is_blocked_either(db, me.id, others[0]):
            raise HTTPException(403, "You can't send messages to this user.")


async def create_message(db: AsyncSession, me: User, conv_id: int, body: str, reply_to_id: int | None = None,
                         attachment_id: int | None = None, forwarded: bool = False, client_id: str | None = None) -> dict:
    cm = await require_member(db, conv_id, me.id)
    await _check_can_send(db, conv_id, me)
    if not body and not attachment_id:
        raise HTTPException(400, "Message can't be empty.")
    if reply_to_id:
        rep = await db.get(Message, reply_to_id)
        if not rep or rep.conversation_id != conv_id or rep.id < cm.visible_from_id:
            raise HTTPException(400, "You can only reply to messages in this conversation.")
    if attachment_id:
        att = await db.get(Attachment, attachment_id)
        if not att or att.conversation_id != conv_id or att.uploader_id != me.id:
            raise HTTPException(400, "Attachment not found.")
    msg = Message(conversation_id=conv_id, sender_id=me.id, body=body, reply_to_id=reply_to_id, attachment_id=attachment_id, forwarded=forwarded)
    db.add(msg)
    await db.flush()
    await db.execute(update(Conversation).where(Conversation.id == conv_id).values(last_message_at=func.now()))
    # Sending implies you've read everything up to your own message.
    await db.execute(
        update(ConversationMember)
        .where(ConversationMember.conversation_id == conv_id, ConversationMember.user_id == me.id)
        .values(last_read_id=msg.id, last_delivered_id=msg.id)
    )
    await db.commit()
    await db.refresh(msg)
    # Stop the sender's typing indicator for everyone, then deliver the full message at once.
    hub.typing[me.id].discard(conv_id)
    members = await member_ids(db, conv_id)
    await hub.send_to_users([u for u in members if u != me.id], {"type": "typing", "conversation_id": conv_id, "user_id": me.id, "typing": False})
    return await _broadcast_message(db, msg, client_id=client_id)


@router.post("/conversations/{conv_id}/messages", status_code=201)
async def send_message(conv_id: int, body: MessageIn, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    limiter.check(f"send:{me.id}", 30, 10)
    msg = await create_message(db, me, conv_id, body.body, body.reply_to_id, body.attachment_id, client_id=body.client_id)
    return {"message": msg, "client_id": body.client_id}


@router.post("/conversations/{conv_id}/read")
async def mark_read(conv_id: int, body: ReadIn, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await require_member(db, conv_id, me.id)
    await mark_receipt(db, me, conv_id, body.message_id, read=True)
    return {"ok": True}


@router.patch("/messages/{message_id}")
async def edit_message(message_id: int, body: MessageEditIn, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    msg, _ = await _load_message_for(db, message_id, me)
    if msg.sender_id != me.id or msg.kind != "text":
        raise HTTPException(403, "You can only edit your own messages.")
    if msg.deleted_at:
        raise HTTPException(400, "This message was deleted.")
    msg.body = body.body
    msg.edited_at = datetime.now(timezone.utc)
    await db.commit()
    await _broadcast_message(db, msg, "message.updated")
    return {"ok": True}


@router.delete("/messages/{message_id}")
async def delete_message(message_id: int, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    msg, cm = await _load_message_for(db, message_id, me)
    conv = await db.get(Conversation, msg.conversation_id)
    is_admin = conv.kind == "group" and cm.role in ("owner", "admin")
    if msg.sender_id != me.id and not is_admin:
        raise HTTPException(403, "You can only delete your own messages.")
    if msg.kind != "text":
        raise HTTPException(400, "System messages can't be deleted.")
    msg.deleted_at = datetime.now(timezone.utc)
    msg.body = ""  # content is erased, only a "message deleted" marker remains
    msg.pinned_at = None
    att_id = msg.attachment_id
    await db.execute(delete(Reaction).where(Reaction.message_id == msg.id))
    if att_id:
        att = await db.get(Attachment, att_id)
        msg.attachment_id = None
        if att:
            await uploads.remove(f"files/{att.storage_name}")
            await db.delete(att)
    await db.commit()
    await _broadcast_message(db, msg, "message.updated")
    return {"ok": True}


@router.post("/messages/{message_id}/reactions")
async def react(message_id: int, body: ReactionIn, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    limiter.check(f"react:{me.id}", 60, 60)
    msg, _ = await _load_message_for(db, message_id, me)
    if msg.deleted_at or msg.kind != "text":
        raise HTTPException(400, "You can't react to this message.")
    count = (await db.execute(select(func.count(func.distinct(Reaction.emoji))).where(Reaction.message_id == msg.id))).scalar()
    if count >= 20:
        raise HTTPException(400, "This message has too many different reactions.")
    await db.execute(insert(Reaction).values(message_id=msg.id, user_id=me.id, emoji=body.emoji).on_conflict_do_nothing())
    await db.commit()
    await _broadcast_message(db, msg, "message.updated")
    return {"ok": True}


@router.delete("/messages/{message_id}/reactions")
async def unreact(message_id: int, emoji: str = Query(max_length=16), me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    msg, _ = await _load_message_for(db, message_id, me)
    await db.execute(delete(Reaction).where(Reaction.message_id == msg.id, Reaction.user_id == me.id, Reaction.emoji == emoji))
    await db.commit()
    await _broadcast_message(db, msg, "message.updated")
    return {"ok": True}


@router.post("/messages/{message_id}/pin")
async def pin(message_id: int, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    msg, cm = await _load_message_for(db, message_id, me)
    if msg.deleted_at or msg.kind != "text":
        raise HTTPException(400, "This message can't be pinned.")
    conv = await db.get(Conversation, msg.conversation_id)
    if conv.kind == "group" and cm.role not in ("owner", "admin"):
        raise HTTPException(403, "Only group admins can pin messages.")
    msg.pinned_at = datetime.now(timezone.utc)
    msg.pinned_by = me.id
    await db.commit()
    await _broadcast_message(db, msg, "message.updated")
    return {"ok": True}


@router.delete("/messages/{message_id}/pin")
async def unpin(message_id: int, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    msg, cm = await _load_message_for(db, message_id, me)
    conv = await db.get(Conversation, msg.conversation_id)
    if conv.kind == "group" and cm.role not in ("owner", "admin"):
        raise HTTPException(403, "Only group admins can unpin messages.")
    msg.pinned_at = None
    msg.pinned_by = None
    await db.commit()
    await _broadcast_message(db, msg, "message.updated")
    return {"ok": True}


@router.post("/messages/{message_id}/forward")
async def forward(message_id: int, body: ForwardIn, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    limiter.check(f"forward:{me.id}", 20, 60)
    msg, _ = await _load_message_for(db, message_id, me)
    if msg.deleted_at or msg.kind != "text":
        raise HTTPException(400, "This message can't be forwarded.")
    src_att = await db.get(Attachment, msg.attachment_id) if msg.attachment_id else None
    sent = []
    for target in dict.fromkeys(body.conversation_ids):
        att_id = None
        if src_att:
            await require_member(db, target, me.id)
            # Copy the file so each conversation's attachment stays scoped to that conversation.
            src_bytes, _ = await uploads.read(f"files/{src_att.storage_name}")
            rel = await uploads.save("files", src_bytes, "." + src_att.storage_name.rsplit(".", 1)[-1])
            copy = Attachment(uploader_id=me.id, conversation_id=target, storage_name=rel.split("/", 1)[1], original_name=src_att.original_name,
                              mime=src_att.mime, size=src_att.size, width=src_att.width, height=src_att.height)
            db.add(copy)
            await db.flush()
            att_id = copy.id
        sent.append(await create_message(db, me, target, msg.body, attachment_id=att_id, forwarded=True))
    return {"messages": sent}


# ---------- attachments ----------

@router.post("/conversations/{conv_id}/attachments", status_code=201)
async def upload_attachment(conv_id: int, file: UploadFile = File(...), me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await require_member(db, conv_id, me.id)
    await _check_can_send(db, conv_id, me)
    limiter.check(f"upload:{me.id}", 20, 600)
    s = get_settings()
    data = await uploads.read_limited(file, s.max_file_bytes)
    filename = (file.filename or "file").replace("\\", "/").rsplit("/", 1)[-1][:200] or "file"
    width = height = None
    try:
        if len(data) > s.max_image_bytes:
            raise HTTPException(415)
        blob, mime, ext, width, height = uploads.process_image(data, 2048)
    except HTTPException as e:
        if e.status_code == 413:
            raise
        blob = data
        mime, ext = uploads.sniff_file(data, filename)
    rel = await uploads.save("files", blob, ext)
    att = Attachment(uploader_id=me.id, conversation_id=conv_id, storage_name=rel.split("/", 1)[1], original_name=filename,
                     mime=mime, size=len(blob), width=width, height=height)
    db.add(att)
    await db.commit()
    await db.refresh(att)
    from ..serialize import attachment_json

    return {"attachment": attachment_json(att)}


@router.get("/attachments/{att_id}")
async def get_attachment(att_id: int, download: bool = False, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    att = await db.get(Attachment, att_id)
    if not att or not await db.get(ConversationMember, (att.conversation_id, me.id)):
        raise HTTPException(404, "Not found.")
    data, _ = await uploads.read(f"files/{att.storage_name}")
    inline = att.mime.startswith("image/") and not download
    # RFC 6266/5987 filename: ASCII fallback plus the exact UTF-8 name.
    ascii_name = "".join(c if 32 <= ord(c) < 127 and c not in '"\\' else "_" for c in att.original_name) or "file"
    disposition = f"{'inline' if inline else 'attachment'}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(att.original_name)}"
    return Response(
        data,
        media_type=att.mime,
        headers={"Content-Disposition": disposition, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600",
                 "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"},
    )
