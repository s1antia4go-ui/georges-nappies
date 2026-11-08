import { memo, useEffect, useMemo, useState } from "react";

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** Split into user-perceived characters so emoji, accents and combined scripts never break. */
function graphemes(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  return Array.from(text);
}

/**
 * Progressive "typed onto the screen" reveal of a message that has ALREADY been fully received.
 * The hidden remainder is rendered transparently so the bubble has its final size from the first
 * frame: no layout shifts, no conversation jumping. Speed adapts so short messages read naturally
 * and long ones finish in about 1.4s.
 */
export const RevealText = memo(function RevealText({ text, animate, onDone }: { text: string; animate: boolean; onDone?: () => void }) {
  const parts = useMemo(() => graphemes(text), [text]);
  const [shown, setShown] = useState(animate ? 0 : parts.length);

  useEffect(() => {
    if (!animate) {
      setShown(parts.length);
      return;
    }
    const total = parts.length;
    const msPerChar = Math.max(6, Math.min(28, 1400 / Math.max(total, 1)));
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const n = Math.min(total, Math.floor((now - start) / msPerChar) + 1);
      setShown(n);
      if (n < total) raf = requestAnimationFrame(tick);
      else onDone?.();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, parts]);

  if (shown >= parts.length) return <>{text}</>;
  return (
    <>
      <span>{parts.slice(0, shown).join("")}</span>
      <span className="reveal-caret" aria-hidden />
      <span className="reveal-rest" aria-hidden>
        {parts.slice(shown).join("")}
      </span>
      <span className="sr-only">{parts.slice(shown).join("")}</span>
    </>
  );
});
