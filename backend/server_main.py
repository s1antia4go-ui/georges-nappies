"""Entry point for the packaged server (NappiesServer.exe).

Configuration is read from %LOCALAPPDATA%\\Nappies\\server.env (same keys as
backend/.env.example), never from inside the executable. Uploads are stored in
%LOCALAPPDATA%\\Nappies\\uploads.
"""
import os
import sys
from pathlib import Path


def _load_env(path: Path) -> None:
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def main() -> None:
    data_dir = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Nappies"
    data_dir.mkdir(parents=True, exist_ok=True)
    # Running in the background with no console: send output to a log file.
    if sys.stdout is None or sys.stderr is None:
        log = open(data_dir / "server.log", "a", encoding="utf-8", buffering=1)  # noqa: SIM115
        sys.stdout = sys.stdout or log
        sys.stderr = sys.stderr or log
    env_file = data_dir / "server.env"
    if not env_file.exists():
        sys.stderr.write(f"Missing configuration file: {env_file}\nCopy backend/.env.example there and fill it in.\n")
        sys.exit(2)
    _load_env(env_file)
    os.environ.setdefault("UPLOAD_DIR", str(data_dir / "uploads"))
    bundle = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
    dist = bundle / "frontend_dist" if hasattr(sys, "_MEIPASS") else bundle / "frontend" / "dist"
    os.environ.setdefault("FRONTEND_DIST", str(dist))
    os.environ.setdefault("SITE_DIR", str(bundle / "site" if hasattr(sys, "_MEIPASS") else bundle / "backend" / "site"))
    os.environ.setdefault("DOWNLOADS_DIR", str(data_dir / "downloads"))

    import uvicorn

    from app.main import app

    port = int(os.environ.get("PORT", "8000"))
    # Listens on this PC only. Remote access goes through Tailscale Serve (a local HTTPS proxy),
    # so trust forwarded client IPs from 127.0.0.1 only.
    uvicorn.run(
        app,
        host=os.environ.get("HOST", "127.0.0.1"),
        port=port,
        log_level="info",
        proxy_headers=True,
        forwarded_allow_ips="127.0.0.1",
    )


if __name__ == "__main__":
    main()
