import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .db import init_db
from .routers import auth, conversations, friends, users, ws

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    await init_db()
    yield


app = FastAPI(
    title=settings.app_name,
    lifespan=lifespan,
    docs_url="/api/docs" if settings.environment != "production" else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.environment != "production" else None,
)

UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    # CSRF protection: session cookies are SameSite=Lax, and every state-changing API call
    # must come from an allowed Origin (or carry no Origin/Referer, e.g. non-browser clients
    # that hold no cookie).
    if request.method in UNSAFE and request.url.path.startswith("/api/"):
        origin = request.headers.get("origin") or ""
        if origin and origin.rstrip("/") not in settings.origins:
            return JSONResponse({"detail": "Cross-site request blocked."}, status_code=403)
    response = await call_next(request)
    h = response.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("X-Frame-Options", "DENY")
    h.setdefault("Referrer-Policy", "same-origin")
    h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if not request.url.path.startswith("/api/docs"):
        h.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; connect-src 'self' ws: wss:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'",
        )
    if settings.cookie_secure:
        h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


@app.exception_handler(RequestValidationError)
async def validation_handler(_request: Request, exc: RequestValidationError):
    # Turn pydantic errors into one readable sentence for the UI.
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(p) for p in first.get("loc", [])[1:])
    msg = str(first.get("msg", "Invalid input.")).removeprefix("Value error, ")
    if field == "email":
        msg = "Enter a valid email address."
    elif first.get("type") == "string_too_short" and field == "password":
        msg = "Passwords need at least 10 characters."
    return JSONResponse({"detail": f"{field}: {msg}" if field and not msg.endswith(".") else msg, "field": field}, status_code=422)


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(friends.router)
app.include_router(conversations.router)
app.include_router(ws.router)


@app.get("/api/health")
async def health():
    # Open to any origin so the Android app's start screen can tell when the server is awake.
    return JSONResponse({"ok": True}, headers={"Access-Control-Allow-Origin": "*"})


# Windows download for the website's "Download" button.
@app.get("/download/windows", include_in_schema=False)
@app.get("/GeorgesNappies-Setup.exe", include_in_schema=False)
async def download_windows():
    if settings.download_url:
        return RedirectResponse(settings.download_url, status_code=302)
    exe = settings.downloads_dir / "GeorgesNappies-Setup.exe"
    if not exe.is_file():
        return JSONResponse({"detail": "The Windows download isn't available on this server yet."}, status_code=404)
    return FileResponse(exe, media_type="application/vnd.microsoft.portable-executable", filename="GeorgesNappies-Setup.exe")


@app.get("/download/windows-zip", include_in_schema=False)
async def download_windows_zip():
    if settings.download_zip_url:
        return RedirectResponse(settings.download_zip_url, status_code=302)
    z = settings.downloads_dir / "GeorgesNappies-Windows.zip"
    if not z.is_file():
        return JSONResponse({"detail": "The .zip download isn't available on this server yet."}, status_code=404)
    return FileResponse(z, media_type="application/zip", filename="GeorgesNappies-Windows.zip")


def _safe_file(base, path: str):
    candidate = (base / path).resolve()
    if path and base.resolve() in candidate.parents and candidate.is_file():
        return candidate
    return None


# The web app (single-page app), served under /app.
dist = settings.frontend_dist
if dist.is_dir():
    app.mount("/app/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/app", include_in_schema=False)
    @app.get("/app/{path:path}", include_in_schema=False)
    async def spa(path: str = ""):
        found = _safe_file(dist, path)
        if found:
            return FileResponse(found)
        return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})


# The public website (landing page) at the root.
site = settings.site_dir
if site.is_dir():

    @app.get("/{path:path}", include_in_schema=False)
    async def website(path: str):
        if path.startswith(("api/", "ws")):
            return JSONResponse({"detail": "Not found."}, status_code=404)
        found = _safe_file(site, path)
        if found:
            return FileResponse(found)
        return FileResponse(site / "index.html", headers={"Cache-Control": "no-cache"})
