"use client";

import { useEffect, useMemo, useState } from "react";
import { REVEAL_TICK_MS, revealedCount } from "@/lib/felix/reveal";

/**
 * Shows a Felix reply typing out. Screen readers get the whole reply at once in a visually hidden copy, so the polite
 * conversation log announces it once, never per letter; the typed copy is hidden from them. `onDone` fires when the
 * last character is shown, or on unmount, so the owner can stop the pacing.
 */
export function FelixReveal({ text, onDone }: { text: string; onDone: () => void }) {
  const characters = useMemo(() => Array.from(text), [text]);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = window.setInterval(() => {
      const next = revealedCount(Date.now() - start, characters.length);
      setShown(next);
      if (next >= characters.length) { window.clearInterval(timer); onDone(); }
    }, REVEAL_TICK_MS);
    return () => window.clearInterval(timer);
  }, [characters, onDone]);
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{characters.slice(0, shown).join("")}</span>
    </>
  );
}
