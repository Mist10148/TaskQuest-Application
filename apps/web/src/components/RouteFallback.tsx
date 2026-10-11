import { Loader2 } from "lucide-react";

/** Shown while a page's code is loading (pages are split per route). */
export const RouteFallback = () => (
  <div className="flex min-h-screen items-center justify-center bg-background" role="status" aria-live="polite">
    <Loader2 className="h-8 w-8 animate-spin text-primary-text" aria-hidden />
    <span className="sr-only">Loading…</span>
  </div>
);
