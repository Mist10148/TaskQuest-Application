/**
 * Authentication state. The user is either logged in (via Discord OAuth on
 * the server) or not — there is no demo/mock mode, so an API outage shows
 * an error instead of a fake player.
 */

import React, { createContext, useContext, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi, ApiError, type UserData, type DiscordUser } from '@/lib/api';

interface AuthContextType {
    user: UserData | null;
    discord: DiscordUser | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    /** Set when the API is unreachable or failed (not for "logged out"). */
    error: string | null;
    login: () => void;
    logout: () => Promise<void>;
    refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const qc = useQueryClient();
    const query = useQuery({
        queryKey: ['auth', 'me'],
        queryFn: async () => {
            try {
                return await authApi.getMe();
            } catch (err) {
                if (err instanceof ApiError && err.status === 401) return null;
                throw err;
            }
        },
        retry: 1,
        staleTime: 30_000,
    });

    const login = useCallback(() => {
        window.location.href = authApi.getLoginUrl();
    }, []);

    const logout = useCallback(async () => {
        try {
            await authApi.logout();
        } finally {
            qc.clear();
            qc.setQueryData(['auth', 'me'], null);
        }
    }, [qc]);

    const refresh = useCallback(async () => {
        await qc.invalidateQueries({ queryKey: ['auth', 'me'] });
    }, [qc]);

    const user = query.data ?? null;
    const value: AuthContextType = {
        user,
        discord: user?.discord ?? null,
        isLoading: query.isLoading,
        isAuthenticated: Boolean(user),
        error: query.error ? (query.error as Error).message : null,
        login,
        logout,
        refresh,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
    return context;
}

// eslint-disable-next-line react-refresh/only-export-components
export function getAvatarUrl(discordId: string, avatar: string | null, size = 128): string {
    if (avatar && /^(a_)?[a-f0-9]{32}$/.test(avatar)) {
        const ext = avatar.startsWith('a_') ? 'gif' : 'png';
        return `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.${ext}?size=${size}`;
    }
    const defaultIndex = (Number(String(discordId).slice(-3)) || 0) % 5;
    return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
}
