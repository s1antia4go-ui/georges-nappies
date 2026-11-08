import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Avatar, Modal, PresenceDot, Spinner } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { lastSeen, memberSince } from "../lib/format";
import type { Conversation, Profile } from "../lib/types";
import { convTitle, useStore } from "../store";
import { GroupAvatar } from "./Chat";
import { useStartDm } from "./Sidebar";

export function Modals() {
  const profileId = useStore((s) => s.profileUserId);
  const modal = useStore((s) => s.modal);
  return (
    <>
      {profileId !== null && <ProfileModal userId={profileId} />}
      {modal?.kind === "newGroup" && <NewGroup />}
      {modal?.kind === "forward" && <Forward />}
      {modal?.kind === "groupInfo" && <GroupInfo conversationId={modal.conversationId} />}
    </>
  );
}

/** Profile card with banner, avatar and the "About me" section (incl. Member Since). */
function ProfileModal({ userId }: { userId: number }) {
  const close = useStore((s) => s.showProfile);
  const me = useStore((s) => s.me)!;
  const toast = useStore((s) => s.toast);
  const loadFriends = useStore((s) => s.loadFriends);
  const setView = useStore((s) => s.setView);
  const startDm = useStartDm();
  const [p, setP] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  // Live updates (presence, avatar) for this user come through the friends/conversations store.
  const live = useStore((s) => s.friends.find((f) => f.id === userId) ?? Object.values(s.conversations).flatMap((c) => c.members).find((m) => m.id === userId));

  const load = () =>
    api.get<Profile>(`/api/users/${userId}`).then(setP).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load profile."));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    setMenu(false);
    try {
      await fn();
      if (msg) toast(msg, "success");
      await load();
      loadFriends();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Something went wrong.", "error");
    }
  };

  const u = p ? { ...p.user, ...(live ? { presence: live.presence, avatar_url: live.avatar_url, display_name: live.display_name, last_seen_at: live.last_seen_at } : {}) } : null;
  const self = userId === me.id;

  return (
    <Modal onClose={() => close(null)} width={420}>
      {!p || !u ? (
        <div className="flex h-60 items-center justify-center text-muted">{error ?? <Spinner />}</div>
      ) : (
        <div className="relative">
          <div className="h-28 rounded-t-3xl" style={{ background: u.banner_url ? `center/cover url(${u.banner_url})` : u.banner_color }} />
          <button className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur hover:bg-black/45" onClick={() => close(null)} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
          <div className="px-6 pb-6">
            <div className="-mt-12 flex items-end justify-between">
              <div className="rounded-full ring-[5px] ring-panel">
                <Avatar name={u.display_name} url={u.avatar_url} size={92} presence={u.presence} seed={u.id} />
              </div>
              {!self && (
                <div className="relative flex gap-2 pb-1">
                  {p.relationship === "friend" && (
                    <button className="btn-primary h-9" onClick={() => startDm(u.id)}><Icon name="chat" size={16} /> Message</button>
                  )}
                  {p.relationship === "none" && (
                    <button className="btn-primary h-9" onClick={() => act(() => api.post("/api/friends/requests", { username: u.username }), "Friend request sent")}>
                      <Icon name="userPlus" size={16} /> Add friend
                    </button>
                  )}
                  {p.relationship === "outgoing" && <span className="btn-soft h-9 pointer-events-none">Request sent</span>}
                  {p.relationship === "incoming" && (
                    <button className="btn-primary h-9" onClick={() => act(() => api.post("/api/friends/requests", { username: u.username }), "Friend request accepted")}>Accept request</button>
                  )}
                  <button className="icon-btn h-9 w-9 bg-ink/[.05]" onClick={() => setMenu((v) => !v)} aria-label="More"><Icon name="more" size={18} /></button>
                  {menu && (
                    <div className="absolute right-0 top-full z-10 mt-2 w-52 overflow-hidden rounded-2xl border border-line bg-panel py-1 shadow-pop anim-pop">
                      {p.relationship === "friend" && (
                        <MenuButton icon="close" label="Remove friend" onClick={() => confirm(`Remove @${u.username} from your friends?`) && act(() => api.del(`/api/friends/${u.id}`), "Friend removed")} />
                      )}
                      {p.relationship === "blocked" ? (
                        <MenuButton icon="block" label="Unblock" onClick={() => act(() => api.del(`/api/users/${u.id}/block`), "Unblocked")} />
                      ) : (
                        <MenuButton icon="block" label="Block" danger onClick={() => confirm(`Block @${u.username}? They won't be able to message you or find you.`) && act(() => api.post(`/api/users/${u.id}/block`), "Blocked")} />
                      )}
                      <MenuButton icon="flag" label="Report" danger onClick={() => { setMenu(false); setReporting(true); }} />
                    </div>
                  )}
                </div>
              )}
              {self && (
                <button className="btn-soft h-9" onClick={() => { close(null); setView("settings"); }}><Icon name="edit" size={15} /> Edit profile</button>
              )}
            </div>

            <h2 className="mt-3 font-display text-[1.4rem] font-semibold leading-tight">{u.display_name}</h2>
            <div className="text-[0.92rem] text-muted">@{u.username}</div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[0.8rem] text-muted">
              <PresenceDot presence={u.presence} size={9} className="ring-0" />
              {u.presence === "online" ? "Online" : u.presence === "idle" ? "Idle" : lastSeen(u.last_seen_at)}
            </div>

            <div className="mt-5 rounded-2xl bg-ink/[.035] p-4">
              <div className="section-title mb-3">About me</div>
              <dl className="space-y-2.5 text-[0.9rem]">
                <Row k="Username" v={u.username} />
                <Row k="Display name" v={u.display_name} />
                <Row k="Member since" v={memberSince(u.created_at)} />
              </dl>
              <div className="mt-3 border-t border-line/70 pt-3">
                <div className="text-[0.78rem] text-muted mb-1">Bio</div>
                <p className="whitespace-pre-wrap text-[0.9rem] leading-relaxed">{u.bio || <span className="text-faint">No bio yet.</span>}</p>
              </div>
            </div>

            {p.mutual_groups.length > 0 && (
              <div className="mt-4">
                <div className="section-title mb-2">Mutual groups · {p.mutual_groups.length}</div>
                <div className="flex flex-wrap gap-1.5">
                  {p.mutual_groups.map((g) => (
                    <button key={g.id} className="rounded-full bg-ink/[.05] px-3 py-1 text-[0.82rem] hover:bg-ink/10" onClick={() => { close(null); useStore.getState().openConversation(g.id); }}>
                      {g.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {reporting && <ReportForm userId={u.id} username={u.username} onDone={() => setReporting(false)} />}
        </div>
      )}
    </Modal>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{k}</dt>
      <dd className="truncate font-medium text-right">{v}</dd>
    </div>
  );
}

function MenuButton({ icon, label, onClick, danger }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[0.88rem] hover:bg-ink/5 ${danger ? "text-danger" : ""}`}>
      <Icon name={icon} size={16} /> {label}
    </button>
  );
}

function ReportForm({ userId, username, onDone }: { userId: number; username: string; onDone: () => void }) {
  const [reason, setReason] = useState("harassment");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ message: string }>(`/api/users/${userId}/report`, { reason, details });
      toast(r.message, "success");
      onDone();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't send report.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Report @${username}`} onClose={onDone} width={400}>
      <div className="space-y-4 px-6 pb-6">
        <div>
          <label className="label">Reason</label>
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="harassment">Harassment or bullying</option>
            <option value="spam">Spam</option>
            <option value="impersonation">Impersonation</option>
            <option value="inappropriate">Inappropriate content</option>
            <option value="other">Something else</option>
          </select>
        </div>
        <div>
          <label className="label">Details (optional)</label>
          <textarea className="input h-24 py-2.5 resize-none" maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
        </div>
        <button className="btn-primary w-full" disabled={busy} onClick={submit}>{busy ? <Spinner /> : "Send report"}</button>
      </div>
    </Modal>
  );
}

function FriendPicker({ selected, toggle, exclude = [] }: { selected: Set<number>; toggle: (id: number) => void; exclude?: number[] }) {
  const friends = useStore((s) => s.friends);
  const [q, setQ] = useState("");
  const list = friends.filter((f) => !exclude.includes(f.id) && (!q || `${f.display_name} ${f.username}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <div className="relative mb-2">
        <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input className="input h-10 pl-9" placeholder="Search friends" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="scroll max-h-[300px] overflow-y-auto -mx-2">
        {list.length === 0 && <p className="py-6 text-center text-sm text-muted">No friends to add.</p>}
        {list.map((f) => (
          <label key={f.id} className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-ink/[.04]">
            <Avatar name={f.display_name} url={f.avatar_url} size={36} seed={f.id} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.92rem] font-medium">{f.display_name}</span>
              <span className="block truncate text-[0.78rem] text-muted">@{f.username}</span>
            </span>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all ${selected.has(f.id) ? "border-accent bg-accent text-accent-ink" : "border-line"}`}>
              {selected.has(f.id) && <Icon name="check" size={12} strokeWidth={3} />}
            </span>
            <input type="checkbox" className="sr-only" checked={selected.has(f.id)} onChange={() => toggle(f.id)} />
          </label>
        ))}
      </div>
    </>
  );
}

function NewGroup() {
  const close = () => useStore.getState().setModal(null);
  const upsert = useStore((s) => s.upsertConversation);
  const open = useStore((s) => s.openConversation);
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState(new Set<number>());
  const [busy, setBusy] = useState(false);
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const create = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ conversation: Conversation }>("/api/conversations/group", { name: name.trim(), member_ids: [...selected] });
      upsert(r.conversation);
      open(r.conversation.id);
      close();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't create group.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="New group" onClose={close}>
      <div className="space-y-4 px-6 pb-6">
        <div>
          <label className="label">Group name</label>
          <input className="input" autoFocus maxLength={60} placeholder="e.g. Weekend plans" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Add friends {selected.size > 0 && `· ${selected.size} selected`}</label>
          <FriendPicker selected={selected} toggle={toggle} />
        </div>
        <button className="btn-primary w-full h-11" disabled={busy || !name.trim() || selected.size === 0} onClick={create}>
          {busy ? <Spinner /> : "Create group"}
        </button>
      </div>
    </Modal>
  );
}

function Forward() {
  const modal = useStore((s) => s.modal);
  const me = useStore((s) => s.me)!;
  const conversations = useStore((s) => s.conversations);
  const toast = useStore((s) => s.toast);
  const close = () => useStore.getState().setModal(null);
  const [selected, setSelected] = useState(new Set<number>());
  const [busy, setBusy] = useState(false);
  if (modal?.kind !== "forward") return null;
  const msg = modal.message;
  const list = Object.values(conversations).sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
  const send = async () => {
    setBusy(true);
    try {
      await api.post(`/api/messages/${msg.id}/forward`, { conversation_ids: [...selected] });
      toast(`Forwarded to ${selected.size} ${selected.size === 1 ? "chat" : "chats"}`, "success");
      close();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't forward.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Forward message" onClose={close}>
      <div className="px-6 pb-6">
        <div className="mb-3 rounded-2xl bg-ink/[.04] px-4 py-2.5 text-sm text-muted line-clamp-3">{msg.body || "Attachment"}</div>
        <div className="scroll max-h-[320px] overflow-y-auto -mx-2">
          {list.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-ink/[.04]">
              {c.kind === "group" ? <GroupAvatar conv={c} size={36} /> : <Avatar name={convTitle(c, me.id)} url={c.members.find((m) => m.id !== me.id)?.avatar_url} size={36} seed={c.id} />}
              <span className="flex-1 truncate text-[0.92rem] font-medium">{convTitle(c, me.id)}</span>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all ${selected.has(c.id) ? "border-accent bg-accent text-accent-ink" : "border-line"}`}>
                {selected.has(c.id) && <Icon name="check" size={12} strokeWidth={3} />}
              </span>
              <input type="checkbox" className="sr-only" checked={selected.has(c.id)} onChange={() => setSelected((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} />
            </label>
          ))}
        </div>
        <button className="btn-primary mt-4 w-full h-11" disabled={busy || selected.size === 0 || selected.size > 10} onClick={send}>
          {busy ? <Spinner /> : `Send${selected.size ? ` to ${selected.size}` : ""}`}
        </button>
      </div>
    </Modal>
  );
}

function GroupInfo({ conversationId }: { conversationId: number }) {
  const conv = useStore((s) => s.conversations[conversationId]);
  const me = useStore((s) => s.me)!;
  const toast = useStore((s) => s.toast);
  const showProfile = useStore((s) => s.showProfile);
  const upsert = useStore((s) => s.upsertConversation);
  const close = () => useStore.getState().setModal(null);
  const [name, setName] = useState(conv?.name ?? "");
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState(new Set<number>());
  const fileRef = useRef<HTMLInputElement>(null);
  if (!conv) return null;
  const admin = conv.my_role === "owner" || conv.my_role === "admin";

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast(done, "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Something went wrong.", "error");
    }
  };

  return (
    <Modal title="Group details" onClose={close}>
      <div className="px-6 pb-6">
        <div className="flex flex-col items-center py-2">
          <button className="group relative rounded-full" disabled={!admin} onClick={() => fileRef.current?.click()} title={admin ? "Change group photo" : undefined}>
            <GroupAvatar conv={conv} size={80} />
            {admin && (
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
                <Icon name="camera" size={22} />
              </span>
            )}
          </button>
          <input ref={fileRef} type="file" hidden accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) act(() => api.upload(`/api/conversations/${conv.id}/avatar`, f), "Group photo updated"); }} />
        </div>
        {admin ? (
          <div className="mt-2 flex gap-2">
            <input className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-label="Group name" />
            <button className="btn-soft h-11" disabled={!name.trim() || name.trim() === conv.name} onClick={() => act(() => api.patch(`/api/conversations/${conv.id}`, { name: name.trim() }), "Group renamed")}>Save</button>
          </div>
        ) : (
          <h3 className="text-center font-display text-lg font-semibold">{conv.name}</h3>
        )}

        <div className="mt-5 flex items-center">
          <span className="section-title">{conv.members.length} members</span>
          {admin && (
            <button className="ml-auto text-[0.82rem] font-medium text-accent hover:underline" onClick={() => setAdding((v) => !v)}>{adding ? "Done" : "Add people"}</button>
          )}
        </div>
        {adding && (
          <div className="mt-2 rounded-2xl border border-line p-3 anim-rise">
            <FriendPicker selected={selected} toggle={(id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })} exclude={conv.members.map((m) => m.id)} />
            <button className="btn-primary mt-3 w-full" disabled={!selected.size} onClick={() => act(() => api.post(`/api/conversations/${conv.id}/members`, { user_ids: [...selected] }), "Members added").then(() => { setSelected(new Set()); setAdding(false); })}>
              Add {selected.size || ""}
            </button>
          </div>
        )}
        <div className="mt-2 -mx-2">
          {conv.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-ink/[.03]">
              <button onClick={() => showProfile(m.id)}><Avatar name={m.display_name} url={m.avatar_url} size={36} presence={m.presence} seed={m.id} /></button>
              <button className="min-w-0 flex-1 text-left" onClick={() => showProfile(m.id)}>
                <span className="block truncate text-[0.92rem] font-medium">{m.display_name}{m.id === me.id && " (you)"}</span>
                <span className="block truncate text-[0.78rem] text-muted">@{m.username}</span>
              </button>
              {m.role !== "member" && <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[0.7rem] font-medium capitalize text-accent">{m.role}</span>}
              {admin && m.id !== me.id && m.role !== "owner" && (
                <button className="icon-btn h-8 w-8" title="Remove from group" onClick={() => confirm(`Remove ${m.display_name} from the group?`) && act(() => api.del(`/api/conversations/${conv.id}/members/${m.id}`))}>
                  <Icon name="close" size={15} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="mt-5 space-y-2">
          <button className="btn-soft w-full" onClick={() => act(async () => { await api.put(`/api/conversations/${conv.id}/mute?muted=${!conv.muted}`); upsert({ ...conv, muted: !conv.muted }); })}>
            <Icon name={conv.muted ? "bell" : "bellOff"} size={17} /> {conv.muted ? "Unmute notifications" : "Mute notifications"}
          </button>
          <button className="btn-danger w-full" onClick={() => confirm("Leave this group?") && act(() => api.del(`/api/conversations/${conv.id}/members/${me.id}`)).then(close)}>
            <Icon name="logout" size={17} /> Leave group
          </button>
        </div>
      </div>
    </Modal>
  );
}
