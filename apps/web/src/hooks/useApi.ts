/**
 * React Query hooks for the TaskQuest API. There is no mock-data fallback:
 * failures surface as errors (and a toast for mutations) instead of silently
 * showing fake data.
 */

import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatDeadline } from '@/lib/dates';
import { celebrate } from '@/lib/celebrate';
import {
    userApi,
    listsApi,
    itemsApi,
    classesApi,
    skillsApi,
    achievementsApi,
    leaderboardApi,
    gamesApi,
    questsApi,
    aiApi,
    type AchievementUnlock,
    type CreateListData,
    type ItemInput,
    type LeaderboardBoard,
    type RewardFields,
    type User,
} from '@/lib/api';

// ─── Notifications ───────────────────────────────────────────────────────────

export function showXPNotification(result: Partial<RewardFields> | null | undefined, action: string, emoji = '✨') {
    const xp = result?.xpResult;
    if (!xp || xp.finalXP <= 0) return;
    if (xp.leveledUp) celebrate('level');
    toast.success(`${emoji} ${action} +${xp.finalXP} XP!`, {
        description: xp.leveledUp ? `🎉 Level up! You are now level ${xp.newLevel}.` : xp.bonusInfo?.details || undefined,
        duration: 3500,
    });
}

export function showAchievementNotifications(achievements: AchievementUnlock[] | undefined, qc: QueryClient) {
    if (!achievements?.length) return;
    celebrate('achievement');
    for (const ach of achievements) {
        toast.success(`🏆 Achievement Unlocked: ${ach.name}!`, { description: ach.description, duration: 5000 });
    }
    qc.invalidateQueries({ queryKey: ['achievements'] });
}

export function showError(error: unknown) {
    toast.error(error instanceof Error ? error.message : 'Something went wrong');
}

/** Refresh everything that depends on the player's XP balance. */
export function invalidateProgress(qc: QueryClient) {
    qc.invalidateQueries({ queryKey: ['user'] });
    qc.invalidateQueries({ queryKey: ['auth'] });
    qc.invalidateQueries({ queryKey: ['classes'] });
    qc.invalidateQueries({ queryKey: ['skills'] });
    qc.invalidateQueries({ queryKey: ['leaderboard'] });
}

// ─── User ────────────────────────────────────────────────────────────────────

export function useUser() {
    return useQuery({ queryKey: ['user'], queryFn: userApi.getProfile });
}

export function useClaimDaily() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: userApi.claimDaily,
        onSuccess: (result) => {
            invalidateProgress(qc);
            if (result.leveledUp) celebrate('level');
            showAchievementNotifications(result.newAchievements, qc);
        },
        onError: showError,
    });
}

export function useUpdateSettings() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (settings: Partial<Pick<User, 'gamification_enabled' | 'automation_enabled' | 'auto_delete_old_lists' | 'ai_enabled' | 'weekly_digest' | 'timezone' | 'reminder_hour'>>) =>
            userApi.updateSettings(settings),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['user'] }),
        onError: showError,
    });
}

export function useResetProgress() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: userApi.resetProgress,
        onSuccess: () => qc.invalidateQueries(),
        onError: showError,
    });
}

/** Create/rotate or turn off the secret calendar feed address. */
export function useCalendarToken() {
    const qc = useQueryClient();
    const refresh = () => qc.invalidateQueries({ queryKey: ['auth'] });
    return {
        create: useMutation({ mutationFn: userApi.createCalendarToken, onSuccess: refresh, onError: showError }),
        revoke: useMutation({ mutationFn: userApi.revokeCalendarToken, onSuccess: refresh, onError: showError }),
    };
}

export function useImportData() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: unknown) => userApi.importData(data),
        onSuccess: () => qc.invalidateQueries(),
        onError: showError,
    });
}

export function useBuyStreakFreeze() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: userApi.buyStreakFreeze,
        onSuccess: (result) => {
            invalidateProgress(qc);
            toast.success(`🧊 Streak freeze bought (${result.freezes}/3)`, { description: 'It saves your streak automatically if you miss a day.' });
            showAchievementNotifications(result.newAchievements, qc);
        },
        onError: showError,
    });
}

// ─── Lists & items ───────────────────────────────────────────────────────────

export function useLists() {
    return useQuery({ queryKey: ['lists'], queryFn: listsApi.getAll });
}

export function useList(listId: number) {
    return useQuery({ queryKey: ['lists', listId], queryFn: () => listsApi.getById(listId), enabled: listId > 0 });
}

export function useCreateList() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: CreateListData) => listsApi.create(data),
        onSuccess: (result) => {
            qc.invalidateQueries({ queryKey: ['lists'] });
            invalidateProgress(qc);
            showXPNotification(result, 'Quest created!', '🎉');
            showAchievementNotifications(result.newAchievements, qc);
        },
        onError: showError,
    });
}

export function useUpdateList() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ listId, data }: { listId: number; data: Partial<CreateListData> }) => listsApi.update(listId, data),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['lists'] }),
        onError: showError,
    });
}

export function useDeleteList() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (listId: number) => listsApi.delete(listId),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['lists'] }),
        onError: showError,
    });
}

export function useCreateItem() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ listId, ...data }: { listId: number } & ItemInput) => itemsApi.create(listId, data),
        onSuccess: (result) => {
            qc.invalidateQueries({ queryKey: ['lists'] });
            invalidateProgress(qc);
            showXPNotification(result, 'Task added!', '✅');
            showAchievementNotifications(result.newAchievements, qc);
        },
        onError: showError,
    });
}

export function useUpdateItem() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ itemId, data }: { itemId: number; data: Partial<ItemInput> & { position?: number } }) =>
            itemsApi.update(itemId, data),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['lists'] }),
        onError: showError,
    });
}

export function useDeleteItem() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (itemId: number) => itemsApi.delete(itemId),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['lists'] }),
        onError: showError,
    });
}

export function useReorderItems() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ listId, itemIds }: { listId: number; itemIds: number[] }) => listsApi.reorder(listId, itemIds),
        onSuccess: (_items, { listId }) => qc.invalidateQueries({ queryKey: ['lists', listId] }),
        onError: showError,
    });
}

export function useToggleItem() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (itemId: number) => itemsApi.toggle(itemId),
        onSuccess: (result) => {
            qc.invalidateQueries({ queryKey: ['lists'] });
            invalidateProgress(qc);
            if (result.completed) showXPNotification(result, 'Task done!', '✨');
            if (result.nextItem) {
                toast('🔁 Next one is ready', { description: result.nextItem.due_date ? `Due ${formatDeadline(result.nextItem.due_date)}` : undefined });
            }
            showAchievementNotifications(result.newAchievements, qc);
        },
        onError: showError,
    });
}

// ─── Classes & skills ────────────────────────────────────────────────────────

export function useClasses() {
    return useQuery({ queryKey: ['classes'], queryFn: classesApi.getAll });
}

export function useBuyClass() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (classKey: string) => classesApi.buy(classKey),
        onSuccess: (result) => {
            invalidateProgress(qc);
            showAchievementNotifications(result.newAchievements, qc);
        },
        onError: showError,
    });
}

export function useEquipClass() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (classKey: string) => classesApi.equip(classKey),
        onSuccess: () => invalidateProgress(qc),
        onError: showError,
    });
}

export function useSkills() {
    return useQuery({ queryKey: ['skills'], queryFn: skillsApi.getAll });
}

export function useUnlockSkill() {
    const qc = useQueryClient();
    return useMutation({
        // classKey is accepted for compatibility; the server derives the tree.
        mutationFn: ({ skillId }: { skillId: string; classKey?: string }) => skillsApi.unlock(skillId),
        onSuccess: () => invalidateProgress(qc),
        onError: showError,
    });
}

// ─── Quests ──────────────────────────────────────────────────────────────────

export function useQuests() {
    return useQuery({ queryKey: ['quests'], queryFn: questsApi.getAll });
}

export function useClaimQuest() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (key: string) => questsApi.claim(key),
        onSuccess: (result) => {
            qc.invalidateQueries({ queryKey: ['quests'] });
            invalidateProgress(qc);
            celebrate(result.leveledUp ? 'level' : 'quest');
            toast.success(`🎁 ${result.name} claimed +${result.reward} XP!`, {
                description: result.leveledUp ? `🎉 Level up! You are now level ${result.level}.` : undefined,
            });
            showAchievementNotifications(result.newAchievements, qc);
        },
        onError: showError,
    });
}

// ─── Other ───────────────────────────────────────────────────────────────────

export function useAchievements() {
    return useQuery({ queryKey: ['achievements'], queryFn: achievementsApi.getAll });
}

export function useLeaderboard(by: LeaderboardBoard = 'lifetime', playerClass?: string) {
    return useQuery({ queryKey: ['leaderboard', by, playerClass ?? 'ALL'], queryFn: () => leaderboardApi.get(by, playerClass) });
}

export function useGameAllowance() {
    return useQuery({ queryKey: ['games', 'allowance'], queryFn: gamesApi.getAllowance });
}

export function useGameHistory() {
    return useQuery({ queryKey: ['games', 'history'], queryFn: gamesApi.getHistory });
}

// ─── AI ──────────────────────────────────────────────────────────────────────

export function useSummary() {
    return useMutation({ mutationFn: aiApi.summary, onError: showError });
}

/**
 * Prioritized quests. Not fetched automatically: every run costs AI quota, so the UI
 * calls `refetch()` on an explicit click. The result stays cached for 5 minutes.
 */
export function usePrioritize(limit = 5) {
    return useQuery({
        queryKey: ['ai', 'prioritize', limit],
        queryFn: () => aiApi.prioritize(limit),
        enabled: false,
        staleTime: 5 * 60_000,
        retry: false,
    });
}

export function useChatThreads(enabled = true) {
    return useQuery({ queryKey: ['ai', 'threads'], queryFn: aiApi.threads, enabled, retry: false });
}

export function useThread(threadId: string | null) {
    return useQuery({
        queryKey: ['ai', 'threads', threadId],
        queryFn: () => aiApi.thread(threadId as string),
        enabled: Boolean(threadId),
        staleTime: 0,
        retry: false,
    });
}

export function useDeleteThread() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: aiApi.deleteThread,
        onSuccess: () => qc.invalidateQueries({ queryKey: ['ai', 'threads'] }),
        onError: showError,
    });
}
