import { AI_NAV_ITEM, NAV_ITEMS } from "@/components/layout/navItems";

export const APP_TITLE = "TaskQuest";

const EXTRA_PAGES: Record<string, string> = { "/settings": "Settings" };

/** The browser tab title for a route, e.g. "Today · TaskQuest", so screen readers and the tab strip say where you are. */
export function pageTitle(pathname: string): string {
  const path = `/${pathname.split("/")[1] ?? ""}`;
  const label = [...NAV_ITEMS, AI_NAV_ITEM].find((item) => item.path === path)?.label ?? EXTRA_PAGES[path];
  return label ? `${label} · ${APP_TITLE}` : APP_TITLE;
}
