"""Acceptance tests from the brief (section 14) plus messaging, privacy and security checks."""
import io
from datetime import datetime, timezone

from PIL import Image


# ---------- Section 14 acceptance tests ----------

def test_usernames_friends_and_member_since(people):
    a, b, b2 = people(), people(), people()

    # 1. User A registers with a username.
    r = a.register("George")
    assert r.status_code == 201, r.text
    # 2. User B attempts to register with the same username and is rejected (any casing).
    r = b.register("george", email="b@example.com")
    assert r.status_code == 409 and "taken" in r.json()["detail"]
    # Look-alikes are rejected too (impersonation protection).
    for fake in ("Ge0rge", "george_", "G3orge", "georgee"):
        r = b2.register(fake, email=f"{fake.lower()}@x.com")
        assert r.status_code == 409, (fake, r.text)
    # Live availability check agrees.
    assert a.get("/api/auth/username-available", params={"username": "GEORGE"}).json()["available"] is False
    # 3. User B registers with a different username.
    r = b.register("Bertie", email="b@example.com")
    assert r.status_code == 201, r.text

    # 4. User A searches for User B by exact username.
    r = a.get("/api/users/search/exact", params={"username": "bertie"})
    assert r.status_code == 200 and r.json()["user"]["username"] == "Bertie"
    assert a.get("/api/users/search/exact", params={"username": "nobody_here"}).status_code == 404

    # 5. User A sends a friend request.
    r = a.post("/api/friends/requests", json={"username": "Bertie"})
    assert r.status_code == 201 and "sent" in r.json()["message"].lower()

    # 9. Duplicate requests and self-requests are rejected.
    assert a.post("/api/friends/requests", json={"username": "Bertie"}).status_code == 409
    assert a.post("/api/friends/requests", json={"username": "George"}).status_code == 400

    # 6. User B receives and accepts.
    incoming = b.get("/api/friends").json()["incoming"]
    assert len(incoming) == 1 and incoming[0]["user"]["username"] == "George"
    assert a.get("/api/friends").json()["outgoing"][0]["user"]["username"] == "Bertie"
    r = b.post(f"/api/friends/requests/{incoming[0]['id']}/accept")
    assert r.status_code == 200, r.text

    # 7. Both appear in each other's friends lists.
    assert [f["username"] for f in a.get("/api/friends").json()["friends"]] == ["Bertie"]
    assert [f["username"] for f in b.get("/api/friends").json()["friends"]] == ["George"]
    # Requests after becoming friends are rejected.
    assert b.post("/api/friends/requests", json={"username": "george"}).status_code == 409

    # 8. Both profiles show their original creation date (UTC, server generated).
    for viewer, target in ((a, b), (b, a)):
        p = viewer.get(f"/api/users/{target.user['id']}").json()["user"]
        created = datetime.fromisoformat(p["created_at"])
        assert created.tzinfo is not None
        assert abs((datetime.now(timezone.utc) - created).total_seconds()) < 120
        assert p["created_at"] == target.user["created_at"]

    # created_at can't be changed through profile editing.
    a.patch("/api/me/profile", json={"bio": "hi", "created_at": "2000-01-01T00:00:00Z"})
    assert a.get("/api/auth/me").json()["user"]["created_at"] == a.user["created_at"]

    # Logging in again keeps the original date.
    a2 = people()
    assert a2.post("/api/auth/login", json={"login": "george", "password": "correct-horse-battery"}).status_code == 200
    assert a2.get("/api/auth/me").json()["user"]["created_at"] == a.user["created_at"]


def test_deleted_usernames_stay_reserved(people):
    a, b = people(), people()
    a.register("Maisie")
    assert a.post("/api/auth/delete-account", json={"password": "correct-horse-battery"}).status_code == 200
    assert b.register("maisie", email="other@example.com").status_code == 409


def test_reserved_and_invalid_usernames(people):
    p = people()
    for bad, code in (("admin", 422), ("Official_George", 422), ("two words", 422), ("1abc", 422), ("ab", 422)):
        r = p.register(bad, email=f"x{abs(hash(bad))}@e.com")
        assert r.status_code == code, (bad, r.text)


# ---------- auth & sessions ----------

def test_login_logout_and_reset(people, caplog):
    a = people()
    a.register("Harriet")
    assert a.get("/api/auth/me").status_code == 200
    assert a.post("/api/auth/logout").status_code == 200
    assert a.get("/api/auth/me").status_code == 401

    bad = people()
    assert bad.post("/api/auth/login", json={"login": "harriet", "password": "wrong-password"}).status_code == 401

    caplog.set_level("WARNING")
    assert a.post("/api/auth/forgot", json={"email": "harriet@example.com"}).status_code == 200
    token = next(r.getMessage() for r in caplog.records if "reset-password?token=" in r.getMessage()).split("token=")[1].split()[0]
    assert a.post("/api/auth/reset", json={"token": token, "password": "a-brand-new-pass"}).status_code == 200
    assert a.post("/api/auth/reset", json={"token": token, "password": "another-new-pass"}).status_code == 400  # single use
    assert a.post("/api/auth/login", json={"login": "harriet", "password": "a-brand-new-pass"}).status_code == 200


def test_cross_site_requests_blocked(client):
    r = client.post("/api/auth/login", json={"login": "x", "password": "y"}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


def test_login_rate_limited(people):
    p = people()
    codes = [p.post("/api/auth/login", json={"login": "someone", "password": "nope-nope"}).status_code for _ in range(10)]
    assert 429 in codes


# ---------- messaging ----------

def _friends(a, b):
    a.post("/api/friends/requests", json={"username": b.user["username"]})
    rid = b.get("/api/friends").json()["incoming"][0]["id"]
    b.post(f"/api/friends/requests/{rid}/accept")


def test_direct_messaging_realtime_receipts_and_privacy(people):
    a, b, eve = people(), people(), people()
    a.register("Alice"); b.register("Bobby"); eve.register("Evelyn")
    _friends(a, b)

    conv = a.post("/api/conversations/direct", json={"user_id": b.user["id"]}).json()["conversation"]
    cid = conv["id"]
    # Same DM from the other side.
    assert b.post("/api/conversations/direct", json={"user_id": a.user["id"]}).json()["conversation"]["id"] == cid
    # Non-friends can't open a DM.
    assert eve.post("/api/conversations/direct", json={"user_id": a.user["id"]}).status_code == 403

    with b.ws() as bws, a.ws() as aws:
        assert bws.receive_json()["type"] == "hello"
        assert aws.receive_json()["type"] == "hello"

        # Typing indicator travels to the other member.
        aws.send_json({"type": "typing", "conversation_id": cid, "typing": True})
        ev = _next(bws, "typing")
        assert ev["user_id"] == a.user["id"] and ev["typing"] is True

        # Message is stored and delivered in full, immediately.
        r = a.post(f"/api/conversations/{cid}/messages", json={"body": "Hello Bobby! 👋 ¿Qué tal?", "client_id": "c1"})
        assert r.status_code == 201
        mid = r.json()["message"]["id"]
        # Sending clears the sender's typing indicator, then the whole message arrives at once.
        assert _next(bws, "typing")["typing"] is False
        ev = _next(bws, "message.new")
        assert ev["message"]["body"] == "Hello Bobby! 👋 ¿Qué tal?"

        # Delivered + read receipts flow back to the sender.
        bws.send_json({"type": "delivered", "conversation_id": cid, "message_id": mid})
        assert _next(aws, "receipt")["last_delivered_id"] == mid
        bws.send_json({"type": "read", "conversation_id": cid, "message_id": mid})
        rec = _next(aws, "receipt", lambda e: e.get("last_read_id") == mid)
        assert rec["last_read_id"] == mid

        # Edit, react, pin, delete.
        assert a.patch(f"/api/messages/{mid}", json={"body": "Hello again"}).status_code == 200
        assert _next(bws, "message.updated")["message"]["edited_at"]
        assert b.post(f"/api/messages/{mid}/reactions", json={"emoji": "❤️"}).status_code == 200
        assert b.post(f"/api/messages/{mid}/reactions", json={"emoji": "lol"}).status_code == 422
        assert b.patch(f"/api/messages/{mid}", json={"body": "hijack"}).status_code == 403
        assert a.post(f"/api/messages/{mid}/pin").status_code == 200
        assert len(a.get(f"/api/conversations/{cid}/pins").json()["messages"]) == 1

    # Reply + search + unread count.
    r2 = b.post(f"/api/conversations/{cid}/messages", json={"body": "replying", "reply_to_id": mid}).json()["message"]
    assert r2["reply_to"]["id"] == mid
    convs = a.get("/api/conversations").json()["conversations"]
    assert convs[0]["unread_count"] == 1
    assert len(a.get(f"/api/conversations/{cid}/search", params={"q": "again"}).json()["messages"]) == 1

    # Delete erases content.
    assert a.delete(f"/api/messages/{mid}").status_code == 200
    m = [x for x in b.get(f"/api/conversations/{cid}/messages").json()["messages"] if x["id"] == mid][0]
    assert m["deleted"] and m["body"] == ""

    # Outsiders can't read, post into, or touch the conversation.
    assert eve.get(f"/api/conversations/{cid}/messages").status_code == 404
    assert eve.post(f"/api/conversations/{cid}/messages", json={"body": "hi"}).status_code == 404
    assert eve.post(f"/api/messages/{r2['id']}/reactions", json={"emoji": "😀"}).status_code == 404
    assert eve.get(f"/api/conversations/{cid}/search", params={"q": "a"}).status_code == 404

    # Blocking stops messages.
    assert b.post(f"/api/users/{a.user['id']}/block").status_code == 200
    assert a.post(f"/api/conversations/{cid}/messages", json={"body": "hi"}).status_code == 403
    assert a.get("/api/users/search/exact", params={"username": "bobby"}).status_code == 404


def test_group_chat_and_history_pagination(people):
    a, b, c = people(), people(), people()
    a.register("Owner"); b.register("Member"); c.register("Latecomer")
    _friends(a, b); _friends(a, c)
    g = a.post("/api/conversations/group", json={"name": "Weekend plans", "member_ids": [b.user["id"]]}).json()["conversation"]
    gid = g["id"]
    for i in range(120):
        a.post(f"/api/conversations/{gid}/messages", json={"body": f"msg {i}"})
        if i % 29 == 0:
            from app.security import limiter
            limiter.reset()
    page1 = b.get(f"/api/conversations/{gid}/messages", params={"limit": 50}).json()
    assert page1["has_more"] and page1["messages"][-1]["body"] == "msg 119"
    page2 = b.get(f"/api/conversations/{gid}/messages", params={"limit": 50, "before": page1["messages"][0]["id"]}).json()
    assert page2["messages"][-1]["id"] < page1["messages"][0]["id"]

    # A new member doesn't see earlier history.
    assert a.post(f"/api/conversations/{gid}/members", json={"user_ids": [c.user["id"]]}).status_code == 200
    seen = c.get(f"/api/conversations/{gid}/messages").json()["messages"]
    assert all(m["kind"] == "system" for m in seen)
    # Members can't rename unless admin.
    assert b.patch(f"/api/conversations/{gid}", json={"name": "Mine now"}).status_code == 403
    # Leaving works.
    assert b.delete(f"/api/conversations/{gid}/members/{b.user['id']}").status_code == 200
    assert b.get(f"/api/conversations/{gid}/messages").status_code == 404


def test_upload_validation(people):
    a, b = people(), people()
    a.register("Uploader"); b.register("Friendo")
    _friends(a, b)
    cid = a.post("/api/conversations/direct", json={"user_id": b.user["id"]}).json()["conversation"]["id"]

    # A script pretending to be a PNG is rejected.
    r = a.post("/api/me/avatar", files={"file": ("x.png", b"<script>alert(1)</script>", "image/png")})
    assert r.status_code == 415

    # Real animated GIF avatar stays animated.
    frames = [Image.new("RGB", (40, 40), c) for c in ("red", "blue", "green")]
    buf = io.BytesIO()
    frames[0].save(buf, format="GIF", save_all=True, append_images=frames[1:], duration=100, loop=0)
    r = a.post("/api/me/avatar", files={"file": ("a.gif", buf.getvalue(), "image/gif")})
    assert r.status_code == 200, r.text
    avatar = a.get(r.json()["user"]["avatar_url"])
    assert avatar.status_code == 200 and Image.open(io.BytesIO(avatar.content)).is_animated

    # Image attachment scoped to the conversation.
    png = io.BytesIO(); Image.new("RGB", (10, 10), "white").save(png, format="PNG")
    att = a.post(f"/api/conversations/{cid}/attachments", files={"file": ("p.png", png.getvalue(), "image/png")}).json()["attachment"]
    a.post(f"/api/conversations/{cid}/messages", json={"body": "", "attachment_id": att["id"]})
    assert b.get(att["url"]).status_code == 200
    stranger = people(); stranger.register("Stranger")
    assert stranger.get(att["url"]).status_code == 404
    # Executable disguised as text is rejected.
    r = a.post(f"/api/conversations/{cid}/attachments", files={"file": ("evil.exe", b"MZ\x90\x00\x03", "application/octet-stream")})
    assert r.status_code == 415


def test_database_file_storage(people):
    """Production on free hosting keeps uploads inside PostgreSQL (STORAGE_BACKEND=database)."""
    from app.config import get_settings

    s = get_settings()
    s.storage_backend = "database"
    try:
        a, b = people(), people()
        a.register("Cloudy"); b.register("Stormy")
        _friends(a, b)
        cid = a.post("/api/conversations/direct", json={"user_id": b.user["id"]}).json()["conversation"]["id"]

        # Banner + avatar round-trip through the database.
        png = io.BytesIO(); Image.new("RGB", (1200, 400), "gray").save(png, format="PNG")
        u = a.post("/api/me/banner", files={"file": ("b.png", png.getvalue(), "image/png")}).json()["user"]
        r = b.get(u["banner_url"])
        # Opaque images are re-encoded as JPEG (metadata stripped).
        assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
        assert Image.open(io.BytesIO(r.content)).size == (1200, 400)

        # Attachment with a non-ASCII name, scoped to the conversation.
        att = a.post(f"/api/conversations/{cid}/attachments", files={"file": ("résumé.pdf", b"%PDF-1.4 test", "application/pdf")}).json()["attachment"]
        a.post(f"/api/conversations/{cid}/messages", json={"body": "", "attachment_id": att["id"]})
        r = b.get(att["url"])
        assert r.status_code == 200 and r.content == b"%PDF-1.4 test"
        assert "filename*=UTF-8''r%C3%A9sum%C3%A9.pdf" in r.headers["content-disposition"]
        stranger = people(); stranger.register("Outsider")
        assert stranger.get(att["url"]).status_code == 404

        # Replacing the banner deletes the old file.
        old_key = u["banner_url"].removeprefix("/api/media/")
        a.post("/api/me/banner", files={"file": ("b2.png", png.getvalue(), "image/png")})
        assert a.get(f"/api/media/{old_key}").status_code == 404
    finally:
        s.storage_backend = "local"


def _next(ws, kind, pred=None, limit=20):
    for _ in range(limit):
        ev = ws.receive_json()
        if ev.get("type") == kind and (pred is None or pred(ev)):
            return ev
    raise AssertionError(f"no {kind} event")
