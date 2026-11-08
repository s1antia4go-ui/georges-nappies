"""Database schema.

All timestamps are timezone-aware and stored in UTC. `users.created_at` is set by the
database on insert and is never exposed to any update path.
"""
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base

TS = DateTime(timezone=True)


def now_col(**kw):
    return mapped_column(TS, server_default=func.now(), nullable=False, **kw)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    username: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    # Confusable-folded form ("g3orge" -> "georga"-style skeleton); unique to stop look-alikes.
    username_canonical: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(40), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    bio: Mapped[str] = mapped_column(String(300), nullable=False, server_default="")
    avatar_path: Mapped[str | None] = mapped_column(String(200))
    banner_path: Mapped[str | None] = mapped_column(String(200))
    banner_color: Mapped[str] = mapped_column(String(7), nullable=False, server_default="#1C1C1E")
    accent_color: Mapped[str] = mapped_column(String(7), nullable=False, server_default="#111113")

    # Chosen status: online | idle | invisible. "offline" is derived from having no connection.
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="online")
    last_seen_at: Mapped[datetime | None] = mapped_column(TS)

    # Privacy
    discoverable: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    send_read_receipts: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    show_presence: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    allow_requests: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))

    # Notification + appearance preferences (free-form, validated by schemas.PreferencesIn).
    preferences: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))

    created_at: Mapped[datetime] = now_col()

    __table_args__ = (
        CheckConstraint("status in ('online','idle','invisible')", name="ck_users_status"),
        CheckConstraint("username ~ '^[A-Za-z][A-Za-z0-9_]{2,19}$'", name="ck_users_username_format"),
    )


class UsernameReservation(Base):
    """Permanent reservation of every username ever registered.

    Rows are never deleted; if the owning account is deleted the reservation stays,
    so nobody else can ever claim that name (or a look-alike of it).
    """

    __tablename__ = "username_reservations"

    canonical: Mapped[str] = mapped_column(String(20), primary_key=True)
    username: Mapped[str] = mapped_column(String(20), nullable=False)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reserved_at: Mapped[datetime] = now_col()


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    user_agent: Mapped[str] = mapped_column(String(300), nullable=False, server_default="")
    ip: Mapped[str] = mapped_column(String(64), nullable=False, server_default="")
    created_at: Mapped[datetime] = now_col()
    last_used_at: Mapped[datetime] = now_col()
    expires_at: Mapped[datetime] = mapped_column(TS, nullable=False)


class PasswordReset(Base):
    __tablename__ = "password_resets"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = now_col()
    expires_at: Mapped[datetime] = mapped_column(TS, nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(TS)


class Friendship(Base):
    """One row per friendship, stored with user_a < user_b so a pair can only exist once."""

    __tablename__ = "friendships"

    user_a: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    user_b: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    created_at: Mapped[datetime] = now_col()

    __table_args__ = (CheckConstraint("user_a < user_b", name="ck_friendship_order"),)


class FriendRequest(Base):
    __tablename__ = "friend_requests"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    from_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    to_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="pending")
    created_at: Mapped[datetime] = now_col()
    responded_at: Mapped[datetime | None] = mapped_column(TS)

    __table_args__ = (
        CheckConstraint("from_user_id <> to_user_id", name="ck_friend_request_not_self"),
        CheckConstraint("status in ('pending','accepted','declined','cancelled')", name="ck_friend_request_status"),
        # At most one pending request per unordered pair, in either direction.
        Index(
            "uq_friend_request_pending_pair",
            func.least(text("from_user_id"), text("to_user_id")),
            func.greatest(text("from_user_id"), text("to_user_id")),
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
    )


class Favorite(Base):
    __tablename__ = "favorites"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    friend_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = now_col()


class Block(Base):
    __tablename__ = "blocks"

    blocker_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    blocked_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    created_at: Mapped[datetime] = now_col()

    __table_args__ = (CheckConstraint("blocker_id <> blocked_id", name="ck_block_not_self"),)


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    reported_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    reason: Mapped[str] = mapped_column(String(40), nullable=False)
    details: Mapped[str] = mapped_column(String(1000), nullable=False, server_default="")
    created_at: Mapped[datetime] = now_col()


class SearchHistory(Base):
    __tablename__ = "search_history"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    found_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    searched_at: Mapped[datetime] = now_col()


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    kind: Mapped[str] = mapped_column(String(6), nullable=False)  # direct | group
    # For direct chats: "<low_id>:<high_id>", unique, so two users share exactly one DM.
    direct_key: Mapped[str | None] = mapped_column(String(50), unique=True)
    name: Mapped[str | None] = mapped_column(String(60))
    avatar_path: Mapped[str | None] = mapped_column(String(200))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = now_col()
    last_message_at: Mapped[datetime] = now_col()

    __table_args__ = (CheckConstraint("kind in ('direct','group')", name="ck_conversation_kind"),)


class ConversationMember(Base):
    __tablename__ = "conversation_members"

    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(6), nullable=False, server_default="member")  # owner | admin | member
    joined_at: Mapped[datetime] = now_col()
    last_read_id: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    last_delivered_id: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    muted: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    # Messages before this id are hidden for this member (set on join, so new group members
    # don't see prior history, and when they clear a chat).
    visible_from_id: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    sender_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # kind: text | system. System messages describe group events (member added, renamed...).
    kind: Mapped[str] = mapped_column(String(8), nullable=False, server_default="text")
    # `body` is opaque to the server apart from search. An end-to-end encryption layer would
    # store ciphertext here with `encryption` naming the protocol/version (e.g. "mls-1").
    body: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    encryption: Mapped[str | None] = mapped_column(String(20))
    reply_to_id: Mapped[int | None] = mapped_column(ForeignKey("messages.id", ondelete="SET NULL"))
    forwarded: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    attachment_id: Mapped[int | None] = mapped_column(ForeignKey("attachments.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = now_col()
    edited_at: Mapped[datetime | None] = mapped_column(TS)
    deleted_at: Mapped[datetime | None] = mapped_column(TS)
    pinned_at: Mapped[datetime | None] = mapped_column(TS)
    pinned_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (Index("ix_messages_conversation_id_id", "conversation_id", "id"),)


class Reaction(Base):
    __tablename__ = "reactions"

    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    emoji: Mapped[str] = mapped_column(String(16), primary_key=True)
    created_at: Mapped[datetime] = now_col()


class StoredFile(Base):
    """Uploaded file contents, when STORAGE_BACKEND=database (production on hosts without a disk).

    Keys look like "avatars/<random>.png" or "files/<random>.pdf"; the same keys are used by the
    local-disk backend, so data can move between backends unchanged.
    """

    __tablename__ = "stored_files"

    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = now_col()


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    uploader_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    storage_name: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    original_name: Mapped[str] = mapped_column(String(200), nullable=False)
    mime: Mapped[str] = mapped_column(String(80), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = now_col()
