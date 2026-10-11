import { LayoutDashboard, ListTodo, User, Sword, Sparkles, Trophy, BarChart3, Gamepad2, Bot, ClipboardCheck, Activity } from "lucide-react";

export const NAV_ITEMS = [
  { path: "/dashboard", icon: LayoutDashboard, label: "Dashboard", keywords: "home overview" },
  { path: "/tasks", icon: ListTodo, label: "Tasks", keywords: "quests todo lists" },
  { path: "/games", icon: Gamepad2, label: "Games", keywords: "arcade play blackjack" },
  { path: "/review", icon: ClipboardCheck, label: "Weekly review", keywords: "week recap bonus" },
  { path: "/stats", icon: Activity, label: "Stats", keywords: "charts history heatmap xp progress" },
  { path: "/profile", icon: User, label: "Profile", keywords: "stats me" },
  { path: "/classes", icon: Sword, label: "Classes", keywords: "shop buy equip" },
  { path: "/skills", icon: Sparkles, label: "Skills", keywords: "tree upgrade unlock" },
  { path: "/achievements", icon: Trophy, label: "Achievements", keywords: "badges trophies" },
  { path: "/leaderboard", icon: BarChart3, label: "Leaderboard", keywords: "ranking top players" },
];

/** Shown only when the server has AI enabled for this user. */
export const AI_NAV_ITEM = { path: "/chat", icon: Bot, label: "AI Chat", keywords: "assistant ask" };
