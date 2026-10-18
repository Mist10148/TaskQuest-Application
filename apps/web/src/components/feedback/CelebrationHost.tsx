import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { onCelebrate, type CelebrationKind } from "@/lib/celebrate";
import { usePreferences } from "@/contexts/PreferencesContext";

const COLORS = ["hsl(var(--xp))", "hsl(var(--primary))", "hsl(var(--success))", "hsl(var(--destructive))", "hsl(var(--primary-glow))"];
const PIECES = 28;

interface Burst {
  id: number;
  kind: CelebrationKind;
}

/**
 * Confetti burst for level-ups, achievements and quests. It is decoration only
 * (the toast carries the information), is hidden from screen readers, never
 * blocks clicks, and is skipped entirely when the user prefers reduced motion.
 */
export const CelebrationHost = () => {
  const [bursts, setBursts] = useState<Burst[]>([]);
  // The OS setting or the app's own "Reduce motion" switch (useReducedMotion reads only the OS one).
  const { reduceMotion } = usePreferences();
  const reduced = useReducedMotion() || reduceMotion;

  useEffect(() => {
    let next = 0;
    return onCelebrate((kind) => {
      if (reduced) return;
      const id = ++next;
      setBursts((b) => [...b, { id, kind }]);
      window.setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 1800);
    });
  }, [reduced]);

  return (
    <div className="pointer-events-none fixed inset-0 z-70 overflow-hidden" aria-hidden="true">
      <AnimatePresence>
        {bursts.map((burst) => (
          <div key={burst.id} className="absolute left-1/2 top-1/3">
            {Array.from({ length: burst.kind === "level" ? PIECES : PIECES / 2 }, (_, i) => {
              const angle = (i / (burst.kind === "level" ? PIECES : PIECES / 2)) * Math.PI * 2 + (i % 3) * 0.2;
              const distance = 120 + ((i * 37) % 120);
              return (
                <motion.span
                  key={i}
                  className="absolute block h-2.5 w-1.5 rounded-sm"
                  style={{ backgroundColor: COLORS[i % COLORS.length] }}
                  initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
                  animate={{ x: Math.cos(angle) * distance, y: Math.sin(angle) * distance + 160, opacity: 0, rotate: 360 + i * 40, scale: 0.6 }}
                  transition={{ duration: 1.4, ease: "easeOut" }}
                />
              );
            })}
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
};
