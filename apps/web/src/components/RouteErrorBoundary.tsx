import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches a render or lazy-load failure of a page (most often a code chunk that no longer exists because the app was
 * deployed while this tab was open) and offers a reload, instead of unmounting the whole app to a white screen.
 */
class Boundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page failed to render:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6" role="alert">
        <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <h1 className="font-heading text-xl font-bold">This page could not load</h1>
          <p className="mt-2 text-sm text-foreground-muted">
            TaskQuest may have been updated while this tab was open. Reloading usually fixes it, and nothing you did was lost.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={() => window.location.reload()}>Reload</Button>
            <Button variant="outline" onClick={() => window.location.assign("/dashboard")}>Go to dashboard</Button>
          </div>
        </div>
      </div>
    );
  }
}

/** One boundary per location, so moving to another page clears a failure of the previous one. */
export const RouteErrorBoundary = ({ children }: Props) => {
  const location = useLocation();
  return <Boundary key={location.pathname}>{children}</Boundary>;
};
