"""Copy uploaded files from a local uploads folder into the `stored_files` table of a database.

Used once when moving George's Nappies to cloud hosting (STORAGE_BACKEND=database).
The local folder is only read, never modified. Re-running is safe: existing keys are skipped.

Usage:
    python scripts/copy_uploads_to_db.py <uploads folder> <target DATABASE_URL>
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


async def main(folder: Path, target_url: str) -> None:
    import os

    os.environ["DATABASE_URL"] = target_url
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.config import Settings
    from app.db import Base
    from app.models import StoredFile
    from app.uploads import _mime_for

    url = Settings(database_url=target_url).database_url
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)  # ensures stored_files exists
    Session = async_sessionmaker(engine, expire_on_commit=False)

    copied = skipped = 0
    async with Session() as s:
        for path in sorted(p for p in folder.rglob("*") if p.is_file()):
            key = path.relative_to(folder).as_posix()
            if await s.get(StoredFile, key):
                skipped += 1
                continue
            data = path.read_bytes()
            s.add(StoredFile(key=key, content_type=_mime_for(key), size=len(data), data=data))
            copied += 1
        await s.commit()
    await engine.dispose()
    print(f"copied {copied} file(s), skipped {skipped} already present")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    asyncio.run(main(Path(sys.argv[1]), sys.argv[2]))
