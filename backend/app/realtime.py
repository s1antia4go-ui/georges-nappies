"""WebSocket hub: tracks live connections, presence and typing state, and fans out events.

State is per server process. To run several backend processes, publish events through
Postgres LISTEN/NOTIFY or Redis pub/sub and have each process deliver to its own sockets;
the `send_to_users` call sites don't need to change.
"""
import asyncio
import json
import logging
from collections import defaultdict

from fastapi import WebSocket

log = logging.getLogger("realtime")


class Hub:
    def __init__(self) -> None:
        self.sockets: dict[int, set[WebSocket]] = defaultdict(set)
        # Last known (status, show_presence) of connected users, for presence calculation.
        self.status: dict[int, tuple[str, bool]] = {}
        # user_id -> conversation ids they're currently typing in
        self.typing: dict[int, set[int]] = defaultdict(set)

    def is_connected(self, user_id: int) -> bool:
        return bool(self.sockets.get(user_id))

    def presence(self, user_id: int, status: str | None = None, show_presence: bool | None = None) -> str:
        """What other people see: online | idle | offline. Invisible users look offline."""
        if not self.is_connected(user_id):
            return "offline"
        cached = self.status.get(user_id)
        st = status if status is not None else (cached[0] if cached else "online")
        sp = show_presence if show_presence is not None else (cached[1] if cached else True)
        if st == "invisible" or not sp:
            return "offline"
        return st

    async def connect(self, user_id: int, ws: WebSocket, status: str, show_presence: bool) -> bool:
        """Register a socket. Returns True if this is the user's first live connection."""
        first = not self.is_connected(user_id)
        self.sockets[user_id].add(ws)
        self.status[user_id] = (status, show_presence)
        return first

    def disconnect(self, user_id: int, ws: WebSocket) -> bool:
        """Remove a socket. Returns True if the user now has no live connections."""
        conns = self.sockets.get(user_id)
        if conns:
            conns.discard(ws)
            if not conns:
                del self.sockets[user_id]
                self.status.pop(user_id, None)
                return True
        return False

    async def send_to_users(self, user_ids, event: dict) -> None:
        data = json.dumps(event, default=str)
        targets = [(uid, ws) for uid in set(user_ids) for ws in list(self.sockets.get(uid, ()))]
        if not targets:
            return
        results = await asyncio.gather(*(ws.send_text(data) for _, ws in targets), return_exceptions=True)
        for (uid, ws), res in zip(targets, results):
            if isinstance(res, Exception):
                log.debug("dropping dead socket for user %s: %s", uid, res)
                self.disconnect(uid, ws)

    async def close_user(self, user_id: int, code: int = 4001) -> None:
        for ws in list(self.sockets.get(user_id, ())):
            try:
                await ws.close(code=code)
            except Exception:  # noqa: BLE001
                pass
            self.disconnect(user_id, ws)


hub = Hub()
