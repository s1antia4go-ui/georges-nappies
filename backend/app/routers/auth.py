from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import usernames
from ..config import get_settings
from ..db import get_db
from ..deps import current_session, current_user
from ..mailer import send_email
from ..models import PasswordReset, Session, User, UsernameReservation
from ..realtime import hub
from ..schemas import ChangeEmailIn, ChangePasswordIn, DeleteAccountIn, ForgotIn, LoginIn, RegisterIn, ResetIn
from ..security import client_ip, hash_password, limiter, needs_rehash, new_token, token_hash, verify_password
from ..serialize import user_me

router = APIRouter(prefix="/api/auth", tags=["auth"])


async def _start_session(db: AsyncSession, response: Response, request: Request, user: User) -> None:
    s = get_settings()
    token = new_token()
    db.add(
        Session(
            user_id=user.id,
            token_hash=token_hash(token),
            user_agent=(request.headers.get("user-agent") or "")[:300],
            ip=client_ip(request),
            expires_at=datetime.now(timezone.utc) + timedelta(days=s.session_days),
        )
    )
    await db.commit()
    response.set_cookie(
        s.session_cookie_name,
        token,
        max_age=s.session_days * 86400,
        httponly=True,
        secure=s.cookie_secure,
        samesite="lax",
        path="/",
    )


async def _username_problem(db: AsyncSession, username: str) -> str | None:
    err = usernames.validate(username)
    if err:
        return err
    taken = await db.get(UsernameReservation, usernames.canonical(username))
    if taken:
        if taken.username.lower() == username.lower():
            return "That username is already taken."
        return f"Too similar to an existing username (@{taken.username})."
    return None


@router.get("/username-available")
async def username_available(request: Request, username: str = Query(max_length=40), db: AsyncSession = Depends(get_db)):
    limiter.check(f"uname:{client_ip(request)}", 60, 60)
    problem = await _username_problem(db, username)
    return {"available": problem is None, "message": problem or "Username is available."}


@router.post("/register", status_code=201)
async def register(body: RegisterIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    limiter.check(f"register:{client_ip(request)}", 10, 3600)
    problem = await _username_problem(db, body.username)
    if problem:
        conflict = problem.startswith(("That username is already taken", "Too similar"))
        raise HTTPException(409 if conflict else 422, problem)

    email = body.email.lower()
    if (await db.execute(select(User.id).where(User.email == email))).first():
        raise HTTPException(409, "An account with that email already exists.")

    canon = usernames.canonical(body.username)
    user = User(
        username=body.username,
        username_canonical=canon,
        display_name=body.display_name,
        email=email,
        password_hash=hash_password(body.password),
        preferences={"theme": "system", "text_animation": "on"},
    )
    # User + permanent reservation in one transaction. The unique constraints on
    # users.username, users.username_canonical and username_reservations.canonical make
    # simultaneous registrations of the same name fail atomically for all but one request.
    try:
        db.add(user)
        await db.flush()
        db.add(UsernameReservation(canonical=canon, username=body.username, user_id=user.id))
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        msg = str(e.orig).lower()
        if "email" in msg:
            raise HTTPException(409, "An account with that email already exists.") from None
        raise HTTPException(409, "That username is already taken.") from None

    await db.refresh(user)
    await _start_session(db, response, request, user)
    return {"user": user_me(user)}


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    ip = client_ip(request)
    ident = body.login.strip().lstrip("@").lower()
    limiter.check(f"login-ip:{ip}", 20, 300)
    limiter.check(f"login-acct:{ident}", 8, 300)
    user = (
        await db.execute(select(User).where(or_(func.lower(User.username) == ident, User.email == ident)))
    ).scalar_one_or_none()
    if not verify_password(user.password_hash if user else None, body.password) or not user:
        raise HTTPException(401, "Incorrect username or password.")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    await _start_session(db, response, request, user)
    return {"user": user_me(user)}


@router.post("/logout")
async def logout(response: Response, found=Depends(current_session), db: AsyncSession = Depends(get_db)):
    _, sess = found
    await db.execute(delete(Session).where(Session.id == sess.id))
    await db.commit()
    response.delete_cookie(get_settings().session_cookie_name, path="/")
    return {"ok": True}


@router.get("/me")
async def me(user: User = Depends(current_user)):
    return {"user": user_me(user)}


@router.post("/forgot")
async def forgot(body: ForgotIn, request: Request, db: AsyncSession = Depends(get_db)):
    limiter.check(f"forgot-ip:{client_ip(request)}", 5, 900)
    limiter.check(f"forgot:{body.email.lower()}", 3, 900)
    user = (await db.execute(select(User).where(User.email == body.email.lower()))).scalar_one_or_none()
    if user:
        token = new_token()
        db.add(
            PasswordReset(
                user_id=user.id,
                token_hash=token_hash(token),
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
            )
        )
        await db.commit()
        link = f"{get_settings().public_url.rstrip('/')}/app/reset-password?token={token}"
        await send_email(
            user.email,
            "Reset your George's Nappies password",
            f"Hi {user.display_name},\n\nUse this link within 30 minutes to choose a new password:\n{link}\n\n"
            "If you didn't ask for this, you can ignore this email.",
        )
    # Same answer either way, so the form can't be used to discover registered emails.
    return {"ok": True, "message": "If that email has an account, a reset link is on its way."}


@router.post("/reset")
async def reset(body: ResetIn, request: Request, db: AsyncSession = Depends(get_db)):
    limiter.check(f"reset-ip:{client_ip(request)}", 10, 900)
    pr = (
        await db.execute(
            select(PasswordReset).where(
                PasswordReset.token_hash == token_hash(body.token),
                PasswordReset.used_at.is_(None),
                PasswordReset.expires_at > datetime.now(timezone.utc),
            )
        )
    ).scalar_one_or_none()
    if not pr:
        raise HTTPException(400, "This reset link is invalid or has expired.")
    now = datetime.now(timezone.utc)
    await db.execute(update(User).where(User.id == pr.user_id).values(password_hash=hash_password(body.password)))
    await db.execute(update(PasswordReset).where(PasswordReset.user_id == pr.user_id, PasswordReset.used_at.is_(None)).values(used_at=now))
    await db.execute(delete(Session).where(Session.user_id == pr.user_id))  # sign out everywhere
    await db.commit()
    await hub.close_user(pr.user_id)
    return {"ok": True}


@router.post("/change-password")
async def change_password(
    body: ChangePasswordIn,
    request: Request,
    response: Response,
    found=Depends(current_session),
    db: AsyncSession = Depends(get_db),
):
    user, sess = found
    limiter.check(f"chpw:{user.id}", 5, 900)
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(400, "Your current password is incorrect.")
    user.password_hash = hash_password(body.new_password)
    # Keep this device signed in, sign out every other session.
    await db.execute(delete(Session).where(Session.user_id == user.id, Session.id != sess.id))
    await db.commit()
    return {"ok": True}


@router.post("/change-email")
async def change_email(body: ChangeEmailIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    limiter.check(f"chemail:{user.id}", 5, 900)
    if not verify_password(user.password_hash, body.password):
        raise HTTPException(400, "Your password is incorrect.")
    user.email = body.email.lower()
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "An account with that email already exists.") from None
    await db.refresh(user)
    return {"user": user_me(user)}


@router.get("/sessions")
async def list_sessions(found=Depends(current_session), db: AsyncSession = Depends(get_db)):
    user, cur = found
    rows = (await db.execute(select(Session).where(Session.user_id == user.id).order_by(Session.last_used_at.desc()))).scalars()
    return {
        "sessions": [
            {
                "id": s.id,
                "user_agent": s.user_agent,
                "ip": s.ip,
                "created_at": s.created_at.isoformat(),
                "last_used_at": s.last_used_at.isoformat(),
                "current": s.id == cur.id,
            }
            for s in rows
        ]
    }


@router.post("/sessions/revoke-others")
async def revoke_others(found=Depends(current_session), db: AsyncSession = Depends(get_db)):
    user, cur = found
    await db.execute(delete(Session).where(Session.user_id == user.id, Session.id != cur.id))
    await db.commit()
    return {"ok": True}


@router.post("/delete-account")
async def delete_account(body: DeleteAccountIn, response: Response, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if not verify_password(user.password_hash, body.password):
        raise HTTPException(400, "Your password is incorrect.")
    uid = user.id
    # The username reservation row survives (user_id -> NULL) so the name is never reissued.
    await db.delete(user)
    await db.commit()
    await hub.close_user(uid)
    response.delete_cookie(get_settings().session_cookie_name, path="/")
    return {"ok": True}
