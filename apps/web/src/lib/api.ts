/**
 * TaskQuest API client.
 *
 * The SPA and the API are served from the same origin (the Express server
 * serves the built app in production; Vite proxies /api in development), so
 * requests are relative and the session cookie is first-party.
 * VITE_API_URL is only needed for unusual split deployments.
 */

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export class ApiError extends Error {
    constructor(message: string, public status: number, public code?: string, public details?: unknown) {
        super(message);
        this.name = 'ApiError';
    }
}

async function apiFetch<T>(endpoint: string, options: RequestInit & { json?: unknown } = {}): Promise<T> {
    const { json, headers, ...rest } = options;
    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...rest,
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
        },
        body: json !== undefined ? JSON.stringify(json) : rest.body,
    });

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new ApiError(body.error || `Request failed (HTTP ${response.status})`, response.status, body.code, body.details);
    }
    return response.json();
}

const post = <T>(endpoint: string, json?: unknown) => apiFetch<T>(endpoint, { method: 'POST', json: json ?? {} });
const patch = <T>(endpoint: string, json?: unknown) => apiFetch<T>(endpoint, { method: 'PATCH', json: json ?? {} });
const del = <T>(endpoint: string) => apiFetch<T>(endpoint, { method: 'DELETE' });

// ─── Auth & user ─────────────────────────────────────────────────────────────

export const authApi = {
    getLoginUrl: () => `${API_BASE}/api/auth/discord`,
    getMe: () => apiFetch<UserData>('/api/auth/me'),
    logout: () => post<{ success: boolean }>('/api/auth/logout'),
};

export const userApi = {
    getProfile: () => apiFetch<UserStats>('/api/user'),
    updateSettings: (settings: Partial<Pick<User, 'gamification_enabled' | 'automation_enabled' | 'auto_delete_old_lists'>>) =>
        patch<User>('/api/user', settings),
    claimDaily: () => post<DailyClaimResult>('/api/user/daily'),
    resetProgress: () => post<{ success: boolean; message: string }>('/api/user/reset', { confirm: 'RESET' }),
};

// ─── Lists & items ───────────────────────────────────────────────────────────

export const listsApi = {
    getAll: () => apiFetch<ListWithCounts[]>('/api/lists'),
    getById: (id: number) => apiFetch<ListWithItems>(`/api/lists/${id}`),
    create: (data: CreateListData) => post<List & RewardFields>('/api/lists', data),
    update: (id: number, data: Partial<CreateListData>) => patch<List>(`/api/lists/${id}`, data),
    delete: (id: number) => del<{ success: boolean }>(`/api/lists/${id}`),
};

export const itemsApi = {
    create: (listId: number, data: { name: string; description?: string }) => post<Item & RewardFields>(`/api/lists/${listId}/items`, data),
    update: (id: number, data: Partial<{ name: string; description: string | null; position: number }>) => patch<Item>(`/api/items/${id}`, data),
    toggle: (id: number) => patch<Item & RewardFields>(`/api/items/${id}/toggle`),
    delete: (id: number) => del<{ success: boolean }>(`/api/items/${id}`),
};

// ─── Progression ─────────────────────────────────────────────────────────────

export const classesApi = {
    getAll: () => apiFetch<ClassesData>('/api/classes'),
    buy: (classKey: string) => post<{ success: boolean; user: User; newAchievements?: AchievementUnlock[] }>(`/api/classes/${classKey}/buy`),
    equip: (classKey: string) => post<{ success: boolean; user: User }>(`/api/classes/${classKey}/equip`),
};

export const skillsApi = {
    getAll: () => apiFetch<SkillsData>('/api/skills'),
    unlock: (skillId: string) => post<{ success: boolean; skill: { skill_id: string; skill_level: number }; balance: number }>(`/api/skills/${skillId}/unlock`),
};

export const achievementsApi = {
    getAll: () => apiFetch<AchievementsData>('/api/achievements'),
};

export const leaderboardApi = {
    get: () => apiFetch<LeaderboardEntry[]>('/api/leaderboard'),
};

// ─── Games (server-authoritative) ────────────────────────────────────────────

export const gamesApi = {
    getHistory: () => apiFetch<GameSession[]>('/api/games/history'),
    getActive: () => apiFetch<{ blackjack: BlackjackActive | null; hangman: HangmanActive | null }>('/api/games/active'),
    blackjackStart: (bet: number) => post<BlackjackResult>('/api/games/blackjack/start', { bet }),
    blackjackAction: (action: 'hit' | 'stand' | 'double') => post<BlackjackResult>('/api/games/blackjack/action', { action }),
    rps: (choice: RpsChoice) => post<RpsResult>('/api/games/rps', { choice }),
    hangmanStart: () => post<HangmanActive>('/api/games/hangman/start'),
    hangmanGuess: (letter: string) => post<HangmanResult>('/api/games/hangman/guess', { letter }),
    arcadeStart: (type: ArcadeType) => post<{ sessionId: number }>(`/api/games/arcade/${type}/start`),
    arcadeFinish: (type: ArcadeType, sessionId: number, score: number) =>
        post<ArcadeResult>(`/api/games/arcade/${type}/finish`, { sessionId, score }),
    quit: (type: 'hangman' | ArcadeType) => post<{ success: boolean }>(`/api/games/${type}/quit`),
};

export const xpApi = {
    getHistory: () => apiFetch<XPTransaction[]>('/api/xp/history'),
};

// ─── Types ───────────────────────────────────────────────────────────────────

export type PlayerClass = 'DEFAULT' | 'HERO' | 'GAMBLER' | 'ASSASSIN' | 'WIZARD' | 'ARCHER' | 'TANK';

export interface User {
    discord_id: string;
    discord_username: string | null;
    discord_avatar: string | null;
    player_xp: number;
    lifetime_xp: number;
    player_level: number;
    player_class: PlayerClass;
    skill_points: number;
    gamification_enabled: boolean | number;
    automation_enabled: boolean | number;
    auto_delete_old_lists: boolean | number;
    streak_count: number;
    last_daily_claim: string | null;
    owns_hero: boolean | number;
    owns_gambler: boolean | number;
    owns_assassin: boolean | number;
    owns_wizard: boolean | number;
    owns_archer: boolean | number;
    owns_tank: boolean | number;
    total_items_added: number;
    total_items_completed: number;
    total_lists_created: number;
}

export interface DiscordUser {
    discordId: string;
    username: string;
    globalName: string | null;
    avatar: string | null;
}

export interface GameStats {
    played: number;
    won: number;
    lost: number;
    draws: number;
}

export interface UserStats {
    user: User;
    lists: { total: number };
    items: { total: number; completed: number };
    achievements: number;
    games: GameStats;
    skills: UserSkill[];
}

export interface UserData extends UserStats {
    discord: DiscordUser;
    userAchievements: { achievement_key: string; unlocked_at: string }[];
}

export interface BonusInfo {
    type?: string | null;
    details: string;
    classBonus?: number;
    skillBonus?: number;
    critBonus?: number;
    totalBonus?: number;
}

export interface XPResult {
    baseXP: number;
    finalXP: number;
    bonusInfo: BonusInfo;
    balanceAfter: number;
    newLevel: number;
    leveledUp: boolean;
    capped: boolean;
}

export interface AchievementUnlock {
    key: string;
    name: string;
    description: string;
    emoji: string;
    category: string;
}

export interface RewardFields {
    xpResult: XPResult | null;
    newAchievements: AchievementUnlock[];
}

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface List {
    id: number;
    discord_id: string;
    name: string;
    description: string | null;
    category: string | null;
    deadline: string | null;
    priority: Priority | null;
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
    completed: boolean | number;
    position: number;
    created_at: string;
}

export interface ListWithItems extends List {
    items: Item[];
}

export interface CreateListData {
    name: string;
    description?: string | null;
    category?: string | null;
    priority?: Priority | null;
    deadline?: string | null;
}

export interface ClassInfo {
    key: PlayerClass;
    name: string;
    emoji: string;
    cost: number;
    description: string;
    playstyle: string;
    owned: boolean;
    equipped: boolean;
}

export interface ClassesData {
    classes: ClassInfo[];
    currentClass: PlayerClass;
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
    classKey: PlayerClass;
    name: string;
    description: string;
    emoji: string;
    classOwned: boolean;
    skills: Skill[];
}

export interface SkillsData {
    skillTrees: SkillTree[];
    skillPoints: number;
    userXP: number;
    playerClass: PlayerClass;
}

export interface UserSkill {
    skill_id: string;
    skill_level: number;
    unlocked_at: string;
}

export interface Achievement extends AchievementUnlock {
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
    username: string;
    avatarUrl: string | null;
    xp: number;
    level: number;
    playerClass: PlayerClass;
    streak: number;
    gamesPlayed: number;
    tasksCompleted: number;
    isYou: boolean;
}

export interface GameSession {
    id: number;
    game_type: string;
    bet_amount: number;
    payout: number;
    net: number;
    state: 'won' | 'lost' | 'push' | 'blackjack' | 'expired' | 'cancelled';
    created_at: string;
    ended_at: string | null;
}

export interface Card {
    rank: string;
    suit: '♠' | '♥' | '♦' | '♣';
}

export interface HandValue {
    value: number;
    soft: boolean;
    bust: boolean;
}

export interface BlackjackView {
    bet: number;
    doubled: boolean;
    finished: boolean;
    outcome: 'won' | 'lost' | 'push' | 'blackjack' | null;
    playerHand: Card[];
    playerValue: HandValue;
    dealerHand: (Card | null)[];
    dealerValue: HandValue;
    canDouble: boolean;
}

export interface BlackjackActive {
    sessionId: number;
    view: BlackjackView;
}

export interface BlackjackResult extends BlackjackActive {
    balance: number;
    maxBet: number;
    resumed?: boolean;
    settlement: null | {
        credited: number;
        net: number;
        bonusInfo: BonusInfo | null;
        achievements: AchievementUnlock[];
    };
}

export type RpsChoice = 'rock' | 'paper' | 'scissors';

export interface RpsResult {
    player: RpsChoice;
    opponent: RpsChoice;
    outcome: 'won' | 'lost' | 'push';
    xpGained: number;
    capped: boolean;
    bonusInfo: BonusInfo | null;
    balance: number;
    achievements: AchievementUnlock[];
}

export interface HangmanView {
    masked: (string | null)[];
    length: number;
    guessed: string[];
    wrong: string[];
    lives: number;
    maxLives: number;
    potentialReward: number;
    finished: boolean;
    outcome: 'won' | 'lost' | null;
    word: string | null;
}

export interface HangmanActive {
    sessionId: number;
    view: HangmanView;
}

export interface HangmanResult extends HangmanActive {
    xpGained: number;
    capped?: boolean;
    bonusInfo?: BonusInfo | null;
    balance: number;
    achievements: AchievementUnlock[];
}

export type ArcadeType = 'snake' | 'dino' | 'invaders';

export interface ArcadeResult {
    sessionId: number;
    gameType: ArcadeType;
    score: number;
    xpGained: number;
    capped: boolean;
    bonusInfo: BonusInfo | null;
    balance: number;
    achievements: AchievementUnlock[];
}

export interface XPTransaction {
    id: number;
    amount: number;
    source: string;
    balance_before: number;
    balance_after: number;
    created_at: string;
}

export interface DailyClaimResult {
    success: boolean;
    error?: string;
    remaining?: number;
    streak?: number;
    baseXP?: number;
    classBonus?: number;
    streakBonus?: number;
    skillDailyBonus?: number;
    totalXP?: number;
    bonusInfo?: BonusInfo;
    streakBroken?: boolean;
    streakPreserved?: boolean;
    newBalance?: number;
    newLevel?: number;
    leveledUp?: boolean;
    newAchievements?: AchievementUnlock[];
}
