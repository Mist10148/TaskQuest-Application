/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🔐 AUTH CONTEXT - User authentication state with mock data fallback
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi, userApi } from '@/lib/api';

// Mock data for development/fallback
const MOCK_USER = {
  discord: {
    discordId: '123456789',
    username: 'QuestMaster',
    globalName: 'QuestMaster',
    avatar: null,
  },
  user: {
    discord_id: '123456789',
    player_xp: 1250,
    player_level: 12,
    player_class: 'HERO',
    streak_count: 7,
    gamification_enabled: true,
    automation_enabled: true,
    total_items_completed: 47,
    total_items_added: 58,
    total_lists_created: 5,
  },
  lists: { total: 5 },
  items: { total: 58, completed: 47 },
  achievements: 8,
  games: { played: 23, won: 14, lost: 7, draws: 2 },
};

interface AuthContextType {
  user: any;
  discord: any;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  login: () => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  useMock: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [useMock, setUseMock] = useState(false);

  const fetchUser = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await authApi.getMe();
      if (data && data.discord) {
        // Got real user, now fetch full profile
        try {
          const profile = await userApi.getProfile();
          setUser({ ...data, ...profile });
          setUseMock(false);
        } catch {
          setUser(data);
          setUseMock(false);
        }
      } else {
        throw new Error('No user data');
      }
    } catch (err) {
      // Use mock data as fallback
      console.log('Using mock data (API unavailable or not logged in)');
      setUser(MOCK_USER);
      setUseMock(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const login = () => {
    window.location.href = authApi.getLoginUrl();
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch {}
    setUser(MOCK_USER);
    setUseMock(true);
  };

  const refresh = async () => {
    await fetchUser();
  };

  const value: AuthContextType = {
    user,
    discord: user?.discord || null,
    isLoading,
    isAuthenticated: !!user,
    error,
    login,
    logout,
    refresh,
    useMock,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// No longer redirects - just returns loading state
export function useRequireAuth() {
  const { isAuthenticated, isLoading, useMock } = useAuth();
  return { isAuthenticated: isAuthenticated || useMock, isLoading };
}

export function getAvatarUrl(discordId: string, avatar: string | null, size = 128): string {
  if (avatar) {
    const ext = avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.${ext}?size=${size}`;
  }
  const defaultIndex = (parseInt(discordId) || 0) % 5;
  return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
}
