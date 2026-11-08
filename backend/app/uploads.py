"""Upload validation and storage.

- Size limits are enforced while streaming, before anything touches disk.
- Images are identified by decoding them with Pillow, never by the client's filename or
  Content-Type. Static images are re-encoded (dropping EXIF/GPS metadata and any payload
  appended to the file); animated GIFs are re-saved frame by frame so they stay animated.
- Stored files get random names; the original filename is only kept as display metadata.
"""
import io
import secrets
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, ImageSequence, UnidentifiedImageError

from .config import get_settings

Image.MAX_IMAGE_PIXELS = 40_000_000  # decompression-bomb guard

# Non-image attachments we accept, checked by magic bytes. Served as downloads only.
_FILE_SIGNATURES = {
    b"%PDF-": ("application/pdf", ".pdf"),
    b"PK\x03\x04": ("application/zip", ".zip"),
}


async def read_limited(file: UploadFile, limit: int) -> bytes:
    buf = bytearray()
    while chunk := await file.read(64 * 1024):
        buf.extend(chunk)
        if len(buf) > limit:
            raise HTTPException(413, f"File is too large (max {limit // (1024 * 1024)} MB).")
    if not buf:
        raise HTTPException(400, "The file is empty.")
    return bytes(buf)


def _dir(sub: str) -> Path:
    d = get_settings().upload_dir / sub
    d.mkdir(parents=True, exist_ok=True)
    return d


def process_image(data: bytes, max_side: int, allow_animation: bool = True) -> tuple[bytes, str, str, int, int]:
    """Validate and re-encode an image. Returns (bytes, mime, ext, width, height)."""
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()
        img = Image.open(io.BytesIO(data))
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError):
        raise HTTPException(415, "That file isn't a supported image (PNG, JPEG, WebP or GIF).") from None
    fmt = (img.format or "").upper()
    if fmt not in {"PNG", "JPEG", "WEBP", "GIF"}:
        raise HTTPException(415, "That file isn't a supported image (PNG, JPEG, WebP or GIF).")

    out = io.BytesIO()
    if fmt == "GIF" and allow_animation and getattr(img, "is_animated", False):
        frames, durations = [], []
        for i, frame in enumerate(ImageSequence.Iterator(img)):
            if i >= 300:
                break
            f = frame.convert("RGBA")
            f.thumbnail((max_side, max_side))
            frames.append(f)
            durations.append(frame.info.get("duration", 80))
        frames[0].save(out, format="GIF", save_all=True, append_images=frames[1:], duration=durations, loop=0, disposal=2)
        w, h = frames[0].size
        return out.getvalue(), "image/gif", ".gif", w, h

    img = ImageOps.exif_transpose(img)
    img.thumbnail((max_side, max_side))
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        img.save(out, format="PNG", optimize=True)
        mime, ext = "image/png", ".png"
    else:
        img = img.convert("RGB")
        img.save(out, format="JPEG", quality=88, optimize=True)
        mime, ext = "image/jpeg", ".jpg"
    return out.getvalue(), mime, ext, img.width, img.height


_MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".txt": "text/plain",
}


def _mime_for(key: str) -> str:
    return _MIME_BY_EXT.get(Path(key).suffix.lower(), "application/octet-stream")


def _local_path(key: str) -> Path | None:
    base = get_settings().upload_dir.resolve()
    p = (base / key).resolve()
    return p if base in p.parents else None


def _use_db() -> bool:
    return get_settings().storage_backend == "database"


async def save(sub: str, data: bytes, ext: str) -> str:
    """Store a file under a new random key and return the key (e.g. "avatars/ab12….png")."""
    key = f"{sub}/{secrets.token_hex(16)}{ext}"
    if _use_db():
        from .db import SessionLocal
        from .models import StoredFile

        async with SessionLocal() as s:
            s.add(StoredFile(key=key, content_type=_mime_for(key), size=len(data), data=data))
            await s.commit()
    else:
        _dir(sub)
        _local_path(key).write_bytes(data)
    return key


async def remove(key: str | None) -> None:
    if not key:
        return
    if _use_db():
        from sqlalchemy import delete

        from .db import SessionLocal
        from .models import StoredFile

        async with SessionLocal() as s:
            await s.execute(delete(StoredFile).where(StoredFile.key == key))
            await s.commit()
    else:
        p = _local_path(key)
        if p and p.is_file():
            p.unlink(missing_ok=True)


async def read(key: str) -> tuple[bytes, str]:
    """Return (contents, content type) for a stored key, or raise 404."""
    if _use_db():
        from .db import SessionLocal
        from .models import StoredFile

        async with SessionLocal() as s:
            f = await s.get(StoredFile, key)
            if not f:
                raise HTTPException(404, "Not found.")
            return f.data, f.content_type
    p = _local_path(key)
    if not p or not p.is_file():
        raise HTTPException(404, "Not found.")
    return p.read_bytes(), _mime_for(key)


def sniff_file(data: bytes, filename: str) -> tuple[str, str]:
    for sig, (mime, ext) in _FILE_SIGNATURES.items():
        if data.startswith(sig):
            return mime, ext
    if filename.lower().endswith(".txt"):
        try:
            data.decode("utf-8")
            return "text/plain", ".txt"
        except UnicodeDecodeError:
            pass
    raise HTTPException(415, "Only images, PDF, ZIP and plain-text files can be shared.")

