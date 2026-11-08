"""Real-time channel. One WebSocket per open app window.

Client -> server messages:
  {"type": "typing", "conversation_id": 1, "typing": true}
  {"type": "delivered", "conversation_id": 1, "message_id": 42}
  {"type": "read", "conversation_id": 1, "message_id": 42}
  {"type": "ping"}
Messages themselves are sent over REST (validated, rate-limited, stored, then fanned out here).
"""
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import update

from ..config import get_settings
from ..db import SessionLocal
from ..deps import user_from_token
from ..models import ConversationMember, User
from ..realtime import hub
from ..security import limiter
from ..serialize import member_ids
from .conversations import mark_all_delivered, mark_receipt
from .users import broadcast_presence

router = APIRouter()
log = logging.getLogger("ws")


async def _stop_typing_everywhere(user_id: int) -> None:
    convs = hub.typing.pop(user_id, set())
    if not convs:
        return
    async with SessionLocal() as db:
        for cid in convs:
            await hub.send_to_users([u for u in await member_ids(db, cid) if u != user_id],
                                    {"type": "typing", "conversation_id": cid, "user_id": user_id, "typing": False})


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    s = get_settings()
    origin = (ws.headers.get("origin") or "").rstrip("/")
    # Cross-site WebSocket hijacking protection: browsers always send Origin.
    if origin and origin not in s.origins and not origin.startswith("file://"):
        await ws.close(code=4003)
        return
    async with SessionLocal() as db:
        found = await user_from_token(db, ws.cookies.get(s.session_cookie_name))
        if not found:
            await ws.close(code=4001)
            return
        user = found[0]
        user_id = user.id

    await ws.accept()
    first = await hub.connect(user_id, ws, user.status, user.show_presence)
    await ws.send_text(json.dumps({"type": "hello", "user_id": user_id}))
    async with SessionLocal() as db:
        if first:
            await broadcast_presence(db, user)
        await mark_all_delivered(db, user)

    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > 2000 or not limiter.hit(f"ws:{user_id}", 120, 10):
                continue
            try:
                msg = json.loads(raw)
                kind = msg.get("type")
            except (ValueError, AttributeError):
                continue
            if kind == "ping":
                await ws.send_text('{"type":"pong"}')
                continue
            try:
                conv_id = int(msg.get("conversation_id"))
            except (TypeError, ValueError):
                continue
            async with SessionLocal() as db:
                if not await db.get(ConversationMember, (conv_id, user_id)):
                    continue  # not a member: ignore silently
                if kind == "typing":
                    typing = bool(msg.get("typing"))
                    if typing:
                        hub.typing[user_id].add(conv_id)
                    else:
                        hub.typing[user_id].discard(conv_id)
                    others = [u for u in await member_ids(db, conv_id) if u != user_id]
                    await hub.send_to_users(others, {"type": "typing", "conversation_id": conv_id, "user_id": user_id, "typing": typing})
                elif kind in ("delivered", "read"):
                    try:
                        mid = int(msg.get("message_id"))
                    except (TypeError, ValueError):
                        continue
                    me = await db.get(User, user_id)
                    await mark_receipt(db, me, conv_id, mid, read=kind == "read")
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        log.exception("websocket error")
    finally:
        last = hub.disconnect(user_id, ws)
        if last:
            await _stop_typing_everywhere(user_id)
            async with SessionLocal() as db:
                await db.execute(update(User).where(User.id == user_id).values(last_seen_at=datetime.now(timezone.utc)))
                await db.commit()
                u = await db.get(User, user_id)
                if u:
                    await broadcast_presence(db, u)
