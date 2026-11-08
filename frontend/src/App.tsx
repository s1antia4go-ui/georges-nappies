import { useEffect } from "react";
import { Toasts } from "./components/ui";
import { api } from "./lib/api";
import { startRealtime, stopRealtime } from "./lib/realtime";
import { applyPreferences } from "./lib/theme";
import type { Me } from "./lib/types";
import { AppShell } from "./screens/AppShell";
import { AuthScreen, Logo } from "./screens/Auth";
import { useStore } from "./store";

export default function App() {
  const me = useStore((s) => s.me);
  const checked = useStore((s) => s.authChecked);
  const setMe = useStore((s) => s.setMe);
  const reset = useStore((s) => s.reset);

  // Restore the session on load.
  useEffect(() => {
    applyPreferences({});
    if (location.pathname.includes("/reset-password")) return setMe(null);
    api.get<{ user: Me }>("/api/auth/me").then((r) => setMe(r.user)).catch(() => setMe(null));
  }, [setMe]);

  // Session expired / revoked anywhere -> back to sign-in.
  useEffect(() => {
    const onUnauth = () => {
      stopRealtime();
      reset();
    };
    window.addEventListener("gn:unauthorized", onUnauth);
    return () => window.removeEventListener("gn:unauthorized", onUnauth);
  }, [reset]);

  const meId = me?.id;
  useEffect(() => {
    if (!meId) {
      applyPreferences({});
      return;
    }
    const s = useStore.getState();
    applyPreferences(s.me!.preferences);
    s.loadConversations().catch(() => {});
    s.loadFriends().catch(() => {});
    startRealtime();
    return () => stopRealtime();
  }, [meId]);

  if (!checked) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="anim-pop"><Logo size={56} /></div>
      </div>
    );
  }
  return (
    <>
      {me ? <AppShell /> : <AuthScreen />}
      <Toasts />
    </>
  );
}
