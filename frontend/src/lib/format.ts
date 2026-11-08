const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Sidebar timestamp: time today, "Yesterday", weekday this week, else a short date. */
export function shortWhen(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return timeOf(iso);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  if (now.getTime() - d.getTime() < 6 * 86400000) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "2-digit" });
}

/** Day separator inside a conversation. */
export function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

/** "8 November 2026" in the viewer's locale. */
export function memberSince(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

export function lastSeen(iso: string | null) {
  if (!iso) return "Offline";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "Last seen just now";
  if (mins < 60) return `Last seen ${mins} min ago`;
  if (mins < 60 * 24) return `Last seen ${Math.round(mins / 60)} h ago`;
  return `Last seen ${shortWhen(iso)}`;
}

export function fileSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => [...p][0]?.toUpperCase() ?? "")
    .join("");
