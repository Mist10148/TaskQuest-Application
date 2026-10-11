/**
 * React Query hooks for the TaskQuest API. There is no mock-data fallback:
 * failures surface as errors (and a toast for mutations) instead of silently
 * showing fake data.
 */

import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatDeadline } from '@/lib/dates';
import { applyItemOrder } from '@/lib/reorder';
import { celebrate } from '@/lib/celebrate';
import { describeChest } from '@/lib/classInfo';
import { achievementDescription, rewardDescription } from '@/lib/bonuses';
import {
    userApi,
    importApi,
    templatesApi,
    listsApi,
    itemsApi,
    classesApi,
    skillsApi,
    achievementsApi,
    leaderboardApi,
    gamesApi,
    questsApi,
    statsApi,
    focusApi,
    reviewApi,
    aiApi,
    type AchievementUnlock,
    type CreateListData,
    type HistoryRange,
    type ItemInput,
    type LeaderboardBoard,
    type ListWithItems,
    type RewardFields,
    type User,
    type UserData,
} from '@/lib/api';

// ─── Notifications ───────────────────────────────────────────────────────────

export function showXPNotification(result: Partial<RewardFields> | null | undefined, action: string, emoji = '✨') {
    const xp = result?.xpResult;
    if (!xp || xp.finalXP <= 0) return;
    if (xp.leveledUp) celebrate('level');
    toast.success(`${emoji} ${action} +${xp.finalXP} XP!`, {
        description: rewardDescription({ leveledUp: xp.leveledUp, newLevel: xp.newLevel, details: xp.bonusInfo?.details, bonuses: result?.bonuses }),
        duration: 3500,
    });
}

export function showAchievementNotifications(achievements: AchievementUnlock[] | undefined, qc: QueryClient) {
    if (!achievements?.length) return;
    celebrate('achievement');
    for (const ach of achievements) {
        toast.success(`🏆 Achievement Unlocked: ${ach.name}!`, { description: achievementDescription(ach), duration: 5000 });
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
    qc.invalidateQueries({ queryKey: ['quests'] });
    qc.invalidateQueries({ queryKey: ['review'] });
    qc.invalidateQueries({ queryKey: ['focus'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
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
            const chest = describeChest(result.chest);
            if (chest) toast.success('🎁 Milestone chest!', { description: chest });
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
        // Optimistic: the switch moves at once (the session query holds the settings) and snaps back on error.
        onMutate: async (settings) => {
            await qc.cancelQueries({ queryKey: ['auth', 'me'] });
            const previous = qc.getQueryData<UserData | null>(['auth', 'me']);
            if (previous) qc.setQueryData<UserData | null>(['auth', 'me'], { ...previous, user: { ...previous.user, ...settings } });
            return { previous };
        },
        onError: (error, _settings, context) => {
            if (context?.previous) qc.setQueryData(['auth', 'me'], context.previous);
            showError(error);
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: ['user'] });
            qc.invalidateQueries({ queryKey: ['auth', 'me'] });
        },
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

export function useCsvImport() {
    const qc = useQueryClient();
    return {
        // The check only reads; problems come back in the result, so nothing toasts here.
        check: useMutation({ mutationFn: (csv: string) => importApi.checkCsv(csv) }),
        run: useMutation({ mutationFn: (csv: string) => importApi.importCsv(csv), onSuccess: () => qc.invalidateQueries() }),
    };
}

export function useBuyStreakFreeze() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: userApi.buyStreakFreeze,
        onSuccess: (result) => {
            invalidateProgress(qc);
            toast.success(`🧊 Streak freeze bought (${result.freezes}/${result.max ?? 3})`, { description: 'It saves your streak automatically if you miss a day.' });
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

/** Task name/description search (needs a query of at least two characters). */
export function useTaskSearch(q: string | null) {
    return useQuery({
        queryKey: ['lists', 'search', q],
        queryFn: () => listsApi.searchTasks(q as string),
        enabled: q !== null,
        placeholderData: (previous) => previous,
    });
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

export function useTemplates() {
    return useQuery({ queryKey: ['templates'], queryFn: templatesApi.getAll });
}

export function useApplyTemplate() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, listName }: { id: number; listName?: string }) => templatesApi.apply(id, listName ? { listName } : {}),
        onSuccess: (result) => {
            qc.invalidateQueries({ queryKey: ['lists'] });
            invalidateProgress(qc);
            showXPNotification(result, `Quest "${result.list.name}" created from a template`, '📋');
            // A capped or XP-free run pays nothing, so say what happened anyway.
            if (!result.xpResult || result.xpResult.finalXP <= 0) {
                toast.success(`📋 Quest "${result.list.name}" created from a template`, { description: 'No XP this time (a daily limit was reached, or XP is off).' });
            }
            showAchievementNotifications(result.newAchievements, qc);
        },
        onError: showError,
    });
}

export function useSaveAsTemplate() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ listId, name }: { listId: number; name?: string }) => templatesApi.saveList(listId, name),
        onSuccess: (template) => {
            qc.invalidateQueries({ queryKey: ['templates'] });
            toast.success(`📋 Saved as template "${template.name}"`);
        },
        onError: showError,
    });
}

export function useDeleteTemplate() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => templatesApi.delete(id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
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
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['lists'] });
            qc.invalidateQueries({ queryKey: ['auth'] });
        },
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
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['lists'] });
            qc.invalidateQueries({ queryKey: ['auth'] });
        },
        onError: showError,
    });
}

export function useReorderItems() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ listId, itemIds }: { listId: number; itemIds: number[] }) => listsApi.reorder(listId, itemIds),
        // Optimistic: the list reorders at once and is rolled back if the server refuses. No success toast per drop.
        onMutate: async ({ listId, itemIds }) => {
            await qc.cancelQueries({ queryKey: ['lists', listId] });
            const previous = qc.getQueryData<ListWithItems>(['lists', listId]);
            if (previous) qc.setQueryData<ListWithItems>(['lists', listId], { ...previous, items: applyItemOrder(previous.items, itemIds) });
            return { previous };
        },
        onError: (error, { listId }, context) => {
            if (context?.previous) qc.setQueryData(['lists', listId], context.previous);
            showError(error);
        },
        onSettled: (_items, _error, { listId }) => qc.invalidateQueries({ queryKey: ['lists', listId] }),
    });
}

export function useToggleItem() {
    const qc = useQueryClient();
    return useMutation({
        // `completed` makes the request idempotent (a double click cannot flip the task back).
        mutationFn: (arg: number | { itemId: number; completed?: boolean }) =>
            typeof arg === 'number' ? itemsApi.toggle(arg) : itemsApi.toggle(arg.itemId, arg.completed),
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

// ─── Stats & weekly review ───────────────────────────────────────────────────

export function useXpHistory(days: HistoryRange) {
    return useQuery({ queryKey: ['stats', 'xp-history', days], queryFn: () => statsApi.xpHistory(days) });
}

export function useStatsSummary() {
    return useQuery({ queryKey: ['stats', 'summary'], queryFn: statsApi.summary });
}

export function useReview() {
    return useQuery({ queryKey: ['review'], queryFn: reviewApi.get });
}

export function useClaimReview() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: reviewApi.claim,
        onSuccess: (result) => {
            invalidateProgress(qc);
            celebrate(result.leveledUp ? 'level' : 'quest');
            toast.success(`📋 Weekly review claimed +${result.xp} XP!`, {
                description: result.leveledUp ? `🎉 Level up! You are now level ${result.level}.` : undefined,
            });
            showAchievementNotifications(result.newAchievements, qc);
        },
        onError: showError,
    });
}

// ─── Prestige ────────────────────────────────────────────────────────────────

export function usePrestigeStatus() {
    return useQuery({ queryKey: ['prestige'], queryFn: userApi.getPrestige });
}

export function useDoPrestige() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: userApi.prestige,
        onSuccess: (result) => {
            // Balance, level, classes, skills and freezes all changed.
            qc.invalidateQueries();
            celebrate('level');
            toast.success(`🌟 Prestige ${result.prestige}: ${result.title}!`, {
                description: `Your XP bonus is now +${result.bonusPercent}% for good. You start again at level ${result.level}.`,
                duration: 6000,
            });
            showAchievementNotifications(result.newAchievements, qc);
        },
        onError: showError,
    });
}

// ─── Focus ───────────────────────────────────────────────────────────────────

export function useFocus() {
    return useQuery({ queryKey: ['focus'], queryFn: focusApi.get, staleTime: 0 });
}

export function useStartFocus() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (minutes: number) => focusApi.start(minutes),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['focus'] }),
        onError: showError,
    });
}

export function useFinishFocus() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (sessionId: number) => focusApi.finish(sessionId),
        onSuccess: (result) => {
            invalidateProgress(qc);
            if (result.state === 'finished' && result.xp > 0) {
                celebrate(result.leveledUp ? 'level' : 'quest');
                toast.success(`⏱️ Focus session done +${result.xp} XP!`, {
                    description: result.leveledUp
                        ? `🎉 Level up! You are now level ${result.level}.`
                        : result.capped
                          ? `Daily focus XP cap reached, so this was trimmed.`
                          : `${result.minutesCredited} minutes of focus.`,
                });
            }
            showAchievementNotifications(result.newAchievements, qc);
        },
        onError: (error) => {
            qc.invalidateQueries({ queryKey: ['focus'] });
            showError(error);
        },
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

/** The signed-in player's own rank on a board (null when they have no score there yet). */
export function useMyRank(by: LeaderboardBoard = 'lifetime', playerClass?: string) {
    return useQuery({ queryKey: ['leaderboard', 'me', by, playerClass ?? 'ALL'], queryFn: () => leaderboardApi.me(by, playerClass) });
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
