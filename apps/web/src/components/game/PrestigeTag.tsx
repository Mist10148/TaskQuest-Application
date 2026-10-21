import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** Small "Veteran 1" tag next to a name; renders nothing for players who never prestiged. */
export const PrestigeTag = ({ prestige, title, className }: { prestige?: number | null; title?: string | null; className?: string }) => {
  const n = Math.trunc(Number(prestige)) || 0;
  if (n <= 0) return null;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-0.5 rounded-full bg-xp/15 px-1.5 py-0.5 text-[0.625rem] font-semibold leading-none text-xp", className)}
      data-testid="prestige-tag"
    >
      <Star className="h-2.5 w-2.5" aria-hidden />
      <span>{title || "Prestige"}</span>
      <span aria-hidden>{n}</span>
      <span className="sr-only">, prestige {n}</span>
    </span>
  );
};
