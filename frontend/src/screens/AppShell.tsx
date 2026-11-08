import { useEffect, useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import { Avatar, PresenceDot } from "../components/ui";
import { api, ApiError } from "../lib/api";
import type { Me } from "../lib/types";
import { useStore, type View } from "../store";
import { Logo } from "./Auth";
import { Chat, NoChat } from "./Chat";
import { Friends } from "./Friends";
import { Modals } from "./Modals";
import { Settings } from "./Settings";
import { ConversationList } from "./Sidebar";

/**
 * Layout: two floating rounded panels on a quiet background.
 * Left: brand, a Chats/Friends switch, the conversation list and a profile card.
 * Right: the open conversation, Friends or Settings.
 */
export function AppShell() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const activeId = useStore((s) => s.activeId);
  const conv = useStore((s) => (s.activeId ? s.conversations[s.activeId] : undefined));
  const open = useStore((s) => s.openConversation);
  const openAddFriend = useStore((s) => s.openAddFriend);
  const totalUnread = useStore((s) => Object.values(s.conversations).reduce((n, c) => n + (c.muted ? 0 : c.unread_count), 0));
  const incoming = useStore((s) => s.incoming.length);

  useEffect(() => {
    document.title = totalUnread ? `(${totalUnread}) George's Nappies` : "George's Nappies";
  }, [totalUnread]);

  // On phones the list and the detail are separate screens.
  const detailOpen = (view === "chats" && !!conv) || view === "friends" || view === "settings";

  return (
    <div className="flex h-full gap-2 overflow-hidden bg-bg md:p-2">
      <aside
        className={`${detailOpen ? "hidden md:flex" : "flex"} w-full md:w-[330px] lg:w-[360px] shrink-0 flex-col bg-panel md:rounded-[26px] md:border md:border-line/70 md:shadow-soft overflow-hidden`}
      >
        {/* Brand + add friend */}
        <div className="flex items-center gap-2.5 px-5 pb-3 pt-5">
          <Logo size={30} />
          <span className="brand-wordmark text-[1.3rem]">George's Nappies</span>
          <button
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-ink transition-transform hover:scale-105 active:scale-90"
            onClick={openAddFriend}
            title="Add friend"
            aria-label="Add friend"
          >
            <Icon name="plus" size={20} strokeWidth={2.2} />
          </button>
        </div>

        {/* Chats / Friends switch */}
        <div className="px-4 pb-2">
          <Segmented view={view} setView={setView} unread={totalUnread} requests={incoming} />
        </div>

        <div className="min-h-0 flex-1">
          <ConversationList />
        </div>

        <ProfileCard active={view === "settings"} onSettings={() => setView("settings")} />
      </aside>

      <main className={`${detailOpen ? "flex" : "hidden md:flex"} min-w-0 flex-1 overflow-hidden bg-panel md:rounded-[26px] md:border md:border-line/70 md:shadow-soft`}>
        {view === "friends" ? (
          <Friends onBack={() => setView("chats")} />
        ) : view === "settings" ? (
          <Settings onBack={() => setView("chats")} />
        ) : conv ? (
          <Chat key={activeId} conv={conv} onBack={() => open(null)} />
        ) : (
          <NoChat />
        )}
      </main>
      <Modals />
    </div>
  );
}

function Segmented({ view, setView, unread, requests }: { view: View; setView: (v: View) => void; unread: number; requests: number }) {
  const items: { id: View; label: string; icon: IconName; badge: number }[] = [
    { id: "chats", label: "Chats", icon: "chat", badge: unread },
    { id: "friends", label: "Friends", icon: "friends", badge: requests },
  ];
  const activeIndex = view === "friends" ? 1 : 0;
  return (
    <div className="relative grid grid-cols-2 rounded-full bg-ink/[.06] p-1">
      <span
        className="absolute bottom-1 top-1 w-[calc(50%-4px)] rounded-full bg-ink shadow-soft transition-transform duration-300 ease-soft"
        style={{ transform: `translateX(${activeIndex * 100}%)`, left: 4 }}
      />
      {items.map((it) => {
        const active = (view === "friends") === (it.id === "friends");
        return (
          <button
            key={it.id}
            onClick={() => setView(it.id)}
            className={`relative z-[1] flex h-9 items-center justify-center gap-2 rounded-full text-[0.88rem] font-semibold transition-colors ${active ? "text-bg" : "text-muted hover:text-ink"}`}
          >
            <Icon name={it.icon} size={17} />
            {it.label}
            {!!it.badge && (
              <span className={`anim-status flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[0.65rem] font-bold ${active ? "bg-bg text-ink" : "bg-accent text-accent-ink"}`}>
                {it.badge > 99 ? "99+" : it.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ProfileCard({ active, onSettings }: { active: boolean; onSettings: () => void }) {
  const me = useStore((s) => s.me)!;
  const setMe = useStore((s) => s.setMe);
  const showProfile = useStore((s) => s.showProfile);
  const toast = useStore((s) => s.toast);
  const [open, setOpen] = useState(false);
  const presence = me.status === "invisible" ? "offline" : me.status;
  const statusLabel = me.status === "online" ? "Online" : me.status === "idle" ? "Idle" : "Invisible";

  const setStatus = async (status: Me["status"]) => {
    setOpen(false);
    try {
      const r = await api.put<{ user: Me }>("/api/me/status", { status });
      setMe(r.user);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't change status.", "error");
    }
  };

  return (
    <div className="relative m-3 mt-1 flex items-center gap-2 rounded-[20px] bg-ink/[.04] p-2">
      <button onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-1 text-left transition-colors hover:bg-ink/[.04]" aria-label="Your status">
        <Avatar name={me.display_name} url={me.avatar_url} size={40} presence={presence} seed={me.id} />
        <span className="min-w-0">
          <span className="block truncate text-[0.92rem] font-semibold">{me.display_name}</span>
          <span className="block truncate text-[0.76rem] text-muted">{statusLabel} · @{me.username}</span>
        </span>
      </button>
      <button className={`icon-btn shrink-0 ${active ? "!bg-ink/10 !text-ink" : ""}`} onClick={onSettings} title="Settings" aria-label="Settings">
        <Icon name="settings" size={19} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-40 mb-2 w-full overflow-hidden rounded-2xl border border-line bg-panel py-1.5 shadow-pop anim-pop">
            <button className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-ink/[.04]" onClick={() => { setOpen(false); showProfile(me.id); }}>
              <Icon name="user" size={17} className="text-muted" />
              <span className="text-sm">View my profile</span>
            </button>
            <div className="my-1 border-t border-line/70" />
            {([["online", "Online", "online"], ["idle", "Idle", "idle"], ["invisible", "Invisible", "offline"]] as const).map(([s, label, p]) => (
              <button key={s} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-ink/[.04]" onClick={() => setStatus(s)}>
                <PresenceDot presence={p} size={10} className="ring-0" />
                <span className="flex-1">{label}</span>
                {me.status === s && <Icon name="check" size={16} className="text-accent" />}
              </button>
            ))}
            <p className="px-3 pb-1.5 pt-1 text-[0.72rem] text-faint">Invisible: you'll appear offline but can still chat.</p>
          </div>
        </>
      )}
    </div>
  );
}
