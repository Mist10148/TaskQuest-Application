import { breakdownLines } from "@/lib/bonuses";
import type { BonusEntry } from "@/lib/api";

interface Props {
  leveledUp?: boolean;
  newLevel?: number;
  details?: string | null;
  bonuses?: readonly BonusEntry[] | null;
}

/** The lines under an XP toast, one per part of the reward, so it is clear where the XP came from. */
export function RewardBreakdown(props: Props) {
  const lines = breakdownLines(props);
  if (lines.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs" aria-label="Where the XP came from">
      {lines.map((line, i) => (
        <li key={`${i}-${line}`}>{line}</li>
      ))}
    </ul>
  );
}
