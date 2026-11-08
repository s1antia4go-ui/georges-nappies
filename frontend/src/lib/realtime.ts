import { convTitle, useStore } from "../store";
import type { Conversation, Message, PublicUser } from "./types";
import { notify } from "./notify";

/**
 * WebSocket client: reconnects with backoff, re-syncs state after reconnecting,
 * and turns server events into store updates. Messages are always sent over REST.
 */
let ws: WebSocket | null = null;
let retry = 0;
let stopped = true;
let pingTimer: number | undefined;
let reconnectTimer: number | undefined;

export function sendWs(data: object) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

export function startRealtime() {
  stopped = false;
  connect();
}

export function stopRealtime() {
  stopped = true;
  clearTimeout(reconnectTimer);
  clearInterval(pingTimer);
  ws?.close();
  ws = null;
}

function connect() {
  if (stopped) return;
  const st = useStore.getState();
  useStore.setState({ connection: "connecting" });
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  const sock = new WebSocket(url);
  ws = sock;

  sock.onopen = () => {
    retry = 0;
    useStore.setState({ connection: "open" });
    clearInterval(pingTimer);
    pingTimer = window.setInterval(() => sendWs({ type: "ping" }), 25000);
    // Catch up on anything missed while disconnected.
    st.loadConversations().catch(() => {});
    st.loadFriends().catch(() => {});
    const active = useStore.getState().activeId;
    if (active) useStore.getState().loadMessages(active).catch(() => {});
  };

  sock.onmessage = (e) => {
    try {
      handle(JSON.parse(e.data));
    } catch (err) {
      console.error("bad event", err);
    }
  };

  sock.onclose = (e) => {
    clearInterval(pingTimer);
    if (ws !== sock) return;
    ws = null;
    useStore.setState({ connection: "closed", typing: {} });
    if (e.code === 4001) {
      window.dispatchEvent(new Event("gn:unauthorized"));
      return;
    }
    if (!stopped) {
      const delay = Math.min(15000, 500 * 2 ** retry++) + Math.random() * 400;
      reconnectTimer = window.setTimeout(connect, delay);
    }
  };
}

/** Called when a conversation is on screen and the window is focused. */
export function markRead(convId: number) {
  const s = useStore.getState();
  const items = s.messages[convId]?.items ?? [];
  const last = [...items].reverse().find((m) => !m.pending && !m.failed);
  const conv = s.conversations[convId];
  if (!last || !conv) return;
  if (conv.unread_count > 0 || last.sender_id !== s.me?.id) {
    sendWs({ type: "read", conversation_id: convId, message_id: last.id });
    useStore.setState({ conversations: { ...s.conversations, [convId]: { ...conv, unread_count: 0 } } });
  }
}

function handle(ev: any) {
  const s = useStore.getState();
  switch (ev.type) {
    case "message.new": {
      const m: Message = ev.message;
      const mine = m.sender_id === s.me?.id;
      if (!s.conversations[m.conversation_id]) {
        s.loadConversations().catch(() => {});
      }
      s.addMessage(m, { fresh: true, clientId: mine ? ev.client_id : null });
      if (!mine) {
        s.setTyping(m.conversation_id, m.sender_id ?? 0, false);
        const viewing = s.activeId === m.conversation_id && document.visibilityState === "visible" && document.hasFocus();
        if (viewing) markRead(m.conversation_id);
        else sendWs({ type: "delivered", conversation_id: m.conversation_id, message_id: m.id });
        const conv = useStore.getState().conversations[m.conversation_id];
        if (conv && !conv.muted && !viewing && m.kind === "text") {
          const sender = conv.members.find((x) => x.id === m.sender_id);
          notify(conv.kind === "group" ? `${sender?.display_name ?? "Someone"} in ${convTitle(conv, s.me?.id)}` : sender?.display_name ?? "New message",
            m.body || (m.attachment ? "Sent an attachment" : ""), () => s.openConversation(conv.id));
        }
      }
      break;
    }
    case "message.updated":
      s.updateMessage(ev.message);
      break;
    case "typing":
      if (ev.user_id !== s.me?.id) s.setTyping(ev.conversation_id, ev.user_id, ev.typing);
      break;
    case "receipt": {
      const c = s.conversations[ev.conversation_id];
      if (!c) break;
      s.upsertConversation({
        ...c,
        members: c.members.map((m) =>
          m.id === ev.user_id ? { ...m, last_delivered_id: ev.last_delivered_id, last_read_id: ev.last_read_id ?? m.last_read_id } : m,
        ),
      });
      break;
    }
    case "read.self": {
      const c = s.conversations[ev.conversation_id];
      if (c) s.upsertConversation({ ...c, unread_count: 0 });
      break;
    }
    case "presence": {
      s.patchUser({ id: ev.user_id, presence: ev.presence, last_seen_at: ev.last_seen_at });
      if (ev.presence === "offline") {
        // A dropped connection ends any typing indicator from that person.
        const typing = { ...s.typing };
        for (const k of Object.keys(typing)) {
          if (typing[+k][ev.user_id]) {
            typing[+k] = { ...typing[+k] };
            delete typing[+k][ev.user_id];
          }
        }
        useStore.setState({ typing });
      }
      break;
    }
    case "user.updated":
      s.patchUser(ev.user as PublicUser);
      break;
    case "conversation.new":
    case "conversation.updated": {
      const c: Conversation = ev.conversation;
      s.upsertConversation(c);
      break;
    }
    case "conversation.removed":
      s.removeConversation(ev.conversation_id);
      break;
    case "friend.request":
      s.loadFriends().catch(() => {});
      s.toast(`${ev.request.user.display_name} sent you a friend request`);
      if (s.me?.preferences.notify_friend_requests !== false) notify("Friend request", `@${ev.request.user.username} wants to be friends`, () => s.setView("friends"));
      break;
    case "friend.accepted":
      s.loadFriends().catch(() => {});
      s.toast(`${ev.user.display_name} accepted your friend request`, "success");
      break;
    case "friends.changed":
      s.loadFriends().catch(() => {});
      break;
  }
}

// Free hosting plans sleep after ~15 minutes without HTTP traffic. While someone has the
// app open, a tiny health check every 9 minutes keeps the server awake for them.
setInterval(() => {
  if (useStore.getState().me) fetch("/api/health", { credentials: "same-origin" }).catch(() => {});
}, 9 * 60 * 1000);

// Expire stale typing indicators (sender went quiet without a "stop").
setInterval(() => {
  const { typing } = useStore.getState();
  const now = Date.now();
  let changed = false;
  const next: typeof typing = {};
  for (const [cid, users] of Object.entries(typing)) {
    const kept: Record<number, number> = {};
    for (const [uid, exp] of Object.entries(users)) {
      if (exp > now) kept[+uid] = exp;
      else changed = true;
    }
    next[+cid] = kept;
  }
  if (changed) useStore.setState({ typing: next });
}, 1000);
