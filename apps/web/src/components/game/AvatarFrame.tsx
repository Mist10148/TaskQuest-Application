import type { EquippedCosmetics } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Wraps an avatar (an img or its initials fallback) in the player's equipped ring.
 * Without a frame it renders the avatar untouched, so every avatar can go through it.
 * The ring is decoration only: the frame colour never carries meaning on its own.
 */
export const AvatarFrame = ({ frame, children, className }: { frame?: EquippedCosmetics["frame"] | null; children: React.ReactNode; className?: string }) => {
  if (!frame) return <>{children}</>;
  return (
    <span className={cn("inline-flex shrink-0 rounded-full p-[3px]", className)} style={{ background: frame.color }} data-frame={frame.id}>
      {children}
    </span>
  );
};

/** The equipped title as small text next to a name; renders nothing when there is none. */
export const EquippedTitle = ({ title, className }: { title?: string | null; className?: string }) => {
  if (!title) return null;
  return (
    <span className={cn("shrink-0 text-[11px] font-medium italic text-foreground-muted", className)} data-testid="equipped-title">
      {title}
    </span>
  );
};
