import type { Preferences } from "./types";

const media = window.matchMedia("(prefers-color-scheme: dark)");
const motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
let current: Preferences = {};

/** Apply theme, accent colour, font scale and motion preference to <html>. */
export function applyPreferences(p: Preferences) {
  current = p;
  const root = document.documentElement;
  const theme = p.theme ?? "system";
  const dark = theme === "dark" || (theme === "system" && media.matches);
  root.dataset.theme = dark ? "dark" : "light";
  root.style.colorScheme = dark ? "dark" : "light";
  // The app is strictly black & white: the accent is always ink (black in light, white in dark).
  root.style.removeProperty("--accent");
  root.style.removeProperty("--accent-ink");
  root.style.fontSize = `${Math.round(16 * (p.font_scale ?? 1))}px`;
  root.dataset.motion = reducedMotion() ? "reduced" : "full";
}

export function reducedMotion() {
  return current.text_animation === "reduced" || motionMedia.matches;
}

export function textAnimationOn() {
  return (current.text_animation ?? "on") === "on" && !motionMedia.matches;
}

media.addEventListener("change", () => applyPreferences(current));
motionMedia.addEventListener("change", () => applyPreferences(current));
