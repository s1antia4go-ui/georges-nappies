import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import { Avatar, Empty, Spinner } from "../components/ui";
import { api, ApiError, qs } from "../lib/api";
import { lastSeen } from "../lib/format";
import type { Profile, PublicUser } from "../lib/types";
import { useStore } from "../store";
import { useStartDm } from "./Sidebar";

type Tab = "all" | "online" | "pending" | "blocked" | "add";

export function Friends({ onBack }: { onBack: () => void }) {
  const tab = useStore((s) => s.friendsTab);
  const setTab = (t: Tab) => useStore.setState({ friendsTab: t });
  const setModal = useStore((s) => s.setModal);
  const friends = useStore((s) => s.friends);
  const incoming = useStore((s) => s.incoming);
  const outgoing = useStore((s) => s.outgoing);
  const loadFriends = useStore((s) => s.loadFriends);

  useEffect(() => {
    loadFriends().catch(() => {});
  }, [loadFriends]);

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "all", label: "All" },
    { id: "online", label: "Online" },
    { id: "pending", label: "Pending", badge: incoming.length },
    { id: "blocked", label: "Blocked" },
  ];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-panel">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line/70 px-3 sm:px-5">
        <button className="icon-btn md:hidden -ml-1" onClick={onBack} aria-label="Back">
          <Icon name="back" size={22} />
        </button>
        <Icon name="friends" size={20} className="text-muted" />
        <h2 className="font-display font-semibold mr-2">Friends</h2>
        <nav className="scroll flex items-center gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[0.85rem] font-medium transition-colors ${
                tab === t.id ? "bg-ink/[.07] text-ink" : "text-muted hover:bg-ink/[.04] hover:text-ink"
              }`}
            >
              {t.label}
              {!!t.badge && <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent text-accent-ink px-1 text-[0.68rem] font-semibold anim-status">{t.badge}</span>}
            </button>
          ))}
        </nav>
        <button className="icon-btn ml-auto shrink-0" onClick={() => setModal({ kind: "newGroup" })} title="New group">
          <Icon name="users" size={19} />
        </button>
        <button
          onClick={() => setTab("add")}
          title="Add friend"
          aria-label="Add friend"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all active:scale-90 ${tab === "add" ? "bg-ink/10 text-ink" : "bg-accent text-accent-ink"}`}
        >
          <Icon name="plus" size={20} strokeWidth={2.2} />
        </button>
      </header>
      <div className="scroll flex-1 overflow-y-auto">
        <div key={tab} className="mx-auto max-w-3xl px-4 py-5 sm:px-6 anim-fade">
          {tab === "add" && <AddFriend />}
          {tab === "all" && <FriendList list={friends} empty="You haven't added any friends yet." onAdd={() => setTab("add")} />}
          {tab === "online" && <FriendList list={friends.filter((f) => f.presence !== "offline")} empty="None of your friends are online right now." />}
          {tab === "pending" && <Pending incoming={incoming} outgoing={outgoing} />}
          {tab === "blocked" && <Blocked />}
        </div>
      </div>
    </div>
  );
}

function AddFriend() {
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [history, setHistory] = useState<PublicUser[]>([]);
  const toast = useStore((s) => s.toast);
  const loadFriends = useStore((s) => s.loadFriends);
  const showProfile = useStore((s) => s.showProfile);

  const loadHistory = () => api.get<{ users: PublicUser[] }>("/api/me/search-history").then((r) => setHistory(r.users)).catch(() => {});
  useEffect(() => {
    loadHistory();
  }, []);

  const search = async (e?: FormEvent, name = username) => {
    e?.preventDefault();
    const q = name.trim().replace(/^@/, "");
    if (!q) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setSent(null);
    try {
      setResult(await api.get<Profile>(`/api/users/search/exact${qs({ username: q })}`));
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!result) return;
    setBusy(true);
    try {
      const r = await api.post<{ message: string; status: string }>("/api/friends/requests", { username: result.user.username });
      setSent(r.message);
      setResult({ ...result, relationship: r.status === "accepted" ? "friend" : "outgoing" });
      toast(r.message, "success");
      loadFriends();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h3 className="font-display text-xl font-semibold">Add a friend</h3>
      <p className="mt-1 text-sm text-muted">Enter their exact username. Usernames are unique, so you'll find exactly the right person.</p>
      <form onSubmit={search} className="mt-5 flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint">@</span>
          <input
            className="input pl-8"
            placeholder="username"
            autoFocus
            maxLength={21}
            value={username}
            onChange={(e) => { setUsername(e.target.value.replace(/\s/g, "")); setError(null); }}
            aria-label="Username"
          />
        </div>
        <button className="btn-primary h-11 px-5" disabled={busy || !username.trim()}>
          {busy && !result ? <Spinner /> : "Search"}
        </button>
      </form>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger anim-rise" role="alert">
          <Icon name="alert" size={18} /> {error}
        </div>
      )}

      {result && (
        <div className="card mt-4 overflow-hidden anim-rise">
          <div className="h-16" style={{ background: result.user.banner_url ? `center/cover url(${result.user.banner_url})` : result.user.banner_color }} />
          <div className="flex items-end gap-4 px-5 pb-5">
            <div className="-mt-8 rounded-full ring-4 ring-panel">
              <Avatar name={result.user.display_name} url={result.user.avatar_url} size={72} presence={result.user.presence} seed={result.user.id} />
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <button className="block truncate font-display text-lg font-semibold hover:underline" onClick={() => showProfile(result.user.id)}>
                {result.user.display_name}
              </button>
              <div className="truncate text-sm text-muted">@{result.user.username}</div>
            </div>
            <div className="pb-1">
              {result.relationship === "none" && (
                <button className="btn-primary" onClick={send} disabled={busy}>
                  {busy ? <Spinner /> : <><Icon name="userPlus" size={17} /> Send request</>}
                </button>
              )}
              {result.relationship === "outgoing" && <span className="btn-soft pointer-events-none"><Icon name="check" size={17} /> Request sent</span>}
              {result.relationship === "incoming" && (
                <button className="btn-primary" onClick={send} disabled={busy}><Icon name="check" size={17} /> Accept request</button>
              )}
              {result.relationship === "friend" && <span className="btn-soft pointer-events-none"><Icon name="friends" size={17} /> Friends</span>}
              {result.relationship === "blocked" && <span className="btn-soft pointer-events-none">Blocked</span>}
            </div>
          </div>
          {sent && <div className="border-t border-line/70 bg-online/[.07] px-5 py-3 text-sm text-[rgb(var(--online))] anim-fade">{sent}</div>}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center">
            <span className="section-title">Recent searches</span>
            <button className="ml-auto text-[0.78rem] text-muted hover:text-ink" onClick={() => api.del("/api/me/search-history").then(() => setHistory([]))}>
              Clear
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {history.map((u) => (
              <button key={u.id} className="flex items-center gap-2 rounded-full border border-line bg-panel py-1 pl-1 pr-3 text-sm hover:bg-ink/[.03]" onClick={() => { setUsername(u.username); search(undefined, u.username); }}>
                <Avatar name={u.display_name} url={u.avatar_url} size={24} seed={u.id} />
                @{u.username}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FriendList({ list, empty, onAdd }: { list: ReturnType<typeof useStore.getState>["friends"]; empty: string; onAdd?: () => void }) {
  const startDm = useStartDm();
  const showProfile = useStore((s) => s.showProfile);
  const toast = useStore((s) => s.toast);
  const loadFriends = useStore((s) => s.loadFriends);
  const [q, setQ] = useState("");
  if (!list.length) return <Empty icon="friends" title="No one here yet" text={onAdd ? `${empty} Tap + to add someone by username.` : empty} />;
  const filtered = list
    .filter((f) => !q || f.display_name.toLowerCase().includes(q.toLowerCase()) || f.username.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite));
  const toggleFav = async (id: number, fav: boolean) => {
    try {
      await (fav ? api.del(`/api/friends/${id}/favorite`) : api.put(`/api/friends/${id}/favorite`));
      loadFriends();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Something went wrong.", "error");
    }
  };
  return (
    <div>
      <div className="relative mb-4">
        <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input className="input h-10 pl-9" placeholder="Search friends" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="section-title mb-2 px-1">{filtered.length} {filtered.length === 1 ? "friend" : "friends"}</div>
      <div className="divide-y divide-line/60">
        {filtered.map((f) => (
          <div key={f.id} className="group flex items-center gap-3 rounded-xl px-2 py-3 hover:bg-ink/[.025] transition-colors">
            <button onClick={() => showProfile(f.id)}>
              <Avatar name={f.display_name} url={f.avatar_url} size={44} presence={f.presence} seed={f.id} />
            </button>
            <button className="min-w-0 flex-1 text-left" onClick={() => showProfile(f.id)}>
              <div className="flex items-center gap-1.5">
                <span className="truncate font-medium">{f.display_name}</span>
                {f.favorite && <Icon name="star" size={13} className="text-ink fill-current" />}
              </div>
              <div className="truncate text-[0.82rem] text-muted">
                @{f.username} · {f.presence === "online" ? "Online" : f.presence === "idle" ? "Idle" : lastSeen(f.last_seen_at)}
              </div>
            </button>
            <button className="icon-btn" title={f.favorite ? "Remove favourite" : "Favourite"} onClick={() => toggleFav(f.id, f.favorite)}>
              <Icon name="star" size={18} className={f.favorite ? "text-ink fill-current" : ""} />
            </button>
            <button className="icon-btn" title="Message" onClick={() => startDm(f.id)}>
              <Icon name="chat" size={19} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Pending({ incoming, outgoing }: { incoming: ReturnType<typeof useStore.getState>["incoming"]; outgoing: ReturnType<typeof useStore.getState>["outgoing"] }) {
  const loadFriends = useStore((s) => s.loadFriends);
  const toast = useStore((s) => s.toast);
  const showProfile = useStore((s) => s.showProfile);
  const [busy, setBusy] = useState<number | null>(null);
  const act = async (id: number, action: "accept" | "decline") => {
    setBusy(id);
    try {
      const r = await api.post<{ message?: string }>(`/api/friends/requests/${id}/${action}`);
      if (r.message) toast(r.message, "success");
      await loadFriends();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Something went wrong.", "error");
    } finally {
      setBusy(null);
    }
  };
  if (!incoming.length && !outgoing.length) return <Empty icon="inbox" title="No pending requests" text="Friend requests you send or receive will show up here." />;
  return (
    <div className="space-y-8">
      {incoming.length > 0 && (
        <section>
          <div className="section-title mb-2 px-1">Incoming · {incoming.length}</div>
          {incoming.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-xl px-2 py-3 anim-rise">
              <button onClick={() => showProfile(r.user.id)}><Avatar name={r.user.display_name} url={r.user.avatar_url} size={44} seed={r.user.id} /></button>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.user.display_name}</div>
                <div className="truncate text-[0.82rem] text-muted">@{r.user.username} wants to be friends</div>
              </div>
              <button className="btn-primary h-9 px-3" disabled={busy === r.id} onClick={() => act(r.id, "accept")}>Accept</button>
              <button className="btn-soft h-9 px-3" disabled={busy === r.id} onClick={() => act(r.id, "decline")}>Decline</button>
            </div>
          ))}
        </section>
      )}
      {outgoing.length > 0 && (
        <section>
          <div className="section-title mb-2 px-1">Outgoing · {outgoing.length}</div>
          {outgoing.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-xl px-2 py-3 anim-rise">
              <Avatar name={r.user.display_name} url={r.user.avatar_url} size={44} seed={r.user.id} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.user.display_name}</div>
                <div className="truncate text-[0.82rem] text-muted">Request sent to @{r.user.username}</div>
              </div>
              <button className="btn-soft h-9 px-3" disabled={busy === r.id} onClick={() => act(r.id, "decline")}>Cancel</button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Blocked() {
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const toast = useStore((s) => s.toast);
  const load = () => api.get<{ users: PublicUser[] }>("/api/me/blocked").then((r) => setUsers(r.users));
  useEffect(() => {
    load().catch(() => setUsers([]));
  }, []);
  if (!users) return <div className="flex justify-center py-10 text-faint"><Spinner /></div>;
  if (!users.length) return <Empty icon="shield" title="No blocked users" text="People you block can't message you, find you, or send you requests." />;
  return (
    <div>
      {users.map((u) => (
        <div key={u.id} className="flex items-center gap-3 rounded-xl px-2 py-3">
          <Avatar name={u.display_name} url={u.avatar_url} size={40} seed={u.id} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{u.display_name}</div>
            <div className="truncate text-[0.82rem] text-muted">@{u.username}</div>
          </div>
          <button className="btn-soft h-9 px-3" onClick={() => api.del(`/api/users/${u.id}/block`).then(() => { toast(`Unblocked @${u.username}`); load(); })}>
            Unblock
          </button>
        </div>
      ))}
    </div>
  );
}
