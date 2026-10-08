/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🌐 API CLIENT - Connects frontend to backend
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * Base fetch wrapper with credentials
 */
async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTH API
// ═══════════════════════════════════════════════════════════════════════════════

export const authApi = {
    getLoginUrl: () => `${API_BASE}/api/auth/discord`,
    
    getMe: () => apiFetch<UserData>('/api/auth/me'),
    
    logout: () => apiFetch<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),
};

// ═══════════════════════════════════════════════════════════════════════════════
//  USER API
// ═══════════════════════════════════════════════════════════════════════════════

export const userApi = {
    getProfile: () => apiFetch<UserStats>('/api/user'),
    
    updateSettings: (settings: { gamification_enabled?: boolean; automation_enabled?: boolean; auto_delete_old_lists?: boolean }) =>
        apiFetch<User>('/api/user', { method: 'PATCH', body: JSON.stringify(settings) }),
    
    claimDaily: () => apiFetch<DailyClaimResult>('/api/user/daily', { method: 'POST' }),
    
    resetProgress: () => apiFetch<{ success: boolean; message: string }>('/api/user/reset', { method: 'POST' }),
};

// ═══════════════════════════════════════════════════════════════════════════════
//  LISTS API
// ═══════════════════════════════════════════════════════════════════════════════

export const listsApi = {
    getAll: () => apiFetch<ListWithCounts[]>('/api/lists'),
    
    getById: (id: number) => apiFetch<ListWithItems>(`/api/lists/${id}`),
    
    create: (data: CreateListData) =>
        apiFetch<List>('/api/lists', { method: 'POST', body: JSON.stringify(data) }),
    
    update: (id: number, data: Partial<CreateListData>) =>
        apiFetch<List>(`/api/lists/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    
    delete: (id: number) =>
        apiFetch<{ success: boolean }>(`/api/lists/${id}`, { method: 'DELETE' }),
};

// ═══════════════════════════════════════════════════════════════════════════════
//  ITEMS API
// ═══════════════════════════════════════════════════════════════════════════════

export const itemsApi = {
    create: (listId: number, data: { name: string; description?: string }) =>
        apiFetch<Item>(`/api/lists/${listId}/items`, { method: 'POST', body: JSON.stringify(data) }),
    
    update: (id: number, data: Partial<{ name: string; description: string; position: number }>) =>
        apiFetch<Item>(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    
    toggle: (id: number) =>
        apiFetch<Item>(`/api/items/${id}/toggle`, { method: 'PATCH' }),
    
    delete: (id: number) =>
        apiFetch<{ success: boolean }>(`/api/items/${id}`, { method: 'DELETE' }),
};

// ═══════════════════════════════════════════════════════════════════════════════
//  CLASSES API
// ═══════════════════════════════════════════════════════════════════════════════

export const classesApi = {
    getAll: () => apiFetch<ClassesData>('/api/classes'),
    
    buy: (classKey: string) =>
        apiFetch<{ success: boolean; user: User }>(`/api/classes/${classKey}/buy`, { method: 'POST' }),
    
    equip: (classKey: string) =>
        apiFetch<{ success: boolean; user: User }>(`/api/classes/${classKey}/equip`, { method: 'POST' }),
};

// ═══════════════════════════════════════════════════════════════════════════════
//  SKILLS API
// ═══════════════════════════════════════════════════════════════════════════════

export const skillsApi = {
    getAll: () => apiFetch<SkillsData>('/api/skills'),
    
    unlock: (skillId: string, classKey: string) =>
        apiFetch<{ success: boolean; skill: UserSkill }>(
            `/api/skills/${skillId}/unlock`,
            { method: 'POST', body: JSON.stringify({ classKey }) }
        ),
};

// ═══════════════════════════════════════════════════════════════════════════════
//  ACHIEVEMENTS API
// ═══════════════════════════════════════════════════════════════════════════════

export const achievementsApi = {
    getAll: () => apiFetch<AchievementsData>('/api/achievements'),
};

// ═══════════════════════════════════════════════════════════════════════════════
//  LEADERBOARD API
// ═══════════════════════════════════════════════════════════════════════════════

export const leaderboardApi = {
    get: () => apiFetch<LeaderboardEntry[]>('/api/leaderboard'),
};

// ═══════════════════════════════════════════════════════════════════════════════
//  GAMES API
// ═══════════════════════════════════════════════════════════════════════════════

export const gamesApi = {
    getHistory: () => apiFetch<GameSession[]>('/api/games/history'),
    
    recordResult: (data: { gameType: string; result: string; bet: number; payout: number }) =>
        apiFetch<{ success: boolean; xpChange: number; newBalance: number }>(
            '/api/games/result',
            { method: 'POST', body: JSON.stringify(data) }
        ),
};

// ═══════════════════════════════════════════════════════════════════════════════
//  XP API
// ═══════════════════════════════════════════════════════════════════════════════

export const xpApi = {
    getHistory: () => apiFetch<XPTransaction[]>('/api/xp/history'),
};

// ═══════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface User {
    discord_id: string;
    player_xp: number;
    player_level: number;
    player_class: string;
    skill_points: number;
    gamification_enabled: boolean;
    automation_enabled: boolean;
    auto_delete_old_lists: boolean;
    streak_count: number;
    last_daily_claim: string | null;
    owns_hero: boolean;
    owns_gambler: boolean;
    owns_assassin: boolean;
    owns_wizard: boolean;
    owns_archer: boolean;
    owns_tank: boolean;
}

export interface DiscordUser {
    discordId: string;
    username: string;
    globalName: string | null;
    avatar: string | null;
    discriminator: string;
}

export interface UserData {
    discord: DiscordUser;
    user: User;
    lists: { total: number };
    items: { total: number; completed: number };
    achievements: number;
    games: { played: number; won: number; lost: number; draws: number };
    skills: UserSkill[];
    userAchievements: Achievement[];
}

export interface UserStats {
    user: User;
    lists: { total: number };
    items: { total: number; completed: number };
    achievements: number;
    games: { played: number; won: number; lost: number; draws: number };
    skills: UserSkill[];
}

export interface List {
    id: number;
    discord_id: string;
    name: string;
    description: string | null;
    category: string | null;
    deadline: string | null;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | null;
    created_at: string;
}

export interface ListWithCounts extends List {
    itemsTotal: number;
    itemsCompleted: number;
}

export interface Item {
    id: number;
    list_id: number;
    name: string;
    description: string | null;
    completed: boolean;
    position: number;
    created_at: string;
}

export interface ListWithItems extends List {
    items: Item[];
}

export interface CreateListData {
    name: string;
    description?: string;
    category?: string;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH';
    deadline?: string;
}

export interface ClassInfo {
    key: string;
    name: string;
    emoji: string;
    cost: number;
    description: string;
    playstyle: string;
    color: string;
    owned: boolean;
    equipped: boolean;
}

export interface ClassesData {
    classes: ClassInfo[];
    currentClass: string;
    playerXP: number;
}

export interface Skill {
    id: string;
    name: string;
    emoji: string;
    description: string;
    maxLevel: number;
    cost: number;
    requires: string | null;
    currentLevel: number;
}

export interface SkillTree {
    classKey: string;
    name: string;
    description: string;
    emoji: string;
    color: string;
    skills: Skill[];
}

export interface SkillsData {
    skillTrees: SkillTree[];
    skillPoints: number;
    userXP: number;
}

export interface UserSkill {
    discord_id: string;
    skill_id: string;
    skill_level: number;
    unlocked_at: string;
}

export interface Achievement {
    key: string;
    name: string;
    description: string;
    emoji: string;
    category: string;
    unlocked: boolean;
    unlockedAt: string | null;
}

export interface AchievementsData {
    achievements: Achievement[];
    unlockedCount: number;
    totalCount: number;
}

export interface LeaderboardEntry {
    rank: number;
    discordId: string;
    xp: number;
    level: number;
    playerClass: string;
    streak: number;
    gamesPlayed: number;
    tasksCompleted: number;
}

export interface GameSession {
    id: number;
    discord_id: string;
    game_type: string;
    bet_amount: number;
    state: string;
    payout: number;
    started_at: string;
    ended_at: string;
}

export interface XPTransaction {
    id: number;
    discord_id: string;
    amount: number;
    source: string;
    balance_before: number;
    balance_after: number;
    created_at: string;
}

export interface DailyClaimResult {
    success: boolean;
    error?: string;
    baseXP?: number;
    classBonus?: number;
    streakBonus?: number;
    skillDailyBonus?: number;
    totalXP?: number;
    bonusInfo?: {
        type: string | null;
        details: string;
    };
    streak?: number;
    streakBroken?: boolean;
    newBalance?: number;
    newLevel?: number;
    remaining?: number;
    newAchievements?: any[];
}
