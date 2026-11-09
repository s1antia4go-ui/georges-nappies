import { memo, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { fileSize, timeOf } from "../lib/format";
import { textAnimationOn } from "../lib/theme";
import type { Conversation, Member, Message } from "../lib/types";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { RevealText } from "./RevealText";
import { Avatar } from "./ui";

export const QUICK_REACTIONS = ["❤️", "😂", "👍", "😮", "😢", "🔥"];

export type Status = "sending" | "sent" | "delivered" | "read" | "failed";

interface Props {
  m: Message;
  conv: Conversation;
  meId: number;
  members: Map<number, Member>;
  firstInGroup: boolean;
  lastInGroup: boolean;
  status: { label: string; kind: Status } | null;
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  onRetry: (m: Message) => void;
  highlighted: boolean;
}

export const MessageRow = memo(function MessageRow({ m, conv, meId, members, firstInGroup, lastInGroup, status, onReply, onEdit, onRetry, highlighted }: Props) {
  const mine = m.sender_id === meId;
  const fresh = useStore((s) => !!s.fresh[m.id]);
  const toast = useStore((s) => s.toast);
  const setModal = useStore((s) => s.setModal);
  const showProfile = useStore((s) => s.showProfile);
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState(false);
  // Entrance + reveal play only once, for messages that arrived live.
  const [animateIn] = useState(fresh || !!m.pending);
  const [reveal] = useState(fresh && !mine && textAnimationOn() && m.body.length > 0);
  const sender = m.sender_id ? members.get(m.sender_id) : undefined;
  const isGroup = conv.kind === "group";
  const canAdmin = isGroup && (conv.my_role === "owner" || conv.my_role === "admin");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (fresh) {
      const t = setTimeout(() => {
        const s = useStore.getState();
        if (s.fresh[m.id]) {
          const next = { ...s.fresh };
          delete next[m.id];
          useStore.setState({ fresh: next });
        }
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [fresh, m.id]);

  useEffect(() => {
    if (!menu && !picker) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setMenu(false);
        setPicker(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu, picker]);

  if (m.kind === "system") {
    return (
      <div className="msg-row flex justify-center py-2">
        <span className="text-[0.75rem] text-muted bg-ink/[.04] rounded-full px-3 py-1">{m.body}</span>
      </div>
    );
  }

  const act = async (fn: () => Promise<unknown>) => {
    setMenu(false);
    setPicker(false);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Something went wrong.", "error");
    }
  };

  const toggleReaction = (emoji: string) => {
    const mineReacted = m.reactions.find((r) => r.emoji === emoji)?.user_ids.includes(meId);
    act(() => (mineReacted ? api.del(`/api/messages/${m.id}/reactions?emoji=${encodeURIComponent(emoji)}`) : api.post(`/api/messages/${m.id}/reactions`, { emoji })));
  };

  const radius = mine
    ? `rounded-[20px] ${firstInGroup ? "" : "rounded-tr-[6px]"} ${lastInGroup ? "rounded-br-[6px]" : "rounded-br-[6px]"}`
    : `rounded-[20px] ${firstInGroup ? "" : "rounded-tl-[6px]"} ${lastInGroup ? "rounded-bl-[6px]" : "rounded-bl-[6px]"}`;

  const bubbleColor = m.deleted
    ? "bg-transparent border border-dashed border-line text-muted italic"
    : mine
      ? "bg-accent text-accent-ink"
      : "bg-bubble text-ink";

  const onlyEmoji = !m.deleted && !m.attachment && !m.reply_to && /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\s){1,12}$/u.test(m.body) && !/^[\d#*\s]+$/.test(m.body);
  const reactions = m.reactions.filter((r) => r.user_ids.length > 0);

  return (
    <div
      ref={ref}
      id={`msg-${m.id}`}
      className={`msg-row group/msg relative flex items-end gap-2 px-3 sm:px-6 ${firstInGroup ? "mt-2.5" : "mt-[3px]"} ${mine ? "justify-end" : "justify-start"} ${
        highlighted ? "bg-accent/[.07] transition-colors duration-700" : "transition-colors duration-700"
      }`}
    >
      {!mine && isGroup && (
        <div className="w-8 shrink-0">
          {lastInGroup && sender && (
            <button onClick={() => showProfile(sender.id)} aria-label={`View ${sender.display_name}`}>
              <Avatar name={sender.display_name} url={sender.avatar_url} size={30} seed={sender.id} />
            </button>
          )}
        </div>
      )}

      <div className={`relative flex max-w-[min(78%,560px)] flex-col ${mine ? "items-end" : "items-start"} ${animateIn ? (mine ? "anim-msg-right" : "anim-msg-left") : ""}`}>
        {!mine && isGroup && firstInGroup && sender && <span className="mb-1 ml-3 text-[0.72rem] font-medium text-muted">{sender.display_name}</span>}
        {m.forwarded && !m.deleted && (
          <span className={`mb-1 flex items-center gap-1 text-[0.72rem] text-muted ${mine ? "mr-3" : "ml-3"}`}>
            <Icon name="forward" size={12} /> Forwarded
          </span>
        )}
        {m.reply_to && !m.deleted && (
          <button
            onClick={() => document.getElementById(`msg-${m.reply_to!.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
            className={`mb-[-10px] max-w-full rounded-[16px] bg-ink/[.05] px-3 pb-4 pt-1.5 text-left text-[0.8rem] text-muted ${mine ? "mr-1" : "ml-1"}`}
          >
            <span className="font-medium text-ink/70">{m.reply_to.sender_id === meId ? "You" : members.get(m.reply_to.sender_id ?? 0)?.display_name ?? "Someone"}</span>
            <span className="block truncate max-w-[280px]">{m.reply_to.deleted ? "Deleted message" : m.reply_to.body || (m.reply_to.has_attachment ? "Attachment" : "")}</span>
          </button>
        )}

        <div
          className={
            onlyEmoji
              ? "text-[2.4rem] leading-tight px-1"
              : `relative ${radius} ${bubbleColor} ${m.attachment?.is_image && !m.body ? "p-1" : "px-3.5 py-2"} text-[0.95rem] leading-[1.38] break-words whitespace-pre-wrap ${
                  m.failed ? "opacity-60" : ""
                } ${m.pending ? "opacity-80" : ""} transition-opacity duration-200`
          }
          style={{ wordBreak: "break-word" }}
          onDoubleClick={() => !m.deleted && !m.pending && toggleReaction("❤️")}
        >
          {m.deleted ? (
            "This message was deleted"
          ) : (
            <>
              {m.attachment && <AttachmentView a={m.attachment} mine={mine} hasText={!!m.body} />}
              {m.body && (
                <span className={m.attachment ? "block px-2.5 pb-1 pt-1.5" : ""}>
                  <RevealText text={m.body} animate={reveal} />
                </span>
              )}
            </>
          )}
          {m.pinned_at && !m.deleted && (
            <span className={`absolute -top-2 ${mine ? "-left-2" : "-right-2"} flex h-5 w-5 items-center justify-center rounded-full bg-panel text-accent shadow-soft`} title="Pinned">
              <Icon name="pin" size={11} />
            </span>
          )}
        </div>

        {reactions.length > 0 && (
          <div className={`z-[1] -mt-1.5 flex flex-wrap gap-1 ${mine ? "mr-2 justify-end" : "ml-2"}`}>
            {reactions.map((r) => {
              const reacted = r.user_ids.includes(meId);
              const names = r.user_ids.map((id) => (id === meId ? "You" : members.get(id)?.display_name ?? "Someone")).join(", ");
              return (
                <button
                  key={r.emoji}
                  title={names}
                  onClick={() => toggleReaction(r.emoji)}
                  className={`anim-status flex h-6 items-center gap-1 rounded-full border px-1.5 text-[0.8rem] shadow-sm transition-colors ${
                    reacted ? "border-accent/40 bg-accent/10" : "border-line bg-panel"
                  }`}
                >
                  <span>{r.emoji}</span>
                  {r.user_ids.length > 1 && <span className="text-[0.7rem] font-medium text-muted">{r.user_ids.length}</span>}
                </button>
              );
            })}
          </div>
        )}

        {(m.edited_at || status || m.failed) && (
          <div className={`mt-1 flex items-center gap-1.5 text-[0.7rem] text-faint ${mine ? "mr-1.5" : "ml-1.5"}`}>
            {m.edited_at && !m.deleted && <span>Edited</span>}
            {m.failed ? (
              <button className="flex items-center gap-1 text-danger font-medium" onClick={() => onRetry(m)}>
                <Icon name="alert" size={12} /> Not sent · Retry
              </button>
            ) : (
              status && <StatusLabel status={status} />
            )}
          </div>
        )}

      {/* Hover actions, beside the bubble */}
      {!m.deleted && !m.pending && !m.failed && (
        <div
          className={`absolute top-1/2 -translate-y-1/2 z-10 flex items-center gap-0.5 rounded-full border border-line bg-panel p-0.5 shadow-soft transition-all duration-150 ${
            menu || picker ? "opacity-100" : "pointer-events-none opacity-0 group-hover/msg:pointer-events-auto group-hover/msg:opacity-100"
          } ${mine ? "right-0 sm:right-full sm:mr-2" : "left-0 sm:left-full sm:ml-2"} max-sm:top-auto max-sm:bottom-full max-sm:mb-1 max-sm:translate-y-0`}
        >
          <button className="icon-btn h-7 w-7" title="React" onClick={() => setPicker((p) => !p)}>
            <Icon name="smile" size={16} />
          </button>
          <button className="icon-btn h-7 w-7" title="Reply" onClick={() => onReply(m)}>
            <Icon name="reply" size={16} />
          </button>
          <button className="icon-btn h-7 w-7" title="More" onClick={() => setMenu((v) => !v)}>
            <Icon name="more" size={16} />
          </button>

          {picker && (
            <div className={`absolute bottom-full mb-2 flex gap-0.5 rounded-full border border-line bg-panel p-1 shadow-pop anim-pop ${mine ? "right-0" : "left-0"}`}>
              {QUICK_REACTIONS.map((e) => (
                <button key={e} className="h-9 w-9 rounded-full text-xl transition-transform hover:scale-125 hover:bg-ink/5" onClick={() => toggleReaction(e)}>
                  {e}
                </button>
              ))}
            </div>
          )}
          {menu && (
            <div className={`absolute top-full mt-2 w-48 overflow-hidden rounded-2xl border border-line bg-panel py-1 shadow-pop anim-pop ${mine ? "right-0" : "left-0"}`}>
              <MenuItem icon="reply" label="Reply" onClick={() => { setMenu(false); onReply(m); }} />
              <MenuItem icon="forward" label="Forward" onClick={() => { setMenu(false); setModal({ kind: "forward", message: m }); }} />
              {m.body && <MenuItem icon="file" label="Copy text" onClick={() => act(() => navigator.clipboard.writeText(m.body))} />}
              {(conv.kind === "direct" || canAdmin) && (
                <MenuItem icon="pin" label={m.pinned_at ? "Unpin" : "Pin"} onClick={() => act(() => (m.pinned_at ? api.del(`/api/messages/${m.id}/pin`) : api.post(`/api/messages/${m.id}/pin`)))} />
              )}
              {mine && m.body && <MenuItem icon="edit" label="Edit" onClick={() => { setMenu(false); onEdit(m); }} />}
              {(mine || canAdmin) && (
                <MenuItem
                  icon="trash"
                  label="Delete"
                  danger
                  onClick={() => {
                    if (confirm("Delete this message for everyone?")) act(() => api.del(`/api/messages/${m.id}`));
                    else setMenu(false);
                  }}
                />
              )}
              <div className="px-3 pb-1 pt-1.5 text-[0.7rem] text-faint">{new Date(m.created_at).toLocaleString()}</div>
            </div>
          )}
        </div>
      )}
      </div>
      {lastInGroup && !status && !m.edited_at && (
        <span className={`pointer-events-none absolute bottom-0 text-[0.68rem] text-faint opacity-0 transition-opacity group-hover/msg:opacity-100 ${mine ? "right-1" : "left-1"} translate-y-full`}>
          {timeOf(m.created_at)}
        </span>
      )}
    </div>
  );
});

function MenuItem({ icon, label, onClick, danger }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[0.88rem] hover:bg-ink/5 ${danger ? "text-danger" : ""}`}>
      <Icon name={icon} size={16} />
      {label}
    </button>
  );
}

function StatusLabel({ status }: { status: { label: string; kind: Status } }) {
  return (
    <span key={status.kind} className="anim-status flex items-center gap-1">
      {status.kind === "sending" && <Icon name="clock" size={11} />}
      {status.kind === "sent" && <Icon name="check" size={12} />}
      {status.kind === "delivered" && <Icon name="checks" size={13} />}
      {status.kind === "read" && <Icon name="checks" size={13} className="text-accent" />}
      <span className={status.kind === "read" ? "text-accent font-medium" : ""}>{status.label}</span>
    </span>
  );
}

function AttachmentView({ a, mine, hasText }: { a: NonNullable<Message["attachment"]>; mine: boolean; hasText: boolean }) {
  const [open, setOpen] = useState(false);
  if (a.is_image) {
    const w = Math.min(320, a.width ?? 320);
    const h = a.width && a.height ? Math.round((w / a.width) * a.height) : 200;
    return (
      <>
        <button onClick={() => setOpen(true)} className={`block overflow-hidden ${hasText ? "rounded-[16px]" : "rounded-[17px]"}`}>
          <img src={a.url} alt={a.name} loading="lazy" width={w} height={Math.min(h, 420)} className="max-h-[420px] w-auto object-cover bg-raised" style={{ width: w }} />
        </button>
        {open && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-6 anim-fade" onClick={() => setOpen(false)}>
            <img src={a.url} alt={a.name} className="max-h-full max-w-full rounded-xl shadow-pop anim-pop" />
            <a href={`${a.url}?download=true`} onClick={(e) => e.stopPropagation()} className="absolute right-5 top-5 btn-soft !bg-white/10 !text-white">
              <Icon name="download" size={16} /> Save
            </a>
          </div>
        )}
      </>
    );
  }
  return (
    <a href={`${a.url}?download=true`} className={`flex items-center gap-3 rounded-[14px] px-2 py-1.5 ${mine ? "bg-white/15" : "bg-ink/5"} min-w-[200px]`}>
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${mine ? "bg-white/20" : "bg-accent/10 text-accent"}`}>
        <Icon name="file" size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.88rem] font-medium">{a.name}</span>
        <span className="block text-[0.72rem] opacity-70">{fileSize(a.size)}</span>
      </span>
      <Icon name="download" size={18} className="opacity-70" />
    </a>
  );
}

export function TypingIndicator({ users }: { users: Member[] }) {
  if (!users.length) return null;
  const text =
    users.length === 1
      ? `${users[0].display_name} is typing…`
      : users.length === 2
        ? `${users[0].display_name} and ${users[1].display_name} are typing…`
        : `${users.length} people are typing…`;
  return (
    <div className="flex items-end gap-2 px-3 sm:px-6 mt-2.5 anim-msg-left" aria-live="polite">
      <div className="flex -space-x-2">
        {users.slice(0, 3).map((u) => (
          <Avatar key={u.id} name={u.display_name} url={u.avatar_url} size={26} seed={u.id} />
        ))}
      </div>
      <div className="flex flex-col">
        <div className="flex h-9 items-center gap-1 rounded-[20px] rounded-bl-[6px] bg-bubble px-4">
          <span className="typing-dot h-[7px] w-[7px] rounded-full bg-muted" />
          <span className="typing-dot h-[7px] w-[7px] rounded-full bg-muted" />
          <span className="typing-dot h-[7px] w-[7px] rounded-full bg-muted" />
        </div>
        <span className="ml-2 mt-1 text-[0.7rem] text-faint">{text}</span>
      </div>
    </div>
  );
}
