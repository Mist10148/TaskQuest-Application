import { Link, useLocation } from "react-router-dom";
import { CalendarCheck, LayoutDashboard, ListTodo, Menu, Timer } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { path: "/today", icon: CalendarCheck, label: "Today" },
  { path: "/tasks", icon: ListTodo, label: "Tasks" },
  { path: "/focus", icon: Timer, label: "Focus" },
  { path: "/dashboard", icon: LayoutDashboard, label: "Home" },
];

/** Four places to go with a thumb, and the full menu. Phones and small tablets only (the sidebar takes over from lg). */
export const MobileBottomNav = ({ onMore }: { onMore: () => void }) => {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Quick navigation" className="lg:hidden fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm">
      {ITEMS.map((item) => {
        const active = pathname === item.path;
        return (
          <Link
            key={item.path}
            to={item.path}
            aria-current={active ? "page" : undefined}
            className={cn("flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", active ? "text-primary-text" : "text-foreground-muted")}
          >
            <item.icon className="h-5 w-5" aria-hidden />
            {item.label}
          </Link>
        );
      })}
      <button type="button" onClick={onMore} className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium text-foreground-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <Menu className="h-5 w-5" aria-hidden />
        More
      </button>
    </nav>
  );
};
