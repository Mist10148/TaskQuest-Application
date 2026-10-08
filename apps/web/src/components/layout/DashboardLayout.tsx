import { cn } from "@/lib/utils";
import { Link, useLocation } from "react-router-dom";
import { 
  LayoutDashboard, ListTodo, User, Sword, Sparkles, Trophy, BarChart3,
  Settings, LogOut, Menu, X, Flame, Gamepad2
} from "lucide-react";
import { useState } from "react";
import { ClassBadge, PlayerClass } from "@/components/game/ClassBadge";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth, getAvatarUrl } from "@/contexts/AuthContext";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { path: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { path: "/tasks", icon: ListTodo, label: "Tasks" },
  { path: "/games", icon: Gamepad2, label: "Games" },
  { path: "/profile", icon: User, label: "Profile" },
  { path: "/classes", icon: Sword, label: "Classes" },
  { path: "/skills", icon: Sparkles, label: "Skills" },
  { path: "/achievements", icon: Trophy, label: "Achievements" },
  { path: "/leaderboard", icon: BarChart3, label: "Leaderboard" },
];

export const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout, useMock, login } = useAuth();

  // Get user data with fallbacks
  const discord = user?.discord || { username: 'Adventurer', globalName: 'Adventurer', discordId: '0', avatar: null };
  const dbUser = user?.user || {};
  
  const username = discord.globalName || discord.username || 'Adventurer';
  const avatarUrl = getAvatarUrl(discord.discordId || '0', discord.avatar || null);
  const playerClass = (dbUser.player_class || 'DEFAULT') as PlayerClass;
  const level = dbUser.player_level || 1;
  const streak = dbUser.streak_count || 0;

  const handleLogout = async () => {
    await logout();
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Mobile Menu Button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2.5 rounded-lg bg-card border border-border shadow-lg"
        aria-label="Toggle menu"
      >
        {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Overlay for mobile */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden fixed inset-0 bg-background/80 backdrop-blur-sm z-40"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:sticky top-0 left-0 h-screen w-64 sm:w-72 bg-sidebar border-r border-sidebar-border flex flex-col z-50 transition-transform duration-300",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="p-4 sm:p-6 border-b border-sidebar-border">
          <Link to="/dashboard" className="flex items-center gap-3" onClick={() => setSidebarOpen(false)}>
            <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-primary flex items-center justify-center flex-shrink-0">
              <Sword className="h-5 w-5 sm:h-6 sm:w-6 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="font-heading font-bold text-lg sm:text-xl text-foreground">TaskQuest</h1>
              <p className="text-[10px] sm:text-xs text-foreground-muted truncate">Level up your productivity</p>
            </div>
          </Link>
        </div>

        {/* User Info */}
        <div className="p-3 sm:p-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2 sm:gap-3">
            <img
              src={avatarUrl}
              alt={username}
              className="h-10 w-10 sm:h-12 sm:w-12 rounded-full border-2 border-primary flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate text-sm sm:text-base">{username}</p>
              <ClassBadge playerClass={playerClass} size="sm" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3 flex items-center gap-3 sm:gap-4 text-xs sm:text-sm">
            <div className="flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-xp" />
              <span className="text-xp font-semibold">Lv. {level}</span>
            </div>
            <div className="flex items-center gap-1">
              <Flame className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-destructive" />
              <span className="text-foreground-muted">{streak} day streak</span>
            </div>
          </div>
          {useMock && (
            <button 
              onClick={login}
              className="mt-2 sm:mt-3 w-full text-xs px-3 py-2 rounded-lg bg-[#5865F2] text-white hover:bg-[#4752C4] transition-colors flex items-center justify-center gap-2"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
              </svg>
              Login with Discord
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 sm:p-4 space-y-0.5 sm:space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg transition-all duration-200 font-medium text-sm sm:text-base",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                    : "text-foreground-muted hover:text-foreground hover:bg-sidebar-accent"
                )}
              >
                <item.icon className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer Actions */}
        <div className="p-2 sm:p-4 border-t border-sidebar-border space-y-0.5 sm:space-y-1">
          <Link
            to="/settings"
            onClick={() => setSidebarOpen(false)}
            className="flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg text-foreground-muted hover:text-foreground hover:bg-sidebar-accent transition-colors text-sm sm:text-base"
          >
            <Settings className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
            <span>Settings</span>
          </Link>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg text-destructive hover:bg-destructive/10 transition-colors text-sm sm:text-base"
          >
            <LogOut className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-h-screen w-full">
        <div className="pt-16 lg:pt-4 pb-4 px-4 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
};
