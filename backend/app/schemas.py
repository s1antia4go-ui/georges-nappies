"""Request bodies. Everything the client sends is validated here before touching the database."""
import re
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

HEX_COLOR = r"^#[0-9A-Fa-f]{6}$"


def _clean_text(v: str) -> str:
    # Strip control characters (except newline/tab) that could corrupt rendering or logs.
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", v)


class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=20)
    display_name: str = Field(min_length=1, max_length=40)
    email: EmailStr
    password: str = Field(min_length=10, max_length=200)

    @field_validator("display_name")
    @classmethod
    def _dn(cls, v: str) -> str:
        v = _clean_text(v).strip()
        if not v:
            raise ValueError("Display name can't be empty.")
        return v

    @field_validator("password")
    @classmethod
    def _pw(cls, v: str) -> str:
        if v.lower() == v and v.upper() == v and v.isdigit():
            raise ValueError("Password can't be only numbers.")
        if len(set(v)) < 5:
            raise ValueError("Password is too repetitive.")
        return v


class LoginIn(BaseModel):
    login: str = Field(min_length=1, max_length=254)  # username or email
    password: str = Field(min_length=1, max_length=200)


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str = Field(min_length=20, max_length=100)
    password: str = Field(min_length=10, max_length=200)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=10, max_length=200)


class ChangeEmailIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class DeleteAccountIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)


class ProfileIn(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=40)
    bio: str | None = Field(default=None, max_length=300)
    banner_color: str | None = Field(default=None, pattern=HEX_COLOR)
    accent_color: str | None = Field(default=None, pattern=HEX_COLOR)

    @field_validator("display_name", "bio")
    @classmethod
    def _clean(cls, v: str | None) -> str | None:
        return None if v is None else _clean_text(v).strip()


class StatusIn(BaseModel):
    status: Literal["online", "idle", "invisible"]


class PrivacyIn(BaseModel):
    discoverable: bool | None = None
    send_read_receipts: bool | None = None
    show_presence: bool | None = None
    allow_requests: bool | None = None


class PreferencesIn(BaseModel):
    theme: Literal["system", "light", "dark"] | None = None
    accent: str | None = Field(default=None, pattern=HEX_COLOR)
    text_animation: Literal["on", "off", "reduced"] | None = None
    font_scale: float | None = Field(default=None, ge=0.85, le=1.3)
    notify_messages: bool | None = None
    notify_friend_requests: bool | None = None
    notify_sounds: bool | None = None
    notify_previews: bool | None = None
    enter_to_send: bool | None = None


class FriendRequestIn(BaseModel):
    username: str = Field(min_length=1, max_length=20)


class ReportIn(BaseModel):
    reason: Literal["spam", "harassment", "impersonation", "inappropriate", "other"]
    details: str = Field(default="", max_length=1000)


class DirectIn(BaseModel):
    user_id: int


class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    member_ids: list[int] = Field(min_length=1, max_length=99)

    @field_validator("name")
    @classmethod
    def _n(cls, v: str) -> str:
        v = _clean_text(v).strip()
        if not v:
            raise ValueError("Group name can't be empty.")
        return v


class GroupUpdateIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)

    @field_validator("name")
    @classmethod
    def _n(cls, v: str) -> str:
        v = _clean_text(v).strip()
        if not v:
            raise ValueError("Group name can't be empty.")
        return v


class AddMembersIn(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=50)


class MessageIn(BaseModel):
    body: str = Field(default="", max_length=4000)
    reply_to_id: int | None = None
    attachment_id: int | None = None
    client_id: str | None = Field(default=None, max_length=64)

    @field_validator("body")
    @classmethod
    def _b(cls, v: str) -> str:
        return _clean_text(v).strip()


class MessageEditIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)

    @field_validator("body")
    @classmethod
    def _b(cls, v: str) -> str:
        v = _clean_text(v).strip()
        if not v:
            raise ValueError("Message can't be empty.")
        return v


class ReactionIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)

    @field_validator("emoji")
    @classmethod
    def _e(cls, v: str) -> str:
        # Emoji only: reject letters/digits/whitespace so reactions can't carry text.
        if any(ch.isalnum() or ch.isspace() or ord(ch) < 0x2000 and ch not in "#*" for ch in v):
            raise ValueError("Reactions must be emoji.")
        return v


class ForwardIn(BaseModel):
    conversation_ids: list[int] = Field(min_length=1, max_length=10)


class ReadIn(BaseModel):
    message_id: int
