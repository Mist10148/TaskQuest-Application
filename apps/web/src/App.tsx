import { Suspense, lazy } from "react";
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
import { RouteFallback } from "@/components/RouteFallback";
import { AuthGate } from "@/components/AuthGate";

// Each page is its own chunk, so the first visit downloads only what it shows.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Profile = lazy(() => import("./pages/Profile"));
const Tasks = lazy(() => import("./pages/Tasks"));
const Classes = lazy(() => import("./pages/Classes"));
const Skills = lazy(() => import("./pages/Skills"));
const Achievements = lazy(() => import("./pages/Achievements"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Games = lazy(() => import("./pages/Games"));
const Settings = lazy(() => import("./pages/Settings"));
const Focus = lazy(() => import("./pages/Focus"));
const Review = lazy(() => import("./pages/Review"));
const Stats = lazy(() => import("./pages/Stats"));
const Chat = lazy(() => import("./pages/Chat"));
const NotFound = lazy(() => import("./pages/NotFound"));

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
          <Suspense fallback={<RouteFallback />}>
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
            <Route path="/focus" element={<Focus />} />
            <Route path="/review" element={<Review />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/chat/:threadId" element={<Chat />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
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
