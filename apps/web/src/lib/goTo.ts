/** "g" then a letter jumps to a page from anywhere (like many web apps): g d Dashboard, g t Today, and so on. */
export const GO_TO_KEYS: ReadonlyArray<{ key: string; path: string; label: string; ai?: boolean }> = [
  { key: "d", path: "/dashboard", label: "Dashboard" },
  { key: "t", path: "/today", label: "Today" },
  { key: "q", path: "/tasks", label: "Quest log" },
  { key: "f", path: "/focus", label: "Focus" },
  { key: "s", path: "/stats", label: "Stats" },
  { key: "p", path: "/profile", label: "Profile" },
  { key: "l", path: "/leaderboard", label: "Leaderboard" },
  { key: "c", path: "/chat", label: "AI Chat", ai: true },
];

/** How long after "g" the second key still counts. */
export const GO_TO_WINDOW_MS = 1500;

/** The page for the key pressed after "g", or null (AI Chat only when AI is on). */
export function goToPath(key: string, aiEnabled: boolean): string | null {
  const hit = GO_TO_KEYS.find((g) => g.key === key.toLowerCase() && (!g.ai || aiEnabled));
  return hit ? hit.path : null;
}
