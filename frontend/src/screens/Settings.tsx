import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../components/Icon";
import { Avatar, Spinner, Toggle } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { memberSince } from "../lib/format";
import { stopRealtime } from "../lib/realtime";
import { applyPreferences } from "../lib/theme";
import type { Me, Preferences } from "../lib/types";
import { useStore } from "../store";

type Section = "profile" | "account" | "privacy" | "notifications" | "appearance";
const SECTIONS: { id: Section; label: string; icon: IconName }[] = [
  { id: "profile", label: "Profile", icon: "user" },
  { id: "account", label: "Account", icon: "lock" },
  { id: "privacy", label: "Privacy & safety", icon: "shield" },
  { id: "notifications", label: "Notifications", icon: "bell" },
  { id: "appearance", label: "Appearance", icon: "palette" },
];

// Monochrome banner shades, from black to light grey.
const ACCENTS = ["#000000", "#1C1C1E", "#3A3A3C", "#636366", "#8E8E93", "#C7C7CC", "#F2F2F7"];

function useSave() {
  const setMe = useStore((s) => s.setMe);
  const toast = useStore((s) => s.toast);
  return async (fn: () => Promise<{ user: Me }>, done?: string) => {
    try {
      const r = await fn();
      setMe(r.user);
      applyPreferences(r.user.preferences);
      if (done) toast(done, "success");
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't save.", "error");
      return false;
    }
  };
}

export function Settings({ onBack }: { onBack: () => void }) {
  const [section, setSection] = useState<Section | null>(window.innerWidth >= 768 ? "profile" : null);
  return (
    <div className="flex h-full min-w-0 flex-1 bg-panel">
      <nav className={`${section ? "hidden md:flex" : "flex"} w-full md:w-[240px] shrink-0 flex-col border-r border-line/70 p-3`}>
        <div className="flex items-center gap-2 px-2 pb-3 pt-1">
          <button className="icon-btn md:hidden -ml-2" onClick={onBack} aria-label="Back"><Icon name="back" size={22} /></button>
          <h2 className="font-display text-[1.25rem] font-semibold">Settings</h2>
        </div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[0.92rem] transition-colors ${section === s.id ? "bg-ink/[.07] font-medium" : "text-muted hover:bg-ink/[.04] hover:text-ink"}`}
          >
            <Icon name={s.icon} size={18} /> {s.label}
          </button>
        ))}
        <div className="mt-auto pt-3">
          <LogoutButton />
        </div>
      </nav>
      {section && (
        <div className="scroll min-w-0 flex-1 overflow-y-auto">
          <div key={section} className="mx-auto max-w-2xl px-5 py-6 sm:px-8 anim-fade">
            <button className="btn-ghost -ml-3 mb-2 md:hidden" onClick={() => setSection(null)}><Icon name="back" size={18} /> Settings</button>
            {section === "profile" && <ProfileSection />}
            {section === "account" && <AccountSection />}
            {section === "privacy" && <PrivacySection />}
            {section === "notifications" && <NotificationsSection />}
            {section === "appearance" && <AppearanceSection />}
          </div>
        </div>
      )}
    </div>
  );
}

function H({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-6">
      <h2 className="font-display text-[1.4rem] font-semibold">{children}</h2>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </div>
  );
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      {title && <div className="section-title mb-2 px-1">{title}</div>}
      <div className="card divide-y divide-line/60 px-5">{children}</div>
    </section>
  );
}

function LogoutButton() {
  const reset = useStore((s) => s.reset);
  return (
    <button
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[0.92rem] text-danger hover:bg-danger/[.07]"
      onClick={async () => {
        try {
          await api.post("/api/auth/logout");
        } finally {
          stopRealtime();
          reset();
        }
      }}
    >
      <Icon name="logout" size={18} /> Log out
    </button>
  );
}

function ProfileSection() {
  const me = useStore((s) => s.me)!;
  const save = useSave();
  const [displayName, setDisplayName] = useState(me.display_name);
  const [bio, setBio] = useState(me.bio);
  const [bannerColor, setBannerColor] = useState(me.banner_color);
  const [busy, setBusy] = useState<string | null>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);
  const dirty = displayName !== me.display_name || bio !== me.bio || bannerColor !== me.banner_color;

  const upload = async (kind: "avatar" | "banner", file: File) => {
    setBusy(kind);
    await save(() => api.upload<{ user: Me }>(`/api/me/${kind}`, file), kind === "avatar" ? "Profile picture updated" : "Banner updated");
    setBusy(null);
  };

  return (
    <>
      <H sub="This is how people see you. GIFs work for profile pictures and banners.">Profile</H>
      {/* Live preview */}
      <div className="card mb-6 overflow-hidden">
        <div className="group relative h-32" style={{ background: me.banner_url ? `center/cover url(${me.banner_url})` : bannerColor }}>
          <div className="absolute right-3 top-3 flex gap-2 opacity-90">
            <button className="btn-soft h-8 !bg-black/35 px-3 text-[0.8rem] !text-white backdrop-blur hover:!bg-black/50" onClick={() => bannerRef.current?.click()}>
              {busy === "banner" ? <Spinner size={14} /> : <Icon name="camera" size={15} />} Banner
            </button>
            {me.banner_url && (
              <button className="btn-soft h-8 !bg-black/35 px-3 text-[0.8rem] !text-white backdrop-blur" onClick={() => save(() => api.del<{ user: Me }>("/api/me/images/banner"), "Banner removed")}>Remove</button>
            )}
          </div>
          <input ref={bannerRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload("banner", f); }} />
        </div>
        <div className="flex items-end gap-4 px-5 pb-5">
          <button className="group relative -mt-10 rounded-full ring-[5px] ring-panel" onClick={() => avatarRef.current?.click()} aria-label="Change profile picture">
            <Avatar name={displayName || me.username} url={me.avatar_url} size={88} seed={me.id} />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
              {busy === "avatar" ? <Spinner /> : <Icon name="camera" size={22} />}
            </span>
          </button>
          <input ref={avatarRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload("avatar", f); }} />
          <div className="min-w-0 pb-1">
            <div className="truncate font-display text-lg font-semibold">{displayName || me.username}</div>
            <div className="text-sm text-muted">@{me.username}</div>
          </div>
          {me.avatar_url && (
            <button className="btn-ghost ml-auto h-8 text-[0.8rem] text-muted" onClick={() => save(() => api.del<{ user: Me }>("/api/me/images/avatar"), "Profile picture removed")}>Remove photo</button>
          )}
        </div>
      </div>

      <div className="space-y-5">
        <div>
          <label className="label">Display name</label>
          <input className="input" maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div>
          <label className="label">Bio</label>
          <textarea className="input h-28 resize-none py-2.5" maxLength={300} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell people a little about yourself" />
          <div className="mt-1 text-right text-[0.72rem] text-faint">{bio.length}/300</div>
        </div>
        <div>
          <label className="label">Banner colour</label>
          <div className="flex flex-wrap items-center gap-2">
            {ACCENTS.map((c) => (
              <button key={c} onClick={() => setBannerColor(c)} className={`h-8 w-8 rounded-full transition-transform hover:scale-110 ${bannerColor.toLowerCase() === c.toLowerCase() ? "ring-2 ring-offset-2 ring-offset-panel ring-ink/40" : ""}`} style={{ background: c }} aria-label={c} />
            ))}
            <label className="relative flex h-8 items-center gap-2 rounded-full bg-ink/[.05] px-3 text-[0.8rem] text-muted cursor-pointer">
              Custom
              <input type="color" value={bannerColor} onChange={(e) => setBannerColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          {dirty && <button className="btn-ghost" onClick={() => { setDisplayName(me.display_name); setBio(me.bio); setBannerColor(me.banner_color); }}>Reset</button>}
          <button className="btn-primary" disabled={!dirty || !displayName.trim()} onClick={() => save(() => api.patch<{ user: Me }>("/api/me/profile", { display_name: displayName.trim(), bio, banner_color: bannerColor }), "Profile saved")}>
            Save changes
          </button>
        </div>
      </div>
    </>
  );
}

function AccountSection() {
  const me = useStore((s) => s.me)!;
  const save = useSave();
  const toast = useStore((s) => s.toast);
  const reset = useStore((s) => s.reset);
  const [email, setEmail] = useState(me.email);
  const [emailPw, setEmailPw] = useState("");
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [sessions, setSessions] = useState<{ id: number; user_agent: string; ip: string; last_used_at: string; current: boolean }[]>([]);
  const [delPw, setDelPw] = useState("");
  const [showDelete, setShowDelete] = useState(false);

  const loadSessions = () => api.get<{ sessions: typeof sessions }>("/api/auth/sessions").then((r) => setSessions(r.sessions)).catch(() => {});
  useEffect(() => {
    loadSessions();
  }, []);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg, "success");
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Something went wrong.", "error");
      return false;
    }
  };

  return (
    <>
      <H sub="Your sign-in details and security.">Account</H>
      <Card title="Identity">
        <div className="flex justify-between py-3.5"><span className="text-muted">Username</span><span className="font-medium">@{me.username}</span></div>
        <div className="flex justify-between py-3.5"><span className="text-muted">Member since</span><span className="font-medium">{memberSince(me.created_at)}</span></div>
        <p className="py-3 text-[0.8rem] text-faint">Usernames are permanent and can't be changed or reused.</p>
      </Card>

      <Card title="Email">
        <div className="space-y-3 py-4">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
          {email !== me.email && (
            <div className="flex gap-2 anim-rise">
              <input className="input" type="password" placeholder="Confirm with your password" value={emailPw} onChange={(e) => setEmailPw(e.target.value)} />
              <button className="btn-primary h-11" disabled={!emailPw} onClick={async () => { if (await save(() => api.post<{ user: Me }>("/api/auth/change-email", { email, password: emailPw }), "Email updated")) setEmailPw(""); }}>Update</button>
            </div>
          )}
        </div>
      </Card>

      <Card title="Password">
        <div className="space-y-3 py-4">
          <input className="input" type="password" autoComplete="current-password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} />
          <input className="input" type="password" autoComplete="new-password" placeholder="New password (10+ characters)" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
          <div className="flex justify-end">
            <button className="btn-primary" disabled={!cur || next.length < 10} onClick={async () => { if (await run(() => api.post("/api/auth/change-password", { current_password: cur, new_password: next }), "Password changed. Other devices were signed out.")) { setCur(""); setNext(""); loadSessions(); } }}>
              Change password
            </button>
          </div>
        </div>
      </Card>

      <Card title="Signed-in devices">
        {sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-3 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink/[.05] text-muted"><Icon name="lock" size={17} /></span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[0.9rem]">{describeAgent(s.user_agent)} {s.current && <span className="ml-1 rounded-full bg-ink/10 px-2 py-0.5 text-[0.7rem] font-medium">This device</span>}</div>
              <div className="text-[0.78rem] text-muted">{s.ip} · active {new Date(s.last_used_at).toLocaleString()}</div>
            </div>
          </div>
        ))}
        {sessions.length > 1 && (
          <div className="py-3">
            <button className="btn-soft" onClick={() => run(() => api.post("/api/auth/sessions/revoke-others"), "Signed out of other devices").then(loadSessions)}>Sign out of all other devices</button>
          </div>
        )}
      </Card>

      <Card title="Danger zone">
        <div className="py-4">
          {!showDelete ? (
            <button className="btn-danger" onClick={() => setShowDelete(true)}><Icon name="trash" size={16} /> Delete account</button>
          ) : (
            <div className="space-y-3 anim-rise">
              <p className="text-sm text-muted">This permanently deletes your account, friends and profile. Your username stays reserved and can never be used again.</p>
              <input className="input" type="password" placeholder="Enter your password to confirm" value={delPw} onChange={(e) => setDelPw(e.target.value)} />
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={() => setShowDelete(false)}>Cancel</button>
                <button className="btn-danger" disabled={!delPw} onClick={async () => { if (await run(() => api.post("/api/auth/delete-account", { password: delPw }), "Account deleted")) { stopRealtime(); reset(); } }}>
                  Permanently delete
                </button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}

function describeAgent(ua: string) {
  const browser = /Edg\//.test(ua) ? "Edge" : /Electron/.test(ua) ? "Desktop app" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

function PrivacySection() {
  const me = useStore((s) => s.me)!;
  const save = useSave();
  const setP = (k: keyof Me["privacy"], v: boolean) => save(() => api.patch<{ user: Me }>("/api/me/privacy", { [k]: v }));
  return (
    <>
      <H sub="Control who can find you and what they can see.">Privacy & safety</H>
      <Card>
        <Toggle label="Let people find me by username" hint="When off, nobody can search for you or send you new friend requests." checked={me.privacy.discoverable} onChange={(v) => setP("discoverable", v)} />
        <Toggle label="Allow friend requests" checked={me.privacy.allow_requests} onChange={(v) => setP("allow_requests", v)} />
        <Toggle label="Send read receipts" hint="When off, others won't see when you've read their messages." checked={me.privacy.send_read_receipts} onChange={(v) => setP("send_read_receipts", v)} />
        <Toggle label="Show my online status" hint="When off, you'll always appear offline and your last-seen time is hidden." checked={me.privacy.show_presence} onChange={(v) => setP("show_presence", v)} />
      </Card>
      <div className="rounded-2xl bg-ink/[.035] p-4 text-[0.82rem] leading-relaxed text-muted">
        <div className="mb-1 flex items-center gap-2 font-medium text-ink"><Icon name="lock" size={15} /> About message security</div>
        Messages are sent over an encrypted connection when the server uses HTTPS, and only members of a conversation can read it. Messages are stored on the server and are <strong>not</strong> end-to-end encrypted.
      </div>
    </>
  );
}

function NotificationsSection() {
  const me = useStore((s) => s.me)!;
  const save = useSave();
  const prefs = me.preferences;
  const [perm, setPerm] = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");
  const setPref = (p: Preferences) => save(() => api.patch<{ user: Me }>("/api/me/preferences", p));
  return (
    <>
      <H sub="Choose what reaches you when you're not looking.">Notifications</H>
      {perm !== "granted" && typeof Notification !== "undefined" && (
        <div className="card mb-6 flex items-center gap-4 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent"><Icon name="bell" /></span>
          <div className="flex-1 text-sm">
            <div className="font-medium">Desktop notifications are off</div>
            <div className="text-muted">{perm === "denied" ? "They're blocked in your browser settings." : "Allow them to hear about messages while the app is in the background."}</div>
          </div>
          {perm === "default" && <button className="btn-primary" onClick={() => Notification.requestPermission().then(setPerm)}>Enable</button>}
        </div>
      )}
      <Card>
        <Toggle label="Message notifications" checked={prefs.notify_messages !== false} onChange={(v) => setPref({ notify_messages: v })} />
        <Toggle label="Friend request notifications" checked={prefs.notify_friend_requests !== false} onChange={(v) => setPref({ notify_friend_requests: v })} />
        <Toggle label="Show message previews" hint="Include message text in notifications." checked={prefs.notify_previews !== false} onChange={(v) => setPref({ notify_previews: v })} />
        <Toggle label="Sounds" checked={prefs.notify_sounds !== false} onChange={(v) => setPref({ notify_sounds: v })} />
      </Card>
    </>
  );
}

function AppearanceSection() {
  const me = useStore((s) => s.me)!;
  const save = useSave();
  const prefs = me.preferences;
  const setPref = (p: Preferences) => {
    applyPreferences({ ...prefs, ...p }); // instant feedback
    save(() => api.patch<{ user: Me }>("/api/me/preferences", p));
  };
  const theme = prefs.theme ?? "system";
  const anim = prefs.text_animation ?? "on";
  return (
    <>
      <H sub="Make George's Nappies feel like yours.">Appearance</H>
      <section className="mb-6">
        <div className="section-title mb-2 px-1">Theme</div>
        <div className="grid grid-cols-3 gap-3">
          {(["light", "dark", "system"] as const).map((t) => (
            <button key={t} onClick={() => setPref({ theme: t })} className={`rounded-2xl border-2 p-2 text-left transition-all ${theme === t ? "border-accent" : "border-line hover:border-ink/20"}`}>
              <ThemePreview kind={t} />
              <div className="mt-2 px-1 text-[0.85rem] font-medium capitalize">{t === "system" ? "Automatic" : t}</div>
            </button>
          ))}
        </div>
      </section>
      <section className="mb-6">
        <div className="section-title mb-2 px-1">Message text animation</div>
        <div className="card p-1.5">
          <div className="grid grid-cols-3 gap-1">
            {([["on", "Animated"], ["off", "Off"], ["reduced", "Reduced motion"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => setPref({ text_animation: v })} className={`rounded-xl px-3 py-2 text-[0.85rem] font-medium transition-colors ${anim === v ? "bg-accent text-accent-ink" : "text-muted hover:bg-ink/[.04]"}`}>{l}</button>
            ))}
          </div>
        </div>
        <p className="mt-2 px-1 text-[0.8rem] text-muted">
          Animated reveals incoming messages as if they're being typed. Messages always arrive in full instantly; this only affects how they appear. Reduced motion also removes sliding movement. Your system's reduced-motion setting is respected automatically.
        </p>
      </section>
      <Card>
        <div className="py-3.5">
          <div className="flex items-center justify-between">
            <span>Text size</span>
            <span className="text-sm text-muted">{Math.round((prefs.font_scale ?? 1) * 100)}%</span>
          </div>
          <input type="range" min={0.85} max={1.3} step={0.05} value={prefs.font_scale ?? 1} onChange={(e) => applyPreferences({ ...prefs, font_scale: +e.target.value })} onMouseUp={(e) => setPref({ font_scale: +(e.target as HTMLInputElement).value })} onTouchEnd={(e) => setPref({ font_scale: +(e.target as HTMLInputElement).value })} className="mt-3 w-full accent-[rgb(var(--accent))]" />
        </div>
        <Toggle label="Press Enter to send" hint="When off, use Ctrl+Enter to send and Enter for a new line." checked={prefs.enter_to_send !== false} onChange={(v) => setPref({ enter_to_send: v })} />
      </Card>
    </>
  );
}

function ThemePreview({ kind }: { kind: "light" | "dark" | "system" }) {
  const pane = (dark: boolean) => (
    <div className={`flex h-full flex-1 flex-col justify-end gap-1 p-2 ${dark ? "bg-[#141419]" : "bg-[#F6F6F8]"}`}>
      <div className={`h-2.5 w-3/5 rounded-full ${dark ? "bg-[#2a2a33]" : "bg-[#e3e3ea]"}`} />
      <div className="ml-auto h-2.5 w-1/2 rounded-full bg-accent" />
    </div>
  );
  return (
    <div className="flex h-16 overflow-hidden rounded-xl border border-line">
      {kind === "light" && pane(false)}
      {kind === "dark" && pane(true)}
      {kind === "system" && (<>{pane(false)}{pane(true)}</>)}
    </div>
  );
}
