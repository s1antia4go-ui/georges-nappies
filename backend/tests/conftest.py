"""Tests run against a real PostgreSQL test database (TEST_DATABASE_URL), through the real app.

One TestClient (one event loop) is shared; each simulated person carries their own
session cookie explicitly, the way separate browsers would.
"""
import os
import re
from pathlib import Path

import pytest

_env = Path(__file__).resolve().parent.parent / ".env"
for line in _env.read_text(encoding="utf-8-sig").splitlines() if _env.exists() else []:
    m = re.match(r"^\s*TEST_DATABASE_URL\s*=\s*(.+)$", line)
    if m:
        os.environ["DATABASE_URL"] = m.group(1).strip()
os.environ["ENVIRONMENT"] = "test"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.security import limiter  # noqa: E402

ORIGIN = "http://localhost:5173"
COOKIE = "gn_session"


class Person:
    """A signed-in (or not yet signed-in) user driving the real API."""

    def __init__(self, client: TestClient):
        self.c = client
        self.token: str | None = None
        self.user: dict | None = None

    def _headers(self):
        h = {"Origin": ORIGIN}
        if self.token:
            h["Cookie"] = f"{COOKIE}={self.token}"
        return h

    def _capture(self, r):
        tok = r.cookies.get(COOKIE)
        if tok:
            self.token = tok
        self.c.cookies.clear()
        return r

    def get(self, url, **kw):
        return self._capture(self.c.get(url, headers=self._headers(), **kw))

    def post(self, url, **kw):
        return self._capture(self.c.post(url, headers=self._headers(), **kw))

    def patch(self, url, **kw):
        return self._capture(self.c.patch(url, headers=self._headers(), **kw))

    def put(self, url, **kw):
        return self._capture(self.c.put(url, headers=self._headers(), **kw))

    def delete(self, url, **kw):
        return self._capture(self.c.delete(url, headers=self._headers(), **kw))

    def ws(self):
        return self.c.websocket_connect("/ws", headers=self._headers())

    def register(self, username, email=None, display=None, password="correct-horse-battery"):
        r = self.post(
            "/api/auth/register",
            json={"username": username, "display_name": display or username.title(),
                  "email": email or f"{username.lower()}@example.com", "password": password},
        )
        if r.status_code == 201:
            self.user = r.json()["user"]
        return r


@pytest.fixture()
def client():
    with TestClient(app) as c:
        # Fresh schema for every test.
        from app.db import Base, engine

        async def reset():
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.drop_all)
                await conn.run_sync(Base.metadata.create_all)

        c.portal.call(reset)
        limiter.reset()
        yield c


@pytest.fixture()
def people(client):
    return lambda: Person(client)
