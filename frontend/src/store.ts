import { create } from "zustand";
import { api, qs } from "./lib/api";
import type { Conversation, Friend, FriendRequest, Me, Message, PublicUser } from "./lib/types";

export type View = "chats" | "friends" | "settings";

interface MsgState {
  items: Message[];
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
}

interface Toast {
  id: number;
  text: string;
  tone?: "default" | "error" | "success";
}

interface State {
  me: Me | null;
  authChecked: boolean;
  view: View;
  activeId: number | null;
  conversations: Record<number, Conversation>;
  convsLoaded: boolean;
  messages: Record<number, MsgState>;
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  typing: Record<number, Record<number, number>>; // conv -> user -> expiry ms
  /** Ids of messages that arrived live and should play their entrance/reveal once. */
  fresh: Record<number, true>;
  connection: "connecting" | "open" | "closed";
  toasts: Toast[];
  profileUserId: number | null;
  modal: null | { kind: "newGroup" } | { kind: "forward"; message: Message } | { kind: "groupInfo"; conversationId: number };

  setMe: (me: Me | null) => void;
  setView: (v: View) => void;
  /** Which Friends tab to show; the sidebar "+" opens "add". */
  friendsTab: "all" | "online" | "pending" | "blocked" | "add";
  openAddFriend: () => void;
  openConversation: (id: number | null) => void;
  loadConversations: () => Promise<void>;
  upsertConversation: (c: Conversation) => void;
  removeConversation: (id: number) => void;
  loadMessages: (convId: number, older?: boolean) => Promise<void>;
  addMessage: (m: Message, opts?: { fresh?: boolean; clientId?: string | null }) => void;
  updateMessage: (m: Message) => void;
  failPending: (convId: number, clientId: string) => void;
  loadFriends: () => Promise<void>;
  setTyping: (convId: number, userId: number, typing: boolean) => void;
  patchUser: (u: Partial<PublicUser> & { id: number }) => void;
  toast: (text: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
  showProfile: (id: number | null) => void;
  setModal: (m: State["modal"]) => void;
  reset: () => void;
}

let toastSeq = 1;

const initial = {
  me: null,
  view: "chats" as View,
  activeId: null,
  conversations: {},
  convsLoaded: false,
  messages: {},
  friends: [],
  incoming: [],
  outgoing: [],
  typing: {},
  fresh: {},
  connection: "connecting" as const,
  toasts: [],
  profileUserId: null,
  modal: null,
};

export const useStore = create<State>((set, get) => ({
  ...initial,
  authChecked: false,

  setMe: (me) => set({ me, authChecked: true }),
  setView: (view) => set(view === "friends" ? { view, friendsTab: "all" } : { view }),
  friendsTab: "all",
  openAddFriend: () => set({ view: "friends", friendsTab: "add" }),
  openConversation: (id) => set({ activeId: id, view: "chats" }),

  loadConversations: async () => {
    const { conversations } = await api.get<{ conversations: Conversation[] }>("/api/conversations");
    const map: Record<number, Conversation> = {};
    for (const c of conversations) map[c.id] = c;
    set({ conversations: map, convsLoaded: true });
  },

  upsertConversation: (c) => set((s) => ({ conversations: { ...s.conversations, [c.id]: c } })),

  removeConversation: (id) =>
    set((s) => {
      const conversations = { ...s.conversations };
      delete conversations[id];
      return { conversations, activeId: s.activeId === id ? null : s.activeId };
    }),

  loadMessages: async (convId, older = false) => {
    const cur = get().messages[convId];
    if (cur?.loading || (older && !cur?.hasMore)) return;
    set((s) => ({ messages: { ...s.messages, [convId]: { items: cur?.items ?? [], hasMore: cur?.hasMore ?? true, loaded: cur?.loaded ?? false, loading: true } } }));
    const before = older ? cur?.items.find((m) => !m.pending)?.id : undefined;
    try {
      const res = await api.get<{ messages: Message[]; has_more: boolean }>(`/api/conversations/${convId}/messages${qs({ before, limit: 50 })}`);
      set((s) => {
        const existing = s.messages[convId]?.items ?? [];
        const byId = new Map<number, Message>();
        for (const m of existing) if (!m.pending) byId.set(m.id, m);
        for (const m of res.messages) byId.set(m.id, m);
        const pending = existing.filter((m) => m.pending || m.failed);
        const items = [...byId.values()].sort((a, b) => a.id - b.id).concat(pending);
        return {
          messages: {
            ...s.messages,
            [convId]: { items, hasMore: older || !s.messages[convId]?.loaded ? res.has_more : s.messages[convId].hasMore, loaded: true, loading: false },
          },
        };
      });
    } catch (e) {
      set((s) => ({ messages: { ...s.messages, [convId]: { ...s.messages[convId], loading: false } } }));
      throw e;
    }
  },

  addMessage: (m, opts) =>
    set((s) => {
      const st = s.messages[m.conversation_id];
      const conv = s.conversations[m.conversation_id];
      let next = s.messages;
      if (st) {
        let items = st.items.filter((x) => !(opts?.clientId && x.client_id === opts.clientId));
        if (!items.some((x) => x.id === m.id)) {
          items = [...items.filter((x) => !x.pending && !x.failed), m, ...items.filter((x) => x.pending || x.failed)];
        }
        next = { ...s.messages, [m.conversation_id]: { ...st, items } };
      }
      const conversations = conv
        ? {
            ...s.conversations,
            [conv.id]: {
              ...conv,
              last_message: m.pending ? conv.last_message : m,
              last_message_at: m.pending ? conv.last_message_at : m.created_at,
              unread_count:
                m.sender_id !== s.me?.id && m.kind === "text" && !m.pending && !(s.activeId === conv.id && document.hasFocus())
                  ? conv.unread_count + 1
                  : conv.unread_count,
            },
          }
        : s.conversations;
      return { messages: next, conversations, fresh: opts?.fresh ? { ...s.fresh, [m.id]: true } : s.fresh };
    }),

  updateMessage: (m) =>
    set((s) => {
      const st = s.messages[m.conversation_id];
      const conv = s.conversations[m.conversation_id];
      return {
        messages: st ? { ...s.messages, [m.conversation_id]: { ...st, items: st.items.map((x) => (x.id === m.id ? m : x)) } } : s.messages,
        conversations:
          conv && conv.last_message?.id === m.id ? { ...s.conversations, [conv.id]: { ...conv, last_message: m } } : s.conversations,
      };
    }),

  failPending: (convId, clientId) =>
    set((s) => {
      const st = s.messages[convId];
      if (!st) return {};
      return { messages: { ...s.messages, [convId]: { ...st, items: st.items.map((x) => (x.client_id === clientId ? { ...x, pending: false, failed: true } : x)) } } };
    }),

  loadFriends: async () => {
    const r = await api.get<{ friends: Friend[]; incoming: FriendRequest[]; outgoing: FriendRequest[] }>("/api/friends");
    set({ friends: r.friends, incoming: r.incoming, outgoing: r.outgoing });
  },

  setTyping: (convId, userId, typing) =>
    set((s) => {
      const cur = { ...(s.typing[convId] ?? {}) };
      if (typing) cur[userId] = Date.now() + 6000;
      else delete cur[userId];
      return { typing: { ...s.typing, [convId]: cur } };
    }),

  patchUser: (u) =>
    set((s) => {
      const conversations: Record<number, Conversation> = {};
      for (const [id, c] of Object.entries(s.conversations)) {
        conversations[Number(id)] = c.members.some((m) => m.id === u.id) ? { ...c, members: c.members.map((m) => (m.id === u.id ? { ...m, ...u } : m)) } : c;
      }
      return {
        conversations,
        friends: s.friends.map((f) => (f.id === u.id ? { ...f, ...u } : f)),
        me: s.me && s.me.id === u.id ? { ...s.me, ...u } : s.me,
      };
    }),

  toast: (text, tone = "default") => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone }] }));
    setTimeout(() => get().dismissToast(id), 3800);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  showProfile: (profileUserId) => set({ profileUserId }),
  setModal: (modal) => set({ modal }),
  reset: () => set({ ...initial, authChecked: true }),
}));

/** Helpers */
export function convTitle(c: Conversation, meId: number | undefined) {
  if (c.kind === "group") return c.name || "Group";
  const other = c.members.find((m) => m.id !== meId);
  return other?.display_name ?? "Conversation";
}

export function otherMember(c: Conversation, meId: number | undefined) {
  return c.kind === "direct" ? c.members.find((m) => m.id !== meId) : undefined;
}
