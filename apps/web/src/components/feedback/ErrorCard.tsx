import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  /** What failed to load, e.g. "your quests". */
  what: string;
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
}

/** Shown when a request fails: says what went wrong in plain words and offers a retry. */
export const ErrorCard = ({ what, error, onRetry, retrying }: Props) => {
  const detail = error instanceof Error ? error.message : undefined;
  return (
    <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center">
      <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" aria-hidden />
      <h3 className="font-heading text-lg font-semibold">Couldn't load {what}</h3>
      <p className="mt-1 text-sm text-foreground-muted">
        {detail || "Something went wrong."} Check your connection and try again.
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4 gap-2" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={retrying ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden /> Try again
        </Button>
      )}
    </div>
  );
};
