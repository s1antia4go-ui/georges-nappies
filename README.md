# Nappies

A real-time messaging app: private chats, group chats and a friends system, with a clean
black-and-white interface. Comes with its own website (nappies.com branding) where people download the Windows app or sign up in the browser. Made by Santiago Rojas.

## Using the desktop app

1. Make sure PostgreSQL is running (it starts automatically with Windows once installed).
2. Double-click `Nappies.exe`. It starts its built-in server and opens the app.
   - Windows SmartScreen may warn because the app isn't code-signed: **More info → Run anyway**.
3. Create an account (pick a permanent username), then tap **+** to add friends by username.

Closing the window also stops the built-in server.

> **Friends on other computers:** right now the server runs on *this* PC, so only people using
> this PC (or your local network, if you open it up) can connect. To chat with friends anywhere,
> host the backend on a server with HTTPS and point the app at it via **File → Server address…**.

## Website

The server hosts three things at one address:

| Path | What |
|---|---|
| `/` | The public website: white, minimal landing page with **Download for Windows** and **Sign up**. Source: `backend/site/` |
| `/app/` | The web app (`/app/#signup` opens sign-up directly) |
| `/download/windows` | Serves `Nappies.exe` from the downloads folder (`backend/downloads/` in development, `%LOCALAPPDATA%\Nappies\downloads` for the packaged server) |

The app starts empty: no bots or sample chats. Everyone signs up with their own username first.

## Features

| Area | What works |
|---|---|
| Accounts | Register, log in/out, forgot/reset password, change email/password, see & sign out other devices, delete account |
| Usernames | Single word, globally unique (DB constraint), live availability check, look-alike protection (`Ge0rge` ≠ `George`), reserved/abusive names blocked, permanently reserved even after deletion |
| Profiles | Display name, bio, profile picture & banner (animated GIFs supported), banner shade, **Member since** date (set by the server at registration, never editable) |
| Friends | Search by exact username, send/accept/decline/cancel requests, duplicate & self requests rejected, remove, favourite, block, report, recent searches |
| Status | Online (solid green), Idle (green ring), Invisible (grey ring; appear offline), last-seen time |
| Messaging | 1:1 and group chats over WebSockets: send, edit, delete, reply, react, forward, pin, search history, attachments (images/PDF/ZIP/text) |
| Live signals | Typing indicators, delivered/read receipts, unread badges, presence, desktop notifications & sound |
| Groups | Create, rename, group photo, add/remove members, leave, admins, new members don't see older history |
| Animation | Messages slide in; received text reveals as if typed (visual only: the full message is delivered instantly). Settings: Animated / Off / Reduced motion; OS reduced-motion respected |
| Appearance | Light / dark / automatic, text size, Enter-to-send |
| Privacy | Hide from search, refuse requests, turn off read receipts, hide online status |

## Architecture

```
frontend/   React 18 + TypeScript + Tailwind (Vite). Zustand store, WebSocket client.
backend/    Python FastAPI, SQLAlchemy (async) + asyncpg, PostgreSQL 17.
desktop/    Electron shell that starts the packaged backend and loads the app.
```

- REST for every write (validated, rate-limited, stored, then broadcast); one WebSocket per window for
  events (`message.new`, `typing`, `receipt`, `presence`, …).
- The backend serves the built frontend, so the browser and desktop app use a single origin.

### Database tables
`users`, `username_reservations` (permanent), `sessions`, `password_resets`, `friendships`
(one row per pair, `user_a < user_b`), `friend_requests` (partial unique index: one pending request
per pair), `favorites`, `blocks`, `reports`, `search_history`, `conversations` (unique `direct_key`
per DM pair), `conversation_members` (read/delivered pointers), `messages`, `reactions`, `attachments`.

## Security

- Passwords hashed with **Argon2id**; login timing is equal for unknown users.
- Sessions: random 256-bit tokens in **HttpOnly, SameSite=Lax** cookies; only their SHA-256 is stored.
  Password reset/change signs out other sessions.
- CSRF and cross-site WebSocket protection via an Origin allow-list; strict security headers + CSP.
- Every conversation/message/attachment endpoint checks membership (404 for non-members).
- Server-side validation on all input; rate limits on login, registration, reset, search, sending, uploads.
- Uploads: size-limited while streaming, images decoded and re-encoded (metadata stripped),
  other files checked by magic bytes, random file names, served with `nosniff` + sandbox CSP.
- Secrets live only in `backend/.env` / `%LOCALAPPDATA%\Nappies\server.env`; the database user is a
  non-superuser that owns only this app's databases.
- **Messages are not end-to-end encrypted.** They're protected in transit when served over HTTPS and
  readable only by conversation members, but stored in plaintext on the server. The schema has an
  `encryption` column so a reviewed protocol (e.g. MLS / Signal) can be added later.

## Development

Requirements: Python 3.13, Node.js 20+, PostgreSQL 17.

```bash
# backend (venv kept on a short path to avoid Windows path-length limits)
python -m venv %LOCALAPPDATA%\GeorgesNappies\venv
%LOCALAPPDATA%\GeorgesNappies\venv\Scripts\pip install -r backend/requirements.txt
copy backend\.env.example backend\.env   # then fill in DATABASE_URL etc.
```

```bash
# run the API (port 8000)
cd backend && %LOCALAPPDATA%\GeorgesNappies\venv\Scripts\python -m uvicorn app.main:app --port 8000
```

```bash
# frontend dev server (port 5173, proxies /api and /ws to 8000)
cd frontend && npm install && npm run dev
```

```bash
# tests: real PostgreSQL test database (TEST_DATABASE_URL), includes the acceptance tests
cd backend && %LOCALAPPDATA%\GeorgesNappies\venv\Scripts\python -m pytest
```

Password-reset emails go to the server log unless `SMTP_*` settings are filled in.

### Building the .exe

1. `cd frontend && npm run build`
2. Server: from `backend/`, run PyInstaller on `server_main.py` with `--onefile --add-data "<frontend/dist>;frontend_dist"`
   (plus `--collect-all asyncpg --collect-all argon2 --collect-submodules uvicorn --collect-submodules app`).
3. Copy `NappiesServer.exe` into `desktop/resources/`, then in `desktop/`: `npm install && npm run dist`.
   Build from a short path (e.g. `%LOCALAPPDATA%\GeorgesNappies\desktop-build`).
4. The packaged server reads `%LOCALAPPDATA%\Nappies\server.env` (same keys as `.env.example`).

## Put it online (Render)

`Dockerfile` + `render.yaml` deploy the website, web app, API and WebSockets as one service, with a
managed PostgreSQL database and a 1 GB disk for uploads.

1. Push this folder to a GitHub repository.
2. In Render: **New → Blueprint**, choose the repository, **Apply**. (Starter web service ~$7/month +
   basic database ~$6/month.)
3. When it's live, the site is at `https://<service-name>.onrender.com`. Render sets
   `RENDER_EXTERNAL_URL`, which the app uses for allowed origins and reset links automatically.
4. Build the online desktop app: add `"serverUrl": "https://<service-name>.onrender.com"` to
   `desktop/package.json`, leave out the bundled server, and run `npm run dist`. Upload the installer
   to a GitHub release and set `DOWNLOAD_URL` in Render to its link so the website's button serves it.

Password-reset emails need `SMTP_*` settings in Render; without them, reset links aren't sent in production.

## Production notes

Serve behind HTTPS (set `COOKIE_SECURE=true`, `ALLOWED_ORIGINS`, `PUBLIC_URL`), configure SMTP, and for
several server processes move the in-memory rate limiter and WebSocket fan-out to Redis or Postgres
LISTEN/NOTIFY (the code is structured for this). Use Alembic for schema migrations once data matters.
