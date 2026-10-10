import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { MotionConfig } from "framer-motion";
import { AuthProvider } from "@/contexts/AuthContext";
import { PreferencesProvider, usePreferences } from "@/contexts/PreferencesContext";
import { CelebrationHost } from "@/components/feedback/CelebrationHost";
import { AuthGate } from "@/components/AuthGate";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import Tasks from "./pages/Tasks";
import Classes from "./pages/Classes";
import Skills from "./pages/Skills";
import Achievements from "./pages/Achievements";
import Leaderboard from "./pages/Leaderboard";
import Games from "./pages/Games";
import Settings from "./pages/Settings";
import Chat from "./pages/Chat";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

/** Framer Motion follows the OS reduced-motion setting, or always when the user turned animations off. */
const MotionRoot = ({ children }: { children: React.ReactNode }) => {
  const { reduceMotion } = usePreferences();
  return <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>{children}</MotionConfig>;
};

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="tq.theme" disableTransitionOnChange>
  <PreferencesProvider>
  <MotionRoot>
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <CelebrationHost />
        <Sonner />
        <BrowserRouter>
          <AuthGate>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/app" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/games" element={<Games />} />
            <Route path="/classes" element={<Classes />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/achievements" element={<Achievements />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/chat/:threadId" element={<Chat />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </AuthGate>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
  </MotionRoot>
  </PreferencesProvider>
  </ThemeProvider>
);

export default App;
