import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { Spinner } from "../components/ui";
import { api, ApiError, qs } from "../lib/api";
import type { Me } from "../lib/types";
import { useStore } from "../store";

type Mode = "login" | "register" | "forgot" | "reset";

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <div className="flex items-center justify-center rounded-[30%] bg-accent text-accent-ink shadow-soft" style={{ width: size, height: size }}>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="currentColor">
        <path d="M4.5 9.2C4.5 6.3 6.8 4 9.7 4h4.6c2.9 0 5.2 2.3 5.2 5.2v3.9c0 2.9-2.3 5.2-5.2 5.2h-2.6L7.8 21v-3.2a5.2 5.2 0 0 1-3.3-4.8V9.2Z" />
        <circle cx="9.6" cy="11" r="1.2" className="fill-accent" />
        <circle cx="14.4" cy="11" r="1.2" className="fill-accent" />
      </svg>
    </div>
  );
}

export function AuthScreen() {
  const resetToken = new URLSearchParams(location.search).get("token");
  // "/app/reset-password?token=…" opens the reset form; "/app#signup" (from the website) opens sign-up.
  const [mode, setMode] = useState<Mode>(
    location.pathname.includes("/reset-password") && resetToken ? "reset" : location.hash === "#signup" ? "register" : "login",
  );
  return (
    <div className="min-h-full flex">
      <aside className="hidden lg:flex w-[44%] max-w-[620px] relative overflow-hidden bg-[#0B0B0C] text-white p-12 flex-col justify-between border-r border-white/5">
        <div className="flex items-center gap-3">
          <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[30%] bg-white text-black">
            <svg width={24} height={24} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M4.5 9.2C4.5 6.3 6.8 4 9.7 4h4.6c2.9 0 5.2 2.3 5.2 5.2v3.9c0 2.9-2.3 5.2-5.2 5.2h-2.6L7.8 21v-3.2a5.2 5.2 0 0 1-3.3-4.8V9.2Z" />
              <circle cx="9.6" cy="11" r="1.2" fill="#fff" />
              <circle cx="14.4" cy="11" r="1.2" fill="#fff" />
            </svg>
          </div>
          <span className="font-display text-[1.35rem] font-semibold tracking-[-0.035em]">George's Nappies</span>
        </div>
        <div className="relative z-10 max-w-md -mt-24">
          <h1 className="font-display text-[2.6rem] leading-[1.08] font-semibold tracking-tight">Conversations that feel effortless.</h1>
          <p className="mt-4 text-white/80 text-[1.05rem]">Private chats, groups and friends in one calm place. Messages arrive the moment they're sent.</p>
        </div>
        <Bubbles />
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
          <span className="whitespace-nowrap text-white/50">© {new Date().getFullYear()} George's Nappies</span>
          <span className="whitespace-nowrap text-white/50">
            Designed &amp; developed by <span className="font-semibold text-white">Santiago Rojas</span>
          </span>
        </div>
      </aside>
      <main className="flex-1 flex flex-col items-center justify-center px-5 py-10">
        <div key={mode} className="w-full max-w-[380px] anim-rise my-auto">
          <div className="lg:hidden mb-8 flex items-center gap-3">
            <Logo size={36} />
            <span className="font-display text-[1.35rem] font-semibold tracking-[-0.035em]">George's Nappies</span>
          </div>
          {mode === "login" && <Login go={setMode} />}
          {mode === "register" && <Register go={setMode} />}
          {mode === "forgot" && <Forgot go={setMode} />}
          {mode === "reset" && <Reset token={resetToken ?? ""} go={setMode} />}
        </div>
        <Credit />
      </main>
    </div>
  );
}

/** Creator credit shown under the sign-in / create-account forms. */
function Credit() {
  return (
    <footer className="mt-10 flex flex-col items-center gap-1.5 text-center anim-fade">
      <div className="flex items-center gap-3 text-faint">
        <span className="h-px w-8 bg-line" />
        <span className="text-[0.68rem] font-semibold uppercase tracking-[0.14em]">Created by</span>
        <span className="h-px w-8 bg-line" />
      </div>
      <span className="font-display text-[0.95rem] font-semibold tracking-[-0.01em]">Santiago Rojas</span>
      <span className="text-[0.72rem] text-faint">Founder &amp; developer of George's Nappies</span>
    </footer>
  );
}

function Bubbles() {
  return (
    <div className="absolute right-10 bottom-24 flex w-[260px] flex-col gap-3 opacity-90 pointer-events-none select-none" aria-hidden>
      <div className="self-start rounded-[20px] rounded-bl-md bg-white/15 px-4 py-2.5 text-sm backdrop-blur anim-msg-left" style={{ animationDelay: "200ms" }}>
        Are we still on for Saturday?
      </div>
      <div className="self-end rounded-[20px] rounded-br-md bg-white text-black px-4 py-2.5 text-sm font-medium anim-msg-right" style={{ animationDelay: "650ms" }}>
        Wouldn't miss it 🎉
      </div>
      <div className="self-start flex gap-1 rounded-[20px] bg-white/15 px-4 py-3.5 anim-msg-left" style={{ animationDelay: "1100ms" }}>
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-white" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-white" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-white" />
      </div>
    </div>
  );
}

function Header({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="mb-7">
      <h1 className="font-display text-[1.75rem] font-semibold tracking-tight">{title}</h1>
      {sub && <p className="mt-1.5 text-muted text-[0.95rem]">{sub}</p>}
    </div>
  );
}

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl bg-danger/10 text-danger text-sm px-3.5 py-2.5 anim-fade" role="alert">
      <Icon name="alert" size={18} className="shrink-0 mt-px" />
      <span>{text}</span>
    </div>
  );
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

function Login({ go }: { go: (m: Mode) => void }) {
  const setMe = useStore((s) => s.setMe);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api.post<{ user: Me }>("/api/auth/login", { login, password });
      setMe(r.user);
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <Header title="Welcome back" sub="Sign in to pick up where you left off." />
      <div>
        <label className="label" htmlFor="login">Username or email</label>
        <input id="login" className="input" autoComplete="username" autoFocus value={login} onChange={(e) => setLogin(e.target.value)} required />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <label className="label" htmlFor="password">Password</label>
          <button type="button" className="text-[0.78rem] text-accent hover:underline mb-1.5" onClick={() => go("forgot")}>
            Forgot password?
          </button>
        </div>
        <input id="password" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <ErrorLine text={error} />
      <button className="btn-primary w-full h-11" disabled={busy}>
        {busy ? <Spinner /> : "Sign in"}
      </button>
      <p className="text-center text-sm text-muted pt-2">
        New here?{" "}
        <button type="button" className="text-accent font-medium hover:underline" onClick={() => go("register")}>
          Create an account
        </button>
      </p>
    </form>
  );
}

function Register({ go }: { go: (m: Mode) => void }) {
  const setMe = useStore((s) => s.setMe);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [check, setCheck] = useState<{ state: "idle" | "checking" | "ok" | "bad"; msg?: string }>({ state: "idle" });
  const { busy, error, run } = useSubmit();

  // Live availability check (debounced) against the backend.
  useEffect(() => {
    const name = username.trim();
    if (!name) return setCheck({ state: "idle" });
    setCheck({ state: "checking" });
    const ctrl = { cancelled: false };
    const t = setTimeout(async () => {
      try {
        const r = await api.get<{ available: boolean; message: string }>(`/api/auth/username-available${qs({ username: name })}`);
        if (!ctrl.cancelled) setCheck({ state: r.available ? "ok" : "bad", msg: r.message });
      } catch (e) {
        if (!ctrl.cancelled) setCheck({ state: "idle", msg: e instanceof ApiError ? e.message : undefined });
      }
    }, 350);
    return () => {
      ctrl.cancelled = true;
      clearTimeout(t);
    };
  }, [username]);

  const strength = pwStrength(password);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api.post<{ user: Me }>("/api/auth/register", { username: username.trim(), display_name: displayName || username, email, password });
      setMe(r.user);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Header title="Create your account" sub="Pick a username. It's yours for good." />
      <div>
        <label className="label" htmlFor="username">Username</label>
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint">@</span>
          <input
            id="username"
            className={`input pl-8 pr-10 ${check.state === "bad" ? "!border-danger/60 focus:!ring-danger/10" : ""}`}
            autoComplete="username"
            autoFocus
            maxLength={20}
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
            required
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            {check.state === "checking" && <span className="text-faint"><Spinner size={16} /></span>}
            {check.state === "ok" && <span className="text-ink anim-status block"><Icon name="check" size={18} /></span>}
            {check.state === "bad" && <span className="text-danger anim-status block"><Icon name="alert" size={18} /></span>}
          </span>
        </div>
        <p className={`mt-1.5 text-[0.78rem] min-h-[1.1em] transition-colors ${check.state === "bad" ? "text-danger" : check.state === "ok" ? "text-ink" : "text-faint"}`}>
          {check.msg ?? "One word: letters, numbers and underscores. Can't be changed later."}
        </p>
      </div>
      <div>
        <label className="label" htmlFor="display">Display name</label>
        <input id="display" className="input" maxLength={40} placeholder={username || "How your name appears"} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" type="email" className="input" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="newpw">Password</label>
        <input id="newpw" type="password" className="input" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required />
        <div className="mt-2 flex gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i < strength.score ? strength.color : "bg-ink/10"}`} />
          ))}
        </div>
        <p className="mt-1.5 text-[0.78rem] text-faint">{password ? strength.label : "At least 10 characters."}</p>
      </div>
      <ErrorLine text={error} />
      <button className="btn-primary w-full h-11" disabled={busy || check.state === "bad" || check.state === "checking"}>
        {busy ? <Spinner /> : "Create account"}
      </button>
      <p className="text-center text-sm text-muted pt-2">
        Already have an account?{" "}
        <button type="button" className="text-accent font-medium hover:underline" onClick={() => go("login")}>
          Sign in
        </button>
      </p>
    </form>
  );
}

function pwStrength(pw: string) {
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < 10) score = Math.min(score, 1);
  const labels = ["Too short", "Weak", "Okay", "Good", "Strong"];
  const colors = ["bg-ink/40", "bg-ink/40", "bg-ink/60", "bg-ink", "bg-ink"];
  return { score, label: labels[score], color: colors[score] };
}

function Forgot({ go }: { go: (m: Mode) => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api.post<{ message: string }>("/api/auth/forgot", { email });
      setSent(r.message);
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <Header title="Reset your password" sub="We'll email you a link to choose a new one." />
      {sent ? (
        <div className="rounded-xl bg-online/10 text-[rgb(var(--online))] px-4 py-3 text-sm anim-fade">{sent}</div>
      ) : (
        <>
          <div>
            <label className="label" htmlFor="femail">Email</label>
            <input id="femail" type="email" className="input" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <ErrorLine text={error} />
          <button className="btn-primary w-full h-11" disabled={busy}>
            {busy ? <Spinner /> : "Send reset link"}
          </button>
        </>
      )}
      <button type="button" className="btn-ghost w-full" onClick={() => go("login")}>
        <Icon name="back" size={16} /> Back to sign in
      </button>
    </form>
  );
}

function Reset({ token, go }: { token: string; go: (m: Mode) => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const { busy, error, run, setError } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError("Passwords don't match.");
    run(async () => {
      await api.post("/api/auth/reset", { token, password });
      setDone(true);
      history.replaceState(null, "", import.meta.env.BASE_URL);
    });
  };
  if (done)
    return (
      <div className="space-y-4">
        <Header title="Password updated" sub="You've been signed out everywhere. Sign in with your new password." />
        <button className="btn-primary w-full h-11" onClick={() => go("login")}>Sign in</button>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-4">
      <Header title="Choose a new password" />
      <div>
        <label className="label" htmlFor="rp1">New password</label>
        <input id="rp1" type="password" className="input" autoComplete="new-password" minLength={10} autoFocus value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="rp2">Confirm password</label>
        <input id="rp2" type="password" className="input" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </div>
      <ErrorLine text={error} />
      <button className="btn-primary w-full h-11" disabled={busy}>
        {busy ? <Spinner /> : "Update password"}
      </button>
    </form>
  );
}
