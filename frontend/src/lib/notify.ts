import { useStore } from "../store";

let audioCtx: AudioContext | null = null;

function chime() {
  try {
    audioCtx ??= new AudioContext();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(1320, t + 0.08);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  } catch {
    /* audio unavailable */
  }
}

/** Desktop notification + sound, respecting the user's notification preferences. */
export function notify(title: string, body: string, onClick?: () => void) {
  const prefs = useStore.getState().me?.preferences ?? {};
  if (prefs.notify_messages === false) return;
  if (prefs.notify_sounds !== false) chime();
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body: prefs.notify_previews === false ? "New message" : body.slice(0, 140), icon: `${import.meta.env.BASE_URL}favicon.svg`, silent: true });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    /* Android Chrome doesn't allow page-created notifications. */
  }
}
