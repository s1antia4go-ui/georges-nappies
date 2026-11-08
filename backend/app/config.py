"""Application settings, loaded from environment variables / backend/.env.

No secrets live in code. See backend/.env.example for every variable.
"""
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "George's Nappies"
    environment: str = "development"  # development | production

    # postgresql+asyncpg://user:password@host:5432/dbname
    database_url: str

    # Public origin(s) allowed to make state-changing requests and open WebSockets.
    # Comma-separated, e.g. "http://localhost:5173,http://localhost:8000"
    allowed_origins: str = "http://localhost:5173,http://localhost:8000,http://127.0.0.1:8000"

    # Base URL used in password reset links.
    public_url: str = "http://localhost:8000"

    session_cookie_name: str = "gn_session"
    session_days: int = 30
    cookie_secure: bool = False  # set true behind HTTPS in production

    # Where uploaded files live: "local" (a folder, for development) or "database"
    # (inside PostgreSQL, for free hosts that have no persistent disk).
    storage_backend: str = "local"
    upload_dir: Path = BACKEND_DIR / "uploads"
    max_image_bytes: int = 15 * 1024 * 1024  # animated GIF banners are often large
    max_file_bytes: int = 20 * 1024 * 1024

    # Optional SMTP for password reset emails. If unset, reset links are written to the server log.
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None

    # Directory holding the built frontend (served by the backend in production / desktop app).
    frontend_dist: Path = BACKEND_DIR.parent / "frontend" / "dist"
    # The public website (landing page) served at "/".
    site_dir: Path = BACKEND_DIR / "site"
    # Folder holding GeorgesNappies-Setup.exe for the website's download button.
    downloads_dir: Path = BACKEND_DIR / "downloads"
    # Optional: send the download button to an external URL (e.g. a GitHub release asset) instead.
    download_url: str | None = None
    download_zip_url: str | None = None

    # Set automatically by Render (e.g. https://nappies.onrender.com).
    render_external_url: str | None = None

    @field_validator("database_url")
    @classmethod
    def _asyncpg_url(cls, v: str) -> str:
        # Hosting providers hand out "postgres://..." URLs; SQLAlchemy needs the asyncpg driver name.
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                v = "postgresql+asyncpg://" + v[len(prefix):]
                break
        # Neon/other hosts add libpq options asyncpg doesn't accept; keep TLS required.
        from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

        parts = urlsplit(v)
        params = dict(parse_qsl(parts.query))
        sslmode = params.pop("sslmode", None)
        params.pop("channel_binding", None)
        if sslmode and sslmode != "disable":
            params["ssl"] = "require"
        return urlunsplit(parts._replace(query=urlencode(params)))

    @model_validator(mode="after")
    def _hosted_defaults(self):
        if self.render_external_url:
            ext = self.render_external_url.rstrip("/")
            if ext not in self.allowed_origins:
                self.allowed_origins = f"{self.allowed_origins},{ext}"
            if self.public_url.startswith("http://localhost"):
                self.public_url = ext
        return self

    @property
    def origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
