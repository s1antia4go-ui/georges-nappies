"""Password hashing, opaque session tokens and rate limiting."""
import hashlib
import secrets
import time
from collections import defaultdict, deque

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import HTTPException, Request, status

_hasher = PasswordHasher()  # Argon2id with library defaults (memory-hard)

# A real hash of a random password, used to make login timing equal for unknown users.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def new_token() -> str:
    """256-bit random token. Only its SHA-256 is stored server-side."""
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


class RateLimiter:
    """In-process sliding-window limiter.

    Good for a single server process. For several workers, back it with Redis
    (same interface) so limits are shared.
    """

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def hit(self, key: str, limit: int, window: float) -> bool:
        now = time.monotonic()
        q = self._hits[key]
        while q and q[0] <= now - window:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(now)
        return True

    def check(self, key: str, limit: int, window: float) -> None:
        if not self.hit(key, limit, window):
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests. Please slow down and try again shortly.")

    def reset(self) -> None:
        self._hits.clear()


limiter = RateLimiter()
