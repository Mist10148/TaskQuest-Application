import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldAlert } from "lucide-react";

const LOGIN_ERRORS: Record<string, string> = {
  access_denied: "Discord login was cancelled.",
  invalid_state: "Your login link expired. Please try again.",
  token_failed: "Discord rejected the login. Please try again.",
  profile_failed: "Could not read your Discord profile.",
  session_failed: "Could not start your session. Please try again.",
};

/**
 * Renders the app only for logged-in users. Everyone else sees a Discord
 * login screen; API outages show an error instead of fake data.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated, error, login, refresh } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isAuthenticated) return <>{children}</>;

  const loginError = new URLSearchParams(window.location.search).get("error");

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-[0_0_40px_rgba(99,102,241,0.15)]">
        <img src="/taskquest-icon.svg" alt="" className="mx-auto mb-4 h-16 w-16" />
        <h1 className="text-3xl font-heading font-bold mb-2 bg-gradient-to-r from-primary via-cyan-400 to-primary bg-clip-text text-transparent">TaskQuest</h1>
        <p className="text-foreground-muted mb-6">Level up your productivity. Your lists, XP, classes and games sync with the TaskQuest Discord bot.</p>

        {error ? (
          <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2 justify-center">
            <ShieldAlert className="h-4 w-4" /> Can't reach the TaskQuest server right now.
            <button className="underline" onClick={() => refresh()}>Retry</button>
          </div>
        ) : loginError ? (
          <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {LOGIN_ERRORS[loginError] || "Login failed. Please try again."}
          </div>
        ) : null}

        <Button onClick={login} className="w-full gap-2 bg-[#5865F2] hover:bg-[#4752C4] text-white">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
          </svg>
          Login with Discord
        </Button>
        <p className="mt-4 text-xs text-foreground-muted">We only request your Discord username and avatar (the <code>identify</code> scope).</p>
      </div>
    </div>
  );
}
