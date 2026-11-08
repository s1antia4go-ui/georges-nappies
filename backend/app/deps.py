from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import get_db
from .models import Session, User
from .security import token_hash


async def user_from_token(db: AsyncSession, token: str | None) -> tuple[User, Session] | None:
    if not token or len(token) > 100:
        return None
    row = (
        await db.execute(
            select(User, Session)
            .join(Session, Session.user_id == User.id)
            .where(Session.token_hash == token_hash(token), Session.expires_at > datetime.now(timezone.utc))
        )
    ).first()
    if not row:
        return None
    user, sess = row
    now = datetime.now(timezone.utc)
    # Touch the session at most every 10 minutes; slide its expiry.
    if now - sess.last_used_at > timedelta(minutes=10):
        await db.execute(
            update(Session)
            .where(Session.id == sess.id)
            .values(last_used_at=now, expires_at=now + timedelta(days=get_settings().session_days))
        )
        await db.commit()
    return user, sess


async def current_session(request: Request, db: AsyncSession = Depends(get_db)) -> tuple[User, Session]:
    found = await user_from_token(db, request.cookies.get(get_settings().session_cookie_name))
    if not found:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please sign in.")
    return found


async def current_user(found: tuple[User, Session] = Depends(current_session)) -> User:
    return found[0]
