import type { User as UserRecord } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "react-router-dom";
import { Sword, Sparkles, Settings, LogOut, Menu, Flame, Search } from "lucide-react";
import { useState } from "react";
import { ClassBadge, PlayerClass } from "@/components/game/ClassBadge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { useAuth, getAvatarUrl } from "@/contexts/AuthContext";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { OnboardingTour } from "@/components/layout/OnboardingTour";
import { AI_NAV_ITEM, NAV_ITEMS } from "@/components/layout/navItems";
import { openCommandPalette } from "@/lib/commands";
import { PrestigeTag } from "@/components/game/PrestigeTag";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

const XP_PER_LEVEL = 100; // mirrors packages/shared XP_PER_LEVEL

/** Thin XP progress toward the next level. */
const LevelBar = ({ lifetimeXP, level, className }: { lifetimeXP: number; level: number; className?: string }) => {
  const current = Math.max(0, lifetimeXP) % XP_PER_LEVEL;
  return (
    <div className={className}>
      <div
        className="h-1.5 rounded-full bg-background-tertiary overflow-hidden"
        role="progressbar"
        aria-label={`Level ${level} progress`}
        aria-valuemin={0}
        aria-valuemax={XP_PER_LEVEL}
        aria-valuenow={current}
      >
        <div className="h-full rounded-full bg-xp transition-all duration-500" style={{ width: `${(current / XP_PER_LEVEL) * 100}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-foreground-muted">{current}/{XP_PER_LEVEL} XP to level {level + 1}</p>
    </div>
  );
};

/** Everything inside the sidebar; shared by the fixed desktop sidebar and the mobile drawer. */
const SidebarContent = ({ onNavigate }: { onNavigate?: () => void }) => {
  const location = useLocation();
  const { user, logout } = useAuth();

  const discord = user?.discord || { username: "Adventurer", globalName: "Adventurer", discordId: "0", avatar: null };
  const dbUser: Partial<UserRecord> = user?.user ?? {};
  const username = discord.globalName || discord.username || "Adventurer";
  const avatarUrl = getAvatarUrl(discord.discordId || "0", discord.avatar || null);
  const playerClass = (dbUser.player_class || "DEFAULT") as PlayerClass;
  const level = dbUser.player_level || 1;
  const streak = dbUser.streak_count || 0;
  const items = user?.features?.ai ? [...NAV_ITEMS.slice(0, 2), AI_NAV_ITEM, ...NAV_ITEMS.slice(2)] : NAV_ITEMS;

  return (
    <div className="flex h-full flex-col">
      <div className="p-4 sm:p-6 border-b border-sidebar-border">
        <Link to="/dashboard" className="flex items-center gap-3 rounded-lg" onClick={onNavigate}>
          <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-primary flex items-center justify-center shrink-0">
            <Sword className="h-5 w-5 sm:h-6 sm:w-6 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p className="font-heading font-bold text-lg sm:text-xl text-foreground">TaskQuest</p>
            <p className="text-[10px] sm:text-xs text-foreground-muted truncate">Level up your productivity</p>
          </div>
        </Link>
      </div>

      <div className="p-3 sm:p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2 sm:gap-3">
          <img src={avatarUrl} alt="" className="h-10 w-10 sm:h-12 sm:w-12 rounded-full border-2 border-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="font-semibold truncate text-sm sm:text-base">{username}</p>
              <PrestigeTag prestige={dbUser.prestige} title={dbUser.prestige_title} />
            </div>
            <ClassBadge playerClass={playerClass} size="sm" />
          </div>
        </div>
        <div className="mt-2 sm:mt-3 flex items-center gap-3 sm:gap-4 text-xs sm:text-sm">
          <div className="flex items-center gap-1">
            <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-xp" aria-hidden />
            <span className="text-xp font-semibold">Lv. {level}</span>
          </div>
          <div className="flex items-center gap-1">
            <Flame className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-destructive-text" aria-hidden />
            <span className="text-foreground-muted">{streak} day streak</span>
          </div>
        </div>
        <LevelBar lifetimeXP={Number(dbUser.lifetime_xp ?? dbUser.player_xp) || 0} level={level} className="mt-3" />
      </div>

      <div className="px-2 pt-2 sm:px-4 sm:pt-4">
        <button
          type="button"
          onClick={() => { onNavigate?.(); openCommandPalette(); }}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-background-secondary px-3 py-2 text-sm text-foreground-muted hover:text-foreground"
        >
          <Search className="h-4 w-4" aria-hidden />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="hidden rounded border border-border px-1.5 text-[10px] font-mono lg:inline">Ctrl K</kbd>
        </button>
      </div>

      <nav aria-label="Main" className="flex-1 p-2 sm:p-4 space-y-0.5 sm:space-y-1 overflow-y-auto">
        {items.map((item) => {
          const isActive = location.pathname === item.path || (item.path === "/chat" && location.pathname.startsWith("/chat/"));
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg transition-all duration-200 font-medium text-sm sm:text-base",
                isActive ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25" : "text-foreground-muted hover:text-foreground hover:bg-sidebar-accent"
              )}
            >
              <item.icon className="h-4 w-4 sm:h-5 sm:w-5 shrink-0" aria-hidden />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-2 sm:p-4 border-t border-sidebar-border space-y-0.5 sm:space-y-1">
        <ThemeToggle className="mb-2 w-full justify-between" />
        <Link
          to="/settings"
          onClick={onNavigate}
          className="flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg text-foreground-muted hover:text-foreground hover:bg-sidebar-accent transition-colors text-sm sm:text-base"
        >
          <Settings className="h-4 w-4 sm:h-5 sm:w-5 shrink-0" aria-hidden />
          <span>Settings</span>
        </Link>
        <button
          type="button"
          onClick={() => void logout()}
          className="w-full flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg text-destructive-text hover:bg-destructive/10 transition-colors text-sm sm:text-base"
        >
          <LogOut className="h-4 w-4 sm:h-5 sm:w-5 shrink-0" aria-hidden />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );
};

export const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user } = useAuth();
  const dbUser: Partial<UserRecord> = user?.user ?? {};
  const level = dbUser.player_level || 1;

  return (
    <div className="min-h-screen bg-background flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-60 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
        Skip to content
      </a>

      {/* Mobile drawer: Radix Sheet gives focus trapping, Escape to close and focus restore to the button. */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        {/* A real header, so the menu button never covers page titles. */}
        <header className="lg:hidden fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-3 backdrop-blur-sm">
          <SheetTrigger asChild>
            <button type="button" className="rounded-lg border border-border bg-card p-2" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
          </SheetTrigger>
          <Link to="/dashboard" className="flex items-center gap-2 font-heading text-lg font-bold">
            <Sword className="h-5 w-5 text-primary-text" aria-hidden /> TaskQuest
          </Link>
          <span className="ml-auto flex items-center gap-1 text-sm font-semibold text-xp">
            <Sparkles className="h-4 w-4" aria-hidden /> Lv. {level}
          </span>
        </header>
        <SheetContent side="left" className="w-72 max-w-[85vw] bg-sidebar p-0 text-sidebar-foreground">
          <SheetHeader className="sr-only">
            <SheetTitle>Menu</SheetTitle>
            <SheetDescription>Navigate TaskQuest</SheetDescription>
          </SheetHeader>
          <SidebarContent onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <aside className="hidden lg:block sticky top-0 h-screen w-72 shrink-0 bg-sidebar border-r border-sidebar-border">
        <SidebarContent />
      </aside>

      <CommandPalette aiEnabled={Boolean(user?.features?.ai)} />
      <OnboardingTour />

      <main id="main" tabIndex={-1} className="flex-1 min-h-screen w-full min-w-0 focus:outline-hidden">
        <div className="pt-18 lg:pt-4 pb-4 px-4 lg:px-8">{children}</div>
      </main>
    </div>
  );
};
