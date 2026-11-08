import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { Avatar, Empty, Spinner } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { shortWhen } from "../lib/format";
import type { Conversation } from "../lib/types";
import { convTitle, otherMember, useStore } from "../store";
import { GroupAvatar } from "./Chat";

export function ConversationList() {
  const me = useStore((s) => s.me)!;
  const conversations = useStore((s) => s.conversations);
  const loaded = useStore((s) => s.convsLoaded);
  const activeId = useStore((s) => s.activeId);
  const typing = useStore((s) => s.typing);
  const open = useStore((s) => s.openConversation);
  const connection = useStore((s) => s.connection);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return Object.values(conversations)
      .filter((c) => c.kind === "group" || c.last_message || c.id === activeId) // hide never-used DMs
      .filter((c) => filter === "all" || c.unread_count > 0)
      .filter((c) => {
        if (!needle) return true;
        const title = convTitle(c, me.id).toLowerCase();
        return title.includes(needle) || c.members.some((m) => m.username.toLowerCase().includes(needle) || m.display_name.toLowerCase().includes(needle));
      })
      .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
  }, [conversations, q, filter, me.id, activeId]);

  return (
    <div className="flex h-full flex-col">
      {connection !== "open" && (
        <div className="px-4 pb-1">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/5 px-2.5 py-1 text-[0.72rem] text-muted anim-fade" title="Reconnecting to the server">
            <Spinner size={11} /> {connection === "connecting" ? "Reconnecting…" : "Offline"}
          </span>
        </div>
      )}
      <div className="px-4 pb-2 pt-1">
        <div className="relative">
          <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input h-9 pl-9 text-[0.9rem]" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search conversations" />
        </div>
        <div className="mt-2.5 flex gap-1.5">
          {(["all", "unread"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-[0.78rem] font-medium transition-colors ${filter === f ? "bg-ink text-bg" : "bg-ink/[.05] text-muted hover:text-ink"}`}
            >
              {f === "all" ? "All" : "Unread"}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll flex-1 overflow-y-auto px-2 pb-3">
        {!loaded ? (
          <div className="flex justify-center py-10 text-faint"><Spinner /></div>
        ) : list.length === 0 ? (
          q || filter === "unread" ? (
            <p className="px-4 py-10 text-center text-sm text-muted">{filter === "unread" ? "You're all caught up." : "No conversations match."}</p>
          ) : (
            <Empty icon="chat" title="No conversations yet" text="Tap + to add a friend by their username." />
          )
        ) : (
          list.map((c) => <Row key={c.id} c={c} active={c.id === activeId} typing={Object.keys(typing[c.id] ?? {}).length > 0} meId={me.id} onClick={() => open(c.id)} />)
        )}
      </div>
    </div>
  );
}

export function useStartDm() {
  const upsert = useStore((s) => s.upsertConversation);
  const open = useStore((s) => s.openConversation);
  const toast = useStore((s) => s.toast);
  const showProfile = useStore((s) => s.showProfile);
  return async (userId: number) => {
    try {
      const r = await api.post<{ conversation: Conversation }>("/api/conversations/direct", { user_id: userId });
      upsert(r.conversation);
      showProfile(null);
      open(r.conversation.id);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't open conversation.", "error");
    }
  };
}

function Row({ c, active, typing, meId, onClick }: { c: Conversation; active: boolean; typing: boolean; meId: number; onClick: () => void }) {
  const other = otherMember(c, meId);
  const lm = c.last_message;
  const sender = lm && c.members.find((m) => m.id === lm.sender_id);
  let preview = "No messages yet";
  if (lm) {
    const content = lm.deleted ? "Message deleted" : lm.body || (lm.attachment ? (lm.attachment.is_image ? "📷 Photo" : `📎 ${lm.attachment.name}`) : "");
    preview = lm.kind === "system" ? lm.body : lm.sender_id === meId ? `You: ${content}` : c.kind === "group" ? `${sender?.display_name ?? "Someone"}: ${content}` : content;
  }
  const unread = c.unread_count > 0;
  return (
    <button
      onClick={onClick}
      className={`group relative flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition-all duration-150 ${
        active ? "bg-accent text-accent-ink" : "hover:bg-ink/[.04]"
      }`}
    >
      {c.kind === "group" ? (
        <GroupAvatar conv={c} size={48} />
      ) : (
        <Avatar name={other?.display_name ?? "?"} url={other?.avatar_url} size={48} presence={other?.presence} seed={other?.id} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`truncate text-[0.95rem] ${unread ? "font-semibold" : "font-medium"}`}>{convTitle(c, meId)}</span>
          {c.muted && <Icon name="bellOff" size={13} className={active ? "opacity-70" : "text-faint"} />}
          <span className={`ml-auto shrink-0 text-[0.72rem] ${active ? "opacity-80" : unread ? "text-accent font-medium" : "text-faint"}`}>
            {lm ? shortWhen(lm.created_at) : ""}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className={`truncate text-[0.84rem] ${active ? "opacity-85" : unread ? "text-ink" : "text-muted"}`}>
            {typing ? <span className={`${active ? "" : "text-accent"} anim-fade`}>typing…</span> : preview}
          </span>
          {unread && !active && (
            <span className="anim-status ml-auto flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[0.7rem] font-semibold text-accent-ink">
              {c.unread_count > 99 ? "99+" : c.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
