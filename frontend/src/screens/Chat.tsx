import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Composer, retrySend } from "../components/Composer";
import { Icon } from "../components/Icon";
import { MessageRow, TypingIndicator, type Status } from "../components/Message";
import { Avatar, Empty, Spinner } from "../components/ui";
import { api, qs } from "../lib/api";
import { dayLabel, lastSeen, timeOf } from "../lib/format";
import { markRead } from "../lib/realtime";
import type { Conversation, Member, Message } from "../lib/types";
import { convTitle, otherMember, useStore } from "../store";

const GROUP_GAP_MS = 5 * 60 * 1000;

export function Chat({ conv, onBack }: { conv: Conversation; onBack: () => void }) {
  const me = useStore((s) => s.me)!;
  const st = useStore((s) => s.messages[conv.id]);
  const loadMessages = useStore((s) => s.loadMessages);
  const typingMap = useStore((s) => s.typing[conv.id]);
  const showProfile = useStore((s) => s.showProfile);
  const setModal = useStore((s) => s.setModal);
  const toast = useStore((s) => s.toast);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [panel, setPanel] = useState<null | "search" | "pins">(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevHeight = useRef<number | null>(null);

  const members = useMemo(() => new Map<number, Member>(conv.members.map((m) => [m.id, m])), [conv.members]);
  const other = otherMember(conv, me.id);
  const items = st?.items ?? [];

  useEffect(() => {
    setReplyTo(null);
    setEditing(null);
    setPanel(null);
    stick.current = true;
    if (!st?.loaded) loadMessages(conv.id).catch(() => toast("Couldn't load messages.", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id]);

  // Mark as read while the conversation is visible and focused.
  useEffect(() => {
    const tryRead = () => document.visibilityState === "visible" && document.hasFocus() && markRead(conv.id);
    tryRead();
    window.addEventListener("focus", tryRead);
    document.addEventListener("visibilitychange", tryRead);
    return () => {
      window.removeEventListener("focus", tryRead);
      document.removeEventListener("visibilitychange", tryRead);
    };
  }, [conv.id, items.length]);

  // Scroll management: keep pinned to bottom for new messages; preserve position when older pages load.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items, typingMap]);

  const onScroll = useCallback(() => {
    const el = scroller.current!;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = bottom;
    setAtBottom(bottom);
    if (el.scrollTop < 300 && st?.hasMore && !st.loading) {
      prevHeight.current = el.scrollHeight;
      loadMessages(conv.id, true).catch(() => (prevHeight.current = null));
    }
  }, [st?.hasMore, st?.loading, conv.id, loadMessages]);

  const toBottom = () => {
    stick.current = true;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  };

  const jumpTo = async (id: number) => {
    setPanel(null);
    let el = document.getElementById(`msg-${id}`);
    // Load older pages until the message is present (bounded).
    for (let i = 0; !el && i < 20 && useStore.getState().messages[conv.id]?.hasMore; i++) {
      await loadMessages(conv.id, true);
      await new Promise((r) => requestAnimationFrame(r));
      el = document.getElementById(`msg-${id}`);
    }
    if (el) {
      stick.current = false;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlight(id);
      setTimeout(() => setHighlight(null), 1600);
    }
  };

  // Status line (iMessage-style) under my most recent message only.
  const lastMineId = useMemo(() => [...items].reverse().find((m) => m.sender_id === me.id && m.kind === "text")?.id, [items, me.id]);
  const statusFor = (m: Message): { label: string; kind: Status } | null => {
    if (m.id !== lastMineId || m.failed) return null;
    if (m.pending) return { label: "Sending…", kind: "sending" };
    const others = conv.members.filter((x) => x.id !== me.id);
    const readers = others.filter((x) => x.last_read_id !== null && x.last_read_id >= m.id);
    if (conv.kind === "direct") {
      if (readers.length) return { label: "Read", kind: "read" };
      if (others.some((x) => x.last_delivered_id >= m.id)) return { label: "Delivered", kind: "delivered" };
      return { label: "Sent", kind: "sent" };
    }
    if (readers.length === others.length && others.length) return { label: "Read by everyone", kind: "read" };
    if (readers.length) return { label: `Read by ${readers.length}`, kind: "read" };
    if (others.some((x) => x.last_delivered_id >= m.id)) return { label: "Delivered", kind: "delivered" };
    return { label: "Sent", kind: "sent" };
  };

  const typingUsers = Object.keys(typingMap ?? {})
    .map((id) => members.get(Number(id)))
    .filter((u): u is Member => !!u && u.id !== me.id);

  const blockedNote = conv.kind === "direct" && !other ? "This person is no longer on George's Nappies." : null;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-panel">
      {/* Header */}
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line/70 px-3 sm:px-5 backdrop-blur">
        <button className="icon-btn md:hidden -ml-1" onClick={onBack} aria-label="Back">
          <Icon name="back" size={22} />
        </button>
        <button
          className="flex min-w-0 items-center gap-3 rounded-xl py-1 pr-2 text-left hover:bg-ink/[.03] transition-colors"
          onClick={() => (other ? showProfile(other.id) : setModal({ kind: "groupInfo", conversationId: conv.id }))}
        >
          {conv.kind === "group" ? (
            <GroupAvatar conv={conv} size={38} />
          ) : (
            <Avatar name={other?.display_name ?? "?"} url={other?.avatar_url} size={38} presence={other?.presence} seed={other?.id} />
          )}
          <div className="min-w-0">
            <div className="truncate font-display font-semibold leading-tight">{convTitle(conv, me.id)}</div>
            <div className="truncate text-[0.78rem] text-muted">
              {typingUsers.length ? (
                <span className="text-accent anim-fade">typing…</span>
              ) : conv.kind === "group" ? (
                `${conv.members.length} members`
              ) : other?.presence === "online" ? (
                "Online"
              ) : other?.presence === "idle" ? (
                "Idle"
              ) : (
                lastSeen(other?.last_seen_at ?? null)
              )}
            </div>
          </div>
        </button>
        <div className="ml-auto flex items-center gap-0.5">
          <button className={`icon-btn ${panel === "search" ? "!text-accent !bg-accent/10" : ""}`} onClick={() => setPanel(panel === "search" ? null : "search")} title="Search messages">
            <Icon name="search" size={19} />
          </button>
          <button className={`icon-btn ${panel === "pins" ? "!text-accent !bg-accent/10" : ""}`} onClick={() => setPanel(panel === "pins" ? null : "pins")} title="Pinned messages">
            <Icon name="pin" size={19} />
          </button>
          <button className="icon-btn" onClick={() => (other ? showProfile(other.id) : setModal({ kind: "groupInfo", conversationId: conv.id }))} title="Details">
            <Icon name="info" size={19} />
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Messages */}
          <div ref={scroller} onScroll={onScroll} className="scroll flex-1 overflow-y-auto overflow-x-hidden pb-3 pt-2" role="log" aria-label="Messages">
            {st?.loading && st.items.length > 0 && (
              <div className="flex justify-center py-3 text-faint"><Spinner /></div>
            )}
            {!st?.loaded ? (
              <div className="flex h-full items-center justify-center text-faint"><Spinner size={22} /></div>
            ) : (
              <>
                {!st.hasMore && <ConversationStart conv={conv} meId={me.id} />}
                {items.map((m, i) => {
                  const prev = items[i - 1];
                  const next = items[i + 1];
                  const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
                  const joined = (a?: Message, b?: Message) =>
                    !!a && !!b && a.sender_id === b.sender_id && a.kind === "text" && b.kind === "text" &&
                    Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) < GROUP_GAP_MS &&
                    new Date(a.created_at).toDateString() === new Date(b.created_at).toDateString();
                  return (
                    <Fragment key={m.client_id && m.pending ? m.client_id : m.id}>
                      {newDay && (
                        <div className="my-4 flex items-center justify-center">
                          <span className="text-[0.72rem] font-medium text-faint">
                            {dayLabel(m.created_at)} <span className="font-normal">{timeOf(m.created_at)}</span>
                          </span>
                        </div>
                      )}
                      <MessageRow
                        m={m}
                        conv={conv}
                        meId={me.id}
                        members={members}
                        firstInGroup={!joined(prev, m) || newDay}
                        lastInGroup={!joined(m, next)}
                        status={statusFor(m)}
                        onReply={setReplyTo}
                        onEdit={(x) => { setReplyTo(null); setEditing(x); }}
                        onRetry={retrySend}
                        highlighted={highlight === m.id}
                      />
                    </Fragment>
                  );
                })}
                <TypingIndicator users={typingUsers} />
              </>
            )}
          </div>

          {!atBottom && (
            <button onClick={toBottom} className="absolute bottom-24 right-6 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-line bg-panel text-muted shadow-pop anim-pop hover:text-ink" aria-label="Jump to latest">
              <Icon name="send" size={18} className="rotate-180" />
              {conv.unread_count > 0 && <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-accent" />}
            </button>
          )}

          <Composer
            conv={conv}
            replyTo={replyTo}
            editing={editing}
            onCancel={() => { setReplyTo(null); setEditing(null); }}
            onSent={toBottom}
            disabled={blockedNote}
          />
        </div>

        {panel && <SidePanel kind={panel} conv={conv} members={members} meId={me.id} onClose={() => setPanel(null)} onJump={jumpTo} />}
      </div>
    </div>
  );
}

function ConversationStart({ conv, meId }: { conv: Conversation; meId: number }) {
  const other = otherMember(conv, meId);
  return (
    <div className="flex flex-col items-center px-6 pb-6 pt-10 text-center anim-fade">
      {conv.kind === "group" ? (
        <GroupAvatar conv={conv} size={72} />
      ) : (
        <Avatar name={other?.display_name ?? "?"} url={other?.avatar_url} size={72} seed={other?.id} />
      )}
      <h3 className="mt-3 font-display text-lg font-semibold">{convTitle(conv, meId)}</h3>
      <p className="mt-0.5 text-sm text-muted">
        {conv.kind === "group" ? `Group created ${new Date(conv.created_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}` : `This is the beginning of your conversation with @${other?.username}.`}
      </p>
    </div>
  );
}

export function GroupAvatar({ conv, size }: { conv: Conversation; size: number }) {
  if (conv.avatar_url) return <Avatar name={conv.name ?? "Group"} url={conv.avatar_url} size={size} seed={conv.id} />;
  const [a, b] = conv.members.slice(0, 2);
  if (!a || !b) return <Avatar name={conv.name ?? "Group"} size={size} seed={conv.id} />;
  const s = Math.round(size * 0.68);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="absolute left-0 top-0"><Avatar name={a.display_name} url={a.avatar_url} size={s} seed={a.id} /></div>
      <div className="absolute bottom-0 right-0 rounded-full ring-2 ring-panel"><Avatar name={b.display_name} url={b.avatar_url} size={s} seed={b.id} /></div>
    </div>
  );
}

function SidePanel({ kind, conv, members, meId, onClose, onJump }: { kind: "search" | "pins"; conv: Conversation; members: Map<number, Member>; meId: number; onClose: () => void; onJump: (id: number) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Message[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setResults(null);
    if (kind === "pins") {
      setLoading(true);
      api.get<{ messages: Message[] }>(`/api/conversations/${conv.id}/pins`).then((r) => setResults(r.messages)).finally(() => setLoading(false));
    }
  }, [kind, conv.id]);

  useEffect(() => {
    if (kind !== "search") return;
    if (!q.trim()) return setResults(null);
    setLoading(true);
    const t = setTimeout(() => {
      api.get<{ messages: Message[] }>(`/api/conversations/${conv.id}/search${qs({ q: q.trim() })}`)
        .then((r) => setResults(r.messages))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, kind, conv.id]);

  return (
    <aside className="absolute inset-0 z-20 flex flex-col border-l border-line/70 bg-panel lg:static lg:w-[320px] anim-fade">
      <div className="flex h-14 items-center gap-2 px-4">
        <h3 className="font-display font-semibold">{kind === "search" ? "Search" : "Pinned messages"}</h3>
        <button className="icon-btn ml-auto" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
      </div>
      {kind === "search" && (
        <div className="px-4 pb-3">
          <div className="relative">
            <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input autoFocus className="input h-10 pl-9" placeholder="Search this conversation" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      )}
      <div className="scroll flex-1 overflow-y-auto px-2 pb-4">
        {loading && <div className="flex justify-center py-6 text-faint"><Spinner /></div>}
        {!loading && results?.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">{kind === "search" ? "No messages found." : "No pinned messages yet."}</p>}
        {!loading &&
          results?.map((m) => {
            const sender = members.get(m.sender_id ?? 0);
            return (
              <button key={m.id} onClick={() => onJump(m.id)} className="flex w-full gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-ink/[.04] anim-fade">
                <Avatar name={sender?.display_name ?? "?"} url={sender?.avatar_url} size={32} seed={sender?.id} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">{m.sender_id === meId ? "You" : sender?.display_name ?? "Former member"}</span>
                    <span className="ml-auto shrink-0 text-[0.7rem] text-faint">{new Date(m.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="line-clamp-3 text-[0.85rem] text-muted">{m.body || (m.attachment ? "Attachment" : "")}</p>
                </div>
              </button>
            );
          })}
      </div>
    </aside>
  );
}

export function NoChat() {
  return (
    <div className="hidden md:flex flex-1 items-center justify-center bg-panel">
      <Empty icon="chat" title="Your messages" text="Pick a conversation, or tap + to add a friend." />
    </div>
  );
}
