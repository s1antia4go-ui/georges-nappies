import { useEffect, useRef, type ReactNode } from "react";
import { initials } from "../lib/format";
import type { Presence } from "../lib/types";
import { useStore } from "../store";
import { Icon } from "./Icon";

// Monochrome avatar fallbacks: shades of grey.
const PALETTE = ["#1C1C1E", "#3A3A3C", "#545458", "#6E6E73", "#2C2C2E", "#48484A", "#636366", "#8E8E93"];

export function Avatar({
  name,
  url,
  size = 40,
  presence,
  seed = 0,
  ring,
}: {
  name: string;
  url?: string | null;
  size?: number;
  presence?: Presence | null;
  seed?: number;
  ring?: string;
}) {
  const color = PALETTE[Math.abs(seed) % PALETTE.length];
  const dot = Math.max(10, Math.round(size * 0.28));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt="" draggable={false} className="h-full w-full rounded-full object-cover bg-raised" style={ring ? { boxShadow: `0 0 0 3px ${ring}` } : undefined} />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white select-none"
          style={{ background: color, fontSize: size * 0.38, boxShadow: ring ? `0 0 0 3px ${ring}` : undefined }}
        >
          {initials(name) || "?"}
        </div>
      )}
      {presence && (
        <PresenceDot presence={presence} size={dot} className="absolute -bottom-0.5 -right-0.5" />
      )}
    </div>
  );
}

/**
 * Presence, the only colour in the app: solid green = online, green ring with a
 * green centre pip = idle, hollow grey ring = offline / invisible.
 */
export function PresenceDot({ presence, size = 10, className = "" }: { presence: Presence; size?: number; className?: string }) {
  const border = Math.max(2, Math.round(size * 0.22));
  return (
    <span
      title={presence === "online" ? "Online" : presence === "idle" ? "Idle" : "Offline"}
      className={`flex items-center justify-center rounded-full ring-[2.5px] ring-panel bg-panel transition-all duration-300 ${className}`}
      style={{
        width: size,
        height: size,
        background: presence === "online" ? "rgb(var(--online))" : undefined,
        border: presence === "online" ? undefined : `${border}px solid ${presence === "idle" ? "rgb(var(--online))" : "rgb(var(--faint))"}`,
      }}
    >
      {presence === "idle" && <span className="block rounded-full" style={{ width: Math.max(2, size * 0.2), height: Math.max(2, size * 0.2), background: "rgb(var(--online))" }} />}
    </span>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg className="spinner" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Modal({ title, onClose, children, width = 440 }: { title?: ReactNode; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] anim-fade" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="relative w-full bg-panel rounded-t-3xl sm:rounded-3xl shadow-pop anim-pop max-h-[92vh] flex flex-col outline-none"
        style={{ maxWidth: width }}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between px-6 pt-5 pb-2">
            <h2 className="font-display text-lg font-semibold">{title}</h2>
            <button className="icon-btn -mr-2" onClick={onClose} aria-label="Close">
              <Icon name="close" size={18} />
            </button>
          </div>
        )}
        <div className="overflow-y-auto scroll">{children}</div>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto anim-rise rounded-full px-4 py-2 text-sm font-medium shadow-pop backdrop-blur ${
            t.tone === "error" ? "bg-danger text-white" : "bg-ink text-bg"
          }`}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-center justify-between gap-6 py-3 cursor-pointer select-none">
      <span>
        <span className="block text-[0.95rem]">{label}</span>
        {hint && <span className="block text-[0.8rem] text-muted mt-0.5">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200 ${checked ? "bg-accent" : "bg-ink/15"}`}
      >
        <span
          className={`absolute top-[3px] left-[3px] h-5 w-5 rounded-full shadow transition-transform duration-200 ease-soft ${checked ? "translate-x-[18px] bg-accent-ink" : "bg-white"}`}
        />
      </button>
    </label>
  );
}

export function Empty({ icon, title, text, children }: { icon: Parameters<typeof Icon>[0]["name"]; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-8 py-16 anim-fade">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
        <Icon name={icon} size={26} />
      </div>
      <h3 className="font-display text-[1.05rem] font-semibold">{title}</h3>
      {text && <p className="mt-1 max-w-xs text-sm text-muted">{text}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
