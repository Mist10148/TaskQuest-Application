/**
 * TaskQuest API client.
 *
 * The SPA and the API are served from the same origin (the Express server
 * serves the built app in production; Vite proxies /api in development), so
 * requests are relative and the session cookie is first-party.
 * VITE_API_URL is only needed for unusual split deployments.
 */

import type { ListRole, MemberLike, SharingFields } from './sharing';
import { isNetworkFailure, OFFLINE_MESSAGE } from './online';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

/** The full address of an API path, for links the browser follows itself (downloads, the calendar feed). */
export const apiUrl = (path: string): string => (API_BASE ? `${API_BASE}${path}` : `${window.location.origin}${path}`);

export class ApiError extends Error {
    constructor(message: string, public status: number, public code?: string, public details?: unknown) {
        super(message);
        this.name = 'ApiError';
    }
}

async function apiFetch<T>(endpoint: string, options: RequestInit & { json?: unknown } = {}): Promise<T> {
    const { json, headers, ...rest } = options;
    let response: Response;
    try {
        response = await fetch(`${API_BASE}${endpoint}`, {
            ...rest,
            credentials: 'include',
            headers: {
                Accept: 'application/json',
                ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
                ...headers,
            },
            body: json !== undefined ? JSON.stringify(json) : rest.body,
        });
    } catch (err) {
        // fetch rejects with a bare TypeError ("Failed to fetch") when the network is down: say so in words.
        if (isNetworkFailure(err)) throw new ApiError(OFFLINE_MESSAGE, 0, 'NETWORK');
        throw err;
    }

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new ApiError(body.error || `Request failed (HTTP ${response.status})`, response.status, body.code, body.details);
    }
    return response.json();
}

const post = <T>(endpoint: string, json?: unknown) => apiFetch<T>(endpoint, { method: 'POST', json: json ?? {} });
const patch = <T>(endpoint: string, json?: unknown) => apiFetch<T>(endpoint, { method: 'PATCH', json: json ?? {} });
const del = <T>(endpoint: string, init: RequestInit = {}) => apiFetch<T>(endpoint, { ...init, method: 'DELETE' });

// ─── Auth & user ─────────────────────────────────────────────────────────────

export const authApi = {
    getLoginUrl: () => `${API_BASE}/api/auth/discord`,
    getMe: () => apiFetch<UserData>('/api/auth/me'),
    logout: () => post<{ success: boolean }>('/api/auth/logout'),
};

export const userApi = {
    getProfile: () => apiFetch<UserStats>('/api/user'),
    updateSettings: (settings: Partial<Pick<User, 'gamification_enabled' | 'automation_enabled' | 'auto_delete_old_lists' | 'ai_enabled' | 'weekly_digest' | 'accept_invites' | 'timezone' | 'reminder_hour'>>) =>
        patch<User>('/api/user', settings),
    claimDaily: () => post<DailyClaimResult>('/api/user/daily'),
    resetProgress: () => post<{ success: boolean; message: string }>('/api/user/reset', { confirm: 'RESET' }),
    getCalendarToken: () => apiFetch<{ token: string | null }>('/api/user/calendar-token'),
    createCalendarToken: () => post<{ token: string }>('/api/user/calendar-token'),
    revokeCalendarToken: () => del<{ success: boolean }>('/api/user/calendar-token'),
    importData: (data: unknown) => post<{ success: boolean; lists: number; items: number }>('/api/user/import', data),
    getPrestige: () => apiFetch<PrestigeStatus>('/api/user/prestige'),
    prestige: () => post<PrestigeResult>('/api/user/prestige', { confirm: 'PRESTIGE' }),
    buyStreakFreeze: () => post<{ success: boolean; freezes: number; cost: number; max?: number; newBalance: number; newAchievements: AchievementUnlock[] }>('/api/user/streak-freeze'),
};

export interface CsvPreviewRow { row: number; list: string; task: string; due_date: string | null; priority: string | null; tags: string | null; completed: boolean }
export interface CsvImportCheck { ok: boolean; rows: number; lists: number; items: number; preview: CsvPreviewRow[]; errors: Array<{ row: number; message: string }>; errorCount: number }

export interface TaskSearchHit { id: number; name: string; description: string | null; completed: boolean; parent_id: number | null; due_date: string | null; list_id: number; list_name: string }

export interface TemplateItem { name: string; description?: string; priority?: Priority; tags?: string; recurrence?: 'daily' | 'weekly' | 'monthly' }
export interface TaskTemplate { id: number; name: string; description: string | null; items: TemplateItem[]; itemCount: number; created_at: string }

export const templatesApi = {
    getAll: () => apiFetch<TaskTemplate[]>('/api/templates'),
    delete: (id: number) => del<{ success: boolean }>(`/api/templates/${id}`),
    /** Without listId a new quest is created (named listName, else after the template). */
    apply: (id: number, body: { listName?: string; listId?: number } = {}) =>
        post<RewardFields & { list: List; items: Item[]; created: boolean }>(`/api/templates/${id}/apply`, body),
    saveList: (listId: number, name?: string) => post<TaskTemplate>(`/api/lists/${listId}/save-as-template`, name ? { name } : {}),
};

export const importApi = {
    /** Validate a CSV without writing anything. */
    checkCsv: (csv: string) => post<CsvImportCheck>('/api/import/csv', { csv, dryRun: true }),
    importCsv: (csv: string) => post<{ success: boolean; rows: number; lists: number; items: number }>('/api/import/csv', { csv }),
};

// ─── Lists & items ───────────────────────────────────────────────────────────

export const listsApi = {
    getAll: () => apiFetch<ListWithCounts[]>('/api/lists'),
    getById: (id: number) => apiFetch<ListWithItems>(`/api/lists/${id}`),
    /** Tasks whose name or description contains the text, with their quest (at most 50). */
    searchTasks: (q: string) => apiFetch<{ lists: List[]; tasks: TaskSearchHit[] }>(`/api/lists/search?${new URLSearchParams({ q, scope: 'tasks' })}`),
    create: (data: CreateListData) => post<List & RewardFields>('/api/lists', data),
    update: (id: number, data: Partial<CreateListData>) => patch<List>(`/api/lists/${id}`, data),
    delete: (id: number) => del<{ success: boolean }>(`/api/lists/${id}`),
    reorder: (id: number, itemIds: number[]) => patch<Item[]>(`/api/lists/${id}/reorder`, { itemIds }),
};

// ─── Shared lists: members and invitations ───────────────────────────────────

export interface ListMember extends MemberLike {
    name: string | null;
    since?: string;
}

export interface ListInvite {
    id: number;
    inviteeName: string | null;
    role: ListRole;
    createdAt: string;
    expiresAt: string;
}

export interface ListMembers {
    list: { id: number; name: string };
    role: ListRole;
    isOwner: boolean;
    members: ListMember[];
    /** Pending invitations (managers only, otherwise empty). */
    invites: ListInvite[];
    /** Most people besides the owner (members plus pending invitations). */
    limit: number;
}

export interface MyInvite {
    id: number;
    listName: string;
    ownerName: string | null;
    invitedByName: string | null;
    role: ListRole;
    createdAt: string;
    expiresAt: string;
}

/** Shown when an invitation cannot be confirmed or was not sent: the same words whatever the reason (mirrors the server). */
export const INVITE_NEUTRAL_MESSAGE = 'If that person can be invited, they have been sent an invitation.';

/** What an invite call answers, whether or not anything was sent: the server never says who exists or who takes invitations. */
export interface InviteAnswer {
    message: string;
}

/** Who a username resolved to, shown for confirmation before an invitation is sent (a display name and avatar, never an ID). */
export interface InvitePreview {
    /** null when nothing can be confirmed (nobody by that name, or the person cannot be invited): the server does not say which. */
    name: string | null;
    avatarUrl: string | null;
}

export interface InviteResponse {
    accepted: boolean;
    list?: { id: number; name: string };
    role?: ListRole;
}

export const sharingApi = {
    members: (listId: number) => apiFetch<ListMembers>(`/api/lists/${listId}/members`),
    invite: (listId: number, body: { username: string; role: ListRole }) =>
        post<InviteAnswer>(`/api/lists/${listId}/invites`, body),
    invitePreview: (listId: number, body: { username: string; role: ListRole }) =>
        post<InvitePreview>(`/api/lists/${listId}/invites`, { ...body, dryRun: true }),
    setRole: (listId: number, memberKey: string, role: ListRole) =>
        patch<{ memberKey: string; role: ListRole }>(`/api/lists/${listId}/members/${memberKey}`, { role }),
    removeMember: (listId: number, memberKey: string) => del<{ success: boolean }>(`/api/lists/${listId}/members/${memberKey}`),
    leave: (listId: number) => post<{ success: boolean }>(`/api/lists/${listId}/leave`),
    transfer: (listId: number, memberKey: string) => post<{ success: boolean; listId: number; role: ListRole; memberKey: string }>(`/api/lists/${listId}/transfer`, { memberKey }),
    myInvites: () => apiFetch<MyInvite[]>('/api/invites'),
    accept: (id: number) => post<InviteResponse>(`/api/invites/${id}/accept`),
    decline: (id: number) => post<InviteResponse>(`/api/invites/${id}/decline`),
    revoke: (id: number) => del<{ success: boolean }>(`/api/invites/${id}`),
};

// ─── Parties: a small group with a shared weekly quest ───────────────────────

export interface PartyMember {
    /** Opaque key the owner uses to remove this member. */
    memberKey: string;
    name: string | null;
    /** First completions this member contributed in the current UTC week. */
    count: number;
    isYou: boolean;
    isOwner: boolean;
}

export interface PartyInvite {
    id: number;
    inviteeName: string | null;
    createdAt: string;
    expiresAt: string;
}

export interface PartyStatus {
    party: { id: number; name: string; isOwner: boolean };
    weekStart: string;
    resetsAt: string;
    perMember: number;
    /** Tasks you must finish yourself (since joining, this week) before you may claim the reward. */
    minToClaim: number;
    /** Your own counted completions this week since you joined. */
    yourCount: number;
    target: number;
    progress: number;
    reward: number;
    members: PartyMember[];
    /** Pending invitations (owner only, otherwise absent or empty). */
    invites?: PartyInvite[];
    /** Most people in the party, owner included. */
    limit: number;
    reached: boolean;
    claimed: boolean;
    claimable: boolean;
    /** This week's tasks and focus minutes per member, best first. */
    board?: PartyBoardRow[];
    /** The second weekly party quest: focus minutes together. */
    focusQuest?: PartyFocusQuest;
}

export interface PartyBoardRow {
    rank: number;
    memberKey: string;
    name: string | null;
    count: number;
    focusMinutes: number;
    isYou: boolean;
    isOwner: boolean;
}

export interface PartyFocusQuest {
    target: number;
    progress: number;
    reward: number;
    /** Minutes you must focus yourself (since joining, this week) before you may claim. */
    minToClaim: number;
    perMember: number;
    yourMinutes: number;
    reached: boolean;
    claimed: boolean;
    claimable: boolean;
}

export interface MyPartyInvite {
    id: number;
    partyName: string;
    ownerName: string | null;
    createdAt: string;
    expiresAt: string;
}

export interface PartyOverview {
    party: PartyStatus | null;
    invites: MyPartyInvite[];
}

export interface PartyClaimResult {
    success: boolean;
    weekStart: string;
    xp: number;
    balance: number;
    level: number;
    leveledUp: boolean;
    newAchievements: AchievementUnlock[];
}

export const partyApi = {
    get: () => apiFetch<PartyOverview>('/api/parties'),
    create: (name: string) => post<PartyStatus>('/api/parties', { name }),
    invite: (username: string) => post<InviteAnswer>('/api/parties/invites', { username }),
    invitePreview: (username: string) => post<InvitePreview>('/api/parties/invites', { username, dryRun: true }),
    revoke: (id: number) => del<{ success: boolean }>(`/api/parties/invites/${id}`),
    accept: (id: number) => post<{ accepted: boolean; party?: { id: number; name: string } }>(`/api/parties/invites/${id}/accept`),
    decline: (id: number) => post<{ accepted: boolean }>(`/api/parties/invites/${id}/decline`),
    leave: () => post<{ success: boolean }>('/api/parties/leave'),
    kick: (memberKey: string) => del<{ success: boolean }>(`/api/parties/members/${memberKey}`),
    disband: () => del<{ success: boolean }>('/api/parties'),
    claim: () => post<PartyClaimResult>('/api/parties/claim'),
    claimFocus: () => post<PartyClaimResult>('/api/parties/focus/claim'),
};

export const questsApi = {
    getAll: () => apiFetch<{ quests: Quest[] }>('/api/quests'),
    claim: (key: string) => post<QuestClaimResult>(`/api/quests/${key}/claim`),
};

export const itemsApi = {
    create: (listId: number, data: ItemInput) => post<Item & RewardFields>(`/api/lists/${listId}/items`, data),
    update: (id: number, data: Partial<ItemInput> & { position?: number }) => patch<Item>(`/api/items/${id}`, data),
    toggle: (id: number, completed?: boolean) =>
        patch<Item & RewardFields & { nextItem?: Item | null; removedItemId?: number | null }>(`/api/items/${id}/toggle`, completed === undefined ? undefined : { completed }),
    /** `init.keepalive` lets the request finish while the page is being closed. */
    delete: (id: number, init?: RequestInit) => del<{ success: boolean }>(`/api/items/${id}`, init),
    /** Move a top-level task (with its subtasks) to another quest. */
    move: (id: number, listId: number) => post<{ item: Item; moved: number }>(`/api/items/${id}/move`, { listId }),
    activity: (id: number) => apiFetch<{ activity: ItemActivity[] }>(`/api/items/${id}/activity`),
    comments: (id: number) => apiFetch<{ comments: ItemComment[] }>(`/api/items/${id}/comments`),
    addComment: (id: number, body: string) => post<ItemComment>(`/api/items/${id}/comments`, { body }),
    deleteComment: (commentId: number) => del<{ success: boolean }>(`/api/comments/${commentId}`),
};

// ─── AI (optional feature; see docs/AI_INTEGRATION.md) ───────────────────────

/** Streams an SSE response from a POST endpoint, calling onEvent for each event. */
async function sseFetch(endpoint: string, json: unknown, onEvent: (event: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
    let response: Response;
    try {
        response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            credentials: 'include',
            headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
            body: JSON.stringify(json),
            signal,
        });
    } catch (err) {
        if (isNetworkFailure(err)) throw new ApiError(OFFLINE_MESSAGE, 0, 'NETWORK');
        throw err;
    }
    if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new ApiError(body.error || `Request failed (HTTP ${response.status})`, response.status, body.code, body.details);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
            const event = parseSseFrame(frame);
            if (event) onEvent(event);
        }
    }
    // Flush any bytes the decoder held back (a multi-byte character split across the last chunk).
    buffer += decoder.decode();
    const tail = parseSseFrame(buffer);
    if (tail) onEvent(tail);
}

/** Parse one SSE frame (event + data lines) into a typed event; ignores comments and bad JSON. */
export function parseSseFrame(frame: string): ChatEvent | null {
    let name = 'message';
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event:')) name = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return null;
    try {
        return { event: name, data: JSON.parse(data.join('\n')) } as ChatEvent;
    } catch {
        return null;
    }
}

export const aiApi = {
    ping: () => apiFetch<{ pong: boolean }>('/api/ai/ping'),
    summary: (body: { mode: 'list'; listId: number } | { mode: 'digest' } | { mode: 'recap'; range?: 'day' | 'week' }) =>
        post<AiSummary>('/api/ai/summary', body),
    prioritize: (limit?: number) => post<AiPriorityResult>('/api/ai/prioritize', limit ? { limit } : {}),
    threads: () => apiFetch<{ threads: AiThread[] }>('/api/ai/threads'),
    thread: (id: string) => apiFetch<AiThreadDetail>(`/api/ai/threads/${encodeURIComponent(id)}`),
    deleteThread: (id: string) => del<{ success: boolean }>(`/api/ai/threads/${encodeURIComponent(id)}`),
    chatStream: (body: { threadId?: string; message: string }, onEvent: (e: ChatEvent) => void, signal?: AbortSignal) =>
        sseFetch('/api/ai/chat', body, onEvent, signal),
    resumeStream: (threadId: string, approved: boolean, onEvent: (e: ChatEvent) => void, signal?: AbortSignal) =>
        sseFetch(`/api/ai/chat/${encodeURIComponent(threadId)}/resume`, { approved }, onEvent, signal),
};

// ─── Progression ─────────────────────────────────────────────────────────────

export const classesApi = {
    getAll: () => apiFetch<ClassesData>('/api/classes'),
    buy: (classKey: string) => post<{ success: boolean; user: User; newAchievements?: AchievementUnlock[] }>(`/api/classes/${classKey}/buy`),
    equip: (classKey: string) => post<{ success: boolean; user: User }>(`/api/classes/${classKey}/equip`),
    preview: (classKey: string, mix?: string) => apiFetch<ClassPreview>(`/api/classes/${classKey}/preview${mix ? `?mix=${encodeURIComponent(mix)}` : ''}`),
};

/** "What would I earn?": the average XP of a 10 XP task (a simulation of the real rules). */
export interface ClassPreview {
    classKey: string;
    level: number;
    mix: string;
    base: number;
    noSkills: number;
    yourSkills: number;
    fullTree: number;
}

export interface RespecResult {
    success: boolean;
    treeKey: string;
    removed: string[];
    spent: number;
    refund: number;
    balance: number;
    percent: number;
}

export interface SkillPreview {
    classKey: string;
    level: number;
    mix: string;
    base: number;
    average: number;
    /** skill id -> what its next level adds to the average XP of a 10 XP task for the equipped class. */
    gains: Record<string, number>;
}

export type CosmeticKind = 'title' | 'frame' | 'accent';

export interface EquippedCosmetics {
    title: string | null;
    frame: { id: string; name: string; color: string } | null;
    accent: { id: string; name: string; color: string; colorDark?: string } | null;
}

export interface CosmeticItem {
    id: string;
    kind: CosmeticKind;
    name: string;
    cost: number;
    /** Frames: a CSS background for the ring. Accents: the colour on light surfaces. */
    color?: string;
    /** Accents: the colour on dark surfaces. */
    colorDark?: string;
    owned: boolean;
    equipped: boolean;
    locked: boolean;
    lockedReason: string | null;
    affordable: boolean;
}

export interface CosmeticsData {
    balance: number;
    items: CosmeticItem[];
    equipped: EquippedCosmetics;
    gamificationEnabled: boolean;
}

export const cosmeticsApi = {
    getAll: () => apiFetch<CosmeticsData>('/api/cosmetics'),
    buy: (id: string) => post<{ success: boolean; balance: number; name: string; newAchievements?: AchievementUnlock[] }>(`/api/cosmetics/${id}/buy`),
    equip: (kind: CosmeticKind, id: string | null) => post<{ success: boolean; equipped: EquippedCosmetics }>('/api/cosmetics/equip', { kind, id }),
};

export const pushApi = {
    config: () => apiFetch<{ enabled: boolean; publicKey?: string }>('/api/push/config'),
    subscribe: (subscription: PushSubscriptionJSON) => post<{ success: boolean; subscriptions: number }>('/api/push/subscribe', { subscription }),
    unsubscribe: (endpoint: string) => apiFetch<{ success: boolean; removed: boolean }>('/api/push/subscribe', { method: 'DELETE', json: { endpoint } }),
};

export const skillsApi = {
    getAll: () => apiFetch<SkillsData>('/api/skills'),
    preview: () => apiFetch<SkillPreview>('/api/skills/preview'),
    respec: (classKey: string) => post<RespecResult>('/api/skills/respec', { classKey }),
    unlock: (skillId: string) => post<{ success: boolean; skill: { skill_id: string; skill_level: number }; balance: number }>(`/api/skills/${skillId}/unlock`),
};

export const achievementsApi = {
    getAll: () => apiFetch<AchievementsData>('/api/achievements'),
};

export type LeaderboardBoard = 'lifetime' | 'weekly' | 'streak' | 'xp';

export const leaderboardApi = {
    me: (by: LeaderboardBoard = 'lifetime', playerClass?: string, signal?: AbortSignal) => {
        const params = new URLSearchParams({ by });
        if (playerClass && playerClass !== 'ALL') params.set('class', playerClass);
        return apiFetch<{ rank: number | null }>(`/api/leaderboard/me?${params}`, { signal });
    },
    get: (by: LeaderboardBoard = 'lifetime', playerClass?: string, signal?: AbortSignal) => {
        const params = new URLSearchParams({ by });
        if (playerClass && playerClass !== 'ALL') params.set('class', playerClass);
        return apiFetch<LeaderboardEntry[]>(`/api/leaderboard?${params}`, { signal });
    },
};

// ─── Games (server-authoritative) ────────────────────────────────────────────

export const gamesApi = {
    config: () => apiFetch<GameConfig>('/api/games/config'),
    getHistory: () => apiFetch<GameSession[]>('/api/games/history'),
    getAllowance: () => apiFetch<GameAllowance>('/api/games/allowance'),
    getActive: () => apiFetch<{ blackjack: BlackjackActive | null; hangman: HangmanActive | null }>('/api/games/active'),
    blackjackStart: (bet: number) => post<BlackjackResult>('/api/games/blackjack/start', { bet }),
    blackjackAction: (action: 'hit' | 'stand' | 'double') => post<BlackjackResult>('/api/games/blackjack/action', { action }),
    rps: (choice: RpsChoice) => post<RpsResult>('/api/games/rps', { choice }),
    hangmanStart: () => post<HangmanActive>('/api/games/hangman/start'),
    hangmanGuess: (letter: string) => post<HangmanResult>('/api/games/hangman/guess', { letter }),
    arcadeStart: (type: ArcadeType) => post<{ sessionId: number; seed: number }>(`/api/games/arcade/${type}/start`),
    arcadeFinish: (type: ArcadeType, sessionId: number, run: { score: number; ticks: number; inputs: number[] }) =>
        post<ArcadeResult>(`/api/games/arcade/${type}/finish`, { sessionId, score: run.score, ticks: run.ticks, inputs: run.inputs }),
    quit: (type: 'hangman' | ArcadeType) => post<{ success: boolean }>(`/api/games/${type}/quit`),
};

export const statsApi = {
    xpHistory: (days: HistoryRange = 30, signal?: AbortSignal) => apiFetch<XPHistoryDay[]>(`/api/stats/xp-history?days=${days}`, { signal }),
    summary: () => apiFetch<StatsSummary>('/api/stats/summary'),
};

export const focusApi = {
    get: () => apiFetch<FocusStatus>('/api/focus'),
    start: (minutes: number) => post<FocusStartResult>('/api/focus/start', { minutes }),
    finish: (sessionId: number) => post<FocusFinishResult>('/api/focus/finish', { sessionId }),
};

export const reviewApi = {
    get: () => apiFetch<WeeklyReview>('/api/review'),
    claim: () => post<ReviewClaimResult>('/api/review/claim'),
};

export const todayApi = {
    get: () => apiFetch<TodayData>('/api/today'),
};

export const reflectionApi = {
    get: () => apiFetch<ReflectionStatus>('/api/reflection'),
    write: (note: string) => post<ReflectionResult>('/api/reflection', { note }),
};

export const goalApi = {
    get: () => apiFetch<WeeklyGoal>('/api/goal'),
    set: (target: number) => apiFetch<WeeklyGoal & { success: boolean }>('/api/goal', { method: 'PUT', json: { target } }),
    claim: () => post<GoalClaimResult>('/api/goal/claim'),
};

export const xpApi = {
    getHistory: () => apiFetch<XPTransaction[]>('/api/xp/history'),
};

// ─── Types ───────────────────────────────────────────────────────────────────

export type PlayerClass =
    | 'DEFAULT' | 'HERO' | 'GAMBLER' | 'ASSASSIN' | 'WIZARD' | 'ARCHER' | 'TANK'
    | 'MONK' | 'ARTISAN' | 'RANGER' | 'NECROMANCER' | 'PALADIN' | 'WARDEN' | 'CHRONOMANCER' | 'DRUID' | 'ALCHEMIST' | 'BARD';

export interface User {
    discord_id: string;
    discord_username: string | null;
    discord_avatar: string | null;
    player_xp: number;
    lifetime_xp: number;
    /** Never-reset total XP; lifetime_xp restarts with each prestige and drives the level. */
    lifetime_xp_total?: number;
    /** Times the player has prestiged (0-10) and the title that earns. */
    prestige?: number;
    prestige_title?: string;
    player_level: number;
    player_class: PlayerClass;
    gamification_enabled: boolean | number;
    automation_enabled: boolean | number;
    auto_delete_old_lists: boolean | number;
    ai_enabled?: boolean | number;
    streak_count: number;
    last_daily_claim: string | null;
    owns_hero: boolean | number;
    owns_gambler: boolean | number;
    owns_assassin: boolean | number;
    owns_wizard: boolean | number;
    owns_archer: boolean | number;
    owns_tank: boolean | number;
    owns_monk?: boolean | number;
    owns_artisan?: boolean | number;
    owns_ranger?: boolean | number;
    owns_necromancer?: boolean | number;
    owns_paladin?: boolean | number;
    owns_warden?: boolean | number;
    owns_chronomancer?: boolean | number;
    owns_druid?: boolean | number;
    owns_alchemist?: boolean | number;
    owns_bard?: boolean | number;
    /** Class counters: Monk rhythm (and its last UTC day), Artisan project progress, Necromancer souls. */
    monk_rhythm?: number;
    monk_day?: string | null;
    artisan_progress?: number;
    necro_souls?: number;
    bard_recent?: string;
    alchemist_mix?: number;
    total_items_added: number;
    total_items_completed: number;
    total_lists_created: number;
    streak_freezes?: number;
    xp_spent?: number;
    timezone?: string | null;
    reminder_hour?: number;
    weekly_digest?: boolean | number;
    /** 1 (default): other people may invite you to lists and parties; 0: every invitation is refused silently. */
    accept_invites?: boolean | number;
    has_calendar_token?: boolean;
    /** What the player has equipped from the shop (titles, avatar frames, profile accents). */
    cosmetics?: EquippedCosmetics;
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
    /** Streak freeze price and cap for this player (the Freeze Cache skill changes both). */
    freezeLimits?: FreezeLimits;
}

export interface FreezeLimits {
    COST: number;
    MAX: number;
}

export interface UserData extends UserStats {
    discord: DiscordUser;
    userAchievements: { achievement_key: string; unlocked_at: string }[];
    /** Optional features enabled on this server for this user. */
    features?: { ai: boolean; aiAvailable: boolean };
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
    /** XP the achievement paid when it unlocked (flat, no modifiers). */
    xp?: number;
    name: string;
    description: string;
    emoji: string;
    category: string;
}

/** A flat extra paid with a first task completion (first of the day, cleared list, early finish ...). */
export interface BonusEntry {
    key: string;
    label: string;
    xp: number;
}

export interface RewardFields {
    xpResult: XPResult | null;
    /** Task completions only: the flat extras paid on top of xpResult. */
    bonuses?: BonusEntry[];
    newAchievements: AchievementUnlock[];
}

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface List extends SharingFields {
    id: number;
    /** Absent on a quest somebody else owns. */
    discord_id?: string;
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
    /** Own due date (YYYY-MM-DD), priority, comma-separated lowercase tags, parent task and repeat rule. */
    due_date?: string | null;
    priority?: Priority | null;
    tags?: string | null;
    parent_id?: number | null;
    recurrence?: Recurrence | null;
    /** The player's own estimate in minutes (a focus session of about that length right before finishing pays a bonus). */
    estimate_minutes?: number | null;
    /** Display name of the person who finished it (shared quests only). */
    completed_by_name?: string | null;
    /** false when the server would refuse to delete it for me (an editor may only delete tasks they added). Absent: assume yes. */
    can_delete?: boolean;
    /** Who the task is assigned to (the owner or a member of the quest), or null. */
    assignee?: ItemPerson | null;
    /** How many comments the task has. */
    comment_count?: number;
}

/** A person on a quest as tasks show them: the member key (as in the members list), never a Discord id. */
export interface ItemPerson {
    memberKey: string;
    name: string | null;
    isYou: boolean;
}

export type ItemActivityKind = 'created' | 'renamed' | 'completed' | 'reopened' | 'priority' | 'due' | 'assigned' | 'moved';

/** One entry of a task's history; `from` and `to` are the old and new values where the kind has them. */
export interface ItemActivity {
    id: number;
    kind: ItemActivityKind;
    actor: { name: string | null; isYou: boolean } | null;
    from?: string | null;
    to?: string | null;
    createdAt: string;
}

export interface ItemComment {
    id: number;
    body: string;
    author: { name: string | null; isYou: boolean };
    createdAt: string;
    /** The author and the quest's managers may delete a comment. */
    canDelete: boolean;
}

export type Recurrence = 'daily' | 'weekly' | 'monthly';

export interface ItemInput {
    name: string;
    description?: string | null;
    due_date?: string | null;
    priority?: Priority | null;
    tags?: string[] | string | null;
    recurrence?: Recurrence | null;
    estimate_minutes?: number | null;
    parent_id?: number | null;
    /** A member key from the quest's members list ("owner" for the owner), or null to unassign. */
    assignee?: string | null;
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
    cosmetics?: EquippedCosmetics;
    username: string;
    avatarUrl: string | null;
    xp: number;
    lifetimeXp: number;
    prestige?: number;
    prestigeTitle?: string;
    /** The value this board ranks by (XP, XP earned this week, or streak days). */
    score: number;
    level: number;
    playerClass: PlayerClass;
    streak: number;
    gamesPlayed: number;
    tasksCompleted: number;
    isYou: boolean;
}

/** The server's game rules (GET /api/games/config), so the page never shows numbers the server does not use. */
export interface GameConfig {
    blackjack: { MIN_BET: number; MAX_BET_PERCENT: number; HARD_CAP: number; BLACKJACK_MULTIPLIER: number; WIN_MULTIPLIER: number };
    rewards: { rpsWin: number; hangmanPerLife: number; hangmanMin: number };
    arcade: Record<ArcadeType, { name: string; xpPerPoint: number; maxXP: number; maxPointsPerSecond: number }>;
    limits: { freeGameXPPerDay: number; cooldownMs: number };
}

export interface GameAllowance {
    cap: number;
    remainingXP: number;
    usedXP: number;
    resetsAt: string;
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
    /** The run was valid but shorter than the minimum that pays XP. */
    tooShort?: boolean;
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

export interface DailyChest {
    xp?: number;
    bonusXP?: number;
    amount?: number;
    label?: string;
    name?: string;
    streak?: number;
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
    /** Daily Surprise skill: bonus XP when it triggered. */
    surpriseBonus?: number;
    /** Milestone chest, when this claim hit one. */
    chest?: DailyChest | number | string | null;
    totalXP?: number;
    bonusInfo?: BonusInfo;
    streakBroken?: boolean;
    streakPreserved?: boolean;
    freezeUsed?: boolean;
    newBalance?: number;
    newLevel?: number;
    leveledUp?: boolean;
    newAchievements?: AchievementUnlock[];
}

export interface PrestigeStatus {
    prestige: number;
    title: string;
    nextTitle: string | null;
    bonusPercent: number;
    nextBonusPercent: number | null;
    level: number;
    minLevel: number;
    max: number;
    eligible: boolean;
}

export interface PrestigeResult {
    success: boolean;
    prestige: number;
    title: string;
    bonusPercent: number;
    levelBefore: number;
    balanceLost: number;
    balance: number;
    level: number;
    newAchievements: AchievementUnlock[];
}

export interface Quest {
    key: string;
    name: string;
    emoji: string;
    description: string;
    period: 'daily' | 'weekly' | 'monthly';
    /** True for this week's pick from the rotating weekly pool. */
    rotating?: boolean;
    target: number;
    reward: number;
    progress: number;
    claimed: boolean;
    claimable: boolean;
    periodStart: string;
    resetsAt: string;
}

export interface QuestClaimResult {
    success: boolean;
    key: string;
    name: string;
    reward: number;
    balance: number;
    level: number;
    leveledUp: boolean;
    newAchievements: AchievementUnlock[];
}

export type HistoryRange = 7 | 30 | 90;

export interface XPHistoryDay {
    /** A day in the player's own time zone, YYYY-MM-DD (the last one is their today). */
    date: string;
    xp: number;
    tasksCompleted: number;
}

export interface StatsSummary {
    streak: number;
    tasksCompleted7d: number;
    xpBySource30d: { source: string; label: string; xp: number }[];
    busiestWeekday: { index: number; name: string; count: number } | null;
}

export interface FocusActive {
    sessionId: number;
    startedAt: string;
    minutes: number;
    endsAt: string;
}

export interface FocusStatus {
    active: FocusActive | null;
    today: { sessions: number; xp: number; remainingSessions: number; remainingXP: number };
    config: { minMinutes: number; maxMinutes: number; xpPerMinute: number; xpPerDay: number; sessionsPerDay: number };
}

export type FocusStartResult = FocusActive & { success: boolean };

export interface FocusFinishResult {
    success: boolean;
    sessionId: number;
    state: 'finished' | 'cancelled' | 'expired';
    minutesCredited: number;
    xp: number;
    capped: boolean;
    balance: number;
    level: number;
    leveledUp: boolean;
    newAchievements: AchievementUnlock[];
}

export interface WeeklyReview {
    weekStart: string;
    resetsAt: string;
    completed: number;
    xpEarned: number;
    claimed: boolean;
    claimable: boolean;
    streak: number;
    reward: number;
}

export interface TodayTask {
    id: number;
    name: string;
    listId: number;
    listName: string;
    dueDate: string | null;
    priority: Priority | null;
    estimateMinutes: number | null;
    overdueDays: number;
}

export interface TodayData {
    day: string;
    season: { key: string; name: string; blurb: string; doubles: string; enabled: boolean };
    streak: {
        count: number;
        live: number;
        claimedToday: boolean;
        daysLeft: number | null;
        atRisk: boolean;
        /** When the daily reward can be claimed again (ISO), null before the first claim. */
        claimableAt?: string | null;
        /** When a live streak lapses unless claimed (ISO), null when it never does or is not alive. */
        expiresAt?: string | null;
    };
    counts: { dueToday: number; overdue: number; doneToday: number };
    tasks: TodayTask[];
    /** Open tasks due in the next 7 days that are not in `tasks` (older servers leave it out). */
    upcoming?: TodayTask[];
    reflection: ReflectionStatus;
    goal: WeeklyGoal;
    xpEnabled: boolean;
}

export interface ReflectionStatus {
    day: string;
    reflection: { day: string; note: string; createdAt: string } | null;
    reward: number;
    maxLength: number;
}

export interface ReflectionResult {
    success: boolean;
    day: string;
    note: string;
    xp: number;
    balance: number;
    level: number;
    leveledUp: boolean;
    newAchievements: AchievementUnlock[];
}

export interface WeeklyGoal {
    weekStart: string;
    resetsAt: string;
    target: number | null;
    progress: number;
    claimed: boolean;
    claimable: boolean;
    reward: number | null;
    min: number;
    max: number;
}

export interface GoalClaimResult {
    success: boolean;
    weekStart: string;
    target: number;
    xp: number;
    balance: number;
    level: number;
    leveledUp: boolean;
    newAchievements: AchievementUnlock[];
}

export interface ReviewClaimResult {
    success: boolean;
    weekStart: string;
    xp: number;
    balance: number;
    level: number;
    leveledUp: boolean;
    newAchievements: AchievementUnlock[];
}

// ─── AI types ────────────────────────────────────────────────────────────────

export interface AiSummary {
    mode: 'list' | 'digest' | 'recap';
    headline: string;
    highlights: string[];
    blockers: string[];
    next_steps: string[];
    referenced_ids: string[];
    cached: boolean;
}

export interface AiRankedTask {
    id: string;
    listId: number;
    name: string;
    rank: number;
    score: number;
    reason: string;
    priority: Priority | null;
    deadline: string | null;
    isOverdue: boolean;
    progress: number;
    suggestedPriority: Priority | null;
}

export interface AiPriorityResult {
    ranked: AiRankedTask[];
    focusMessage: string;
    usedFallback: boolean;
    cached: boolean;
}

export interface AiThread {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
}

export interface AiSource {
    id: string;
    title: string;
}

export interface AiConfirmAction {
    id: string;
    action: string;
    args: Record<string, unknown>;
    preview: string;
}

export interface AiToolEvent {
    name: string;
    status: 'done' | 'declined' | 'error';
    xpResult?: XPResult | null;
    newAchievements?: AchievementUnlock[];
}

export interface AiThreadDetail extends AiThread {
    messages: { role: 'user' | 'assistant'; text: string }[];
    pendingConfirm: AiConfirmAction[];
}

export type ChatEvent =
    | { event: 'token'; data: { text: string } }
    | { event: 'sources'; data: AiSource[] }
    | { event: 'tool'; data: AiToolEvent }
    | { event: 'confirm'; data: AiConfirmAction }
    | { event: 'error'; data: { message: string } }
    | { event: 'done'; data: { threadId: string; usage: { input: number; output: number } } };
