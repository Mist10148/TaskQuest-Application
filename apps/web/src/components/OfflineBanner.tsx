import { WifiOff } from "lucide-react";
import { useOnline } from "@/lib/online";

/** A thin notice at the top of the screen while the browser is offline, so failed saves are not a mystery. */
export const OfflineBanner = () => {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 top-0 z-60 flex items-center justify-center gap-2 border-b border-border bg-card px-4 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))] text-sm text-foreground shadow-sm">
      <WifiOff className="h-4 w-4 text-destructive-text" aria-hidden />
      <span>You're offline. Changes can't be saved until you reconnect.</span>
    </div>
  );
};
