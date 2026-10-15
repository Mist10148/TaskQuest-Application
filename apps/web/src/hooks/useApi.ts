/**
 * React Query hooks for the TaskQuest API. There is no mock-data fallback:
 * failures surface as errors (and a toast for mutations) instead of silently
 * showing fake data.
 */

import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createElement } from 'react';
import { toast } from 'sonner';
import { formatDeadline } from '@/lib/dates';
import { applyItemOrder } from '@/lib/reorder';
import { isAccessLost, type ListRole } from '@/lib/sharing';
import { celebrate } from '@/lib/celebrate';
import { describeChest } from '@/lib/classInfo';
import { achievementDescription } from '@/lib/bonuses';
import { RewardBreakdown } from '@/components/feedback/RewardBreakdown';
import {
    userApi,
    importApi,
    templatesApi,
    listsApi,
    sharingApi,
    itemsApi,
    classesApi,
    cosmeticsApi,
    pushApi,
    skillsApi,
    achievementsApi,
    leaderboardApi,
    gamesApi,
    questsApi,
    statsApi,
    focusApi,
    reviewApi,
    todayApi,
    reflectionApi,
    goalApi,
    partyApi,
    aiApi,
    type AchievementUnlock,
    type CosmeticKind,
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

export function showXPNotification(result: Partial<RewardFields> | null | undefined, action: string, emoji = '✨', undo?: () => void) {
    const xp = result?.xpResult;
    // An undo button keeps the toast up a little longer; it only un-checks the task (XP is paid once per task).
    const extra = undo ? { action: { label: 'Undo', onClick: undo }, duration: 6000 } : { duration: 3500 };
    if (!xp || xp.finalXP <= 0) {
        if (undo) toast(`✓ ${action}`, extra);
        return;
    }
    if (xp.leveledUp) celebrate('level');
    toast.success(`${emoji} ${action} +${xp.finalXP} XP!`, {
        description: createElement(RewardBreakdown, { leveledUp: xp.leveledUp, newLevel: xp.newLevel, details: xp.bonusInfo?.details, bonuses: result?.bonuses }),
        ...extra,
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
    qc.invalidateQueries({ queryKey: ['cosmetics'] });
    qc.invalidateQueries({ queryKey: ['skills'] });
    qc.invalidateQueries({ queryKey: ['leaderboard'] });
    qc.invalidateQueries({ queryKey: ['quests'] });
    qc.invalidateQueries({ queryKey: ['review'] });
    qc.invalidateQueries({ queryKey: ['focus'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
    qc.invalidateQueries({ queryKey: ['prestige'] });
    qc.invalidateQueries({ queryKey: ['today'] });
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
        mutationFn: (settings: Partial<Pick<User, 'gamification_enabled' | 'automation_enabled' | 'auto_delete_old_lists' | 'ai_enabled' | 'weekly_digest' | 'accept_invites' | 'timezone' | 'reminder_hour'>>) =>
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
    // A 403/404 will not fix itself on retry: it means the quest is gone or I was removed from it.
    return useQuery({ queryKey: ['lists', listId], queryFn: () => listsApi.getById(listId), enabled: listId > 0, retry: (count, error) => !isAccessLost(error) && count < 1 });
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

// ─── Shared lists ────────────────────────────────────────────────────────────

export function useListMembers(listId: number, enabled = true) {
    return useQuery({ queryKey: ['list-members', listId], queryFn: () => sharingApi.members(listId), enabled: enabled && listId > 0, retry: false });
}

export function useMyInvites() {
    return useQuery({ queryKey: ['invites'], queryFn: sharingApi.myInvites, retry: false });
}

/** Everything that shows who is on a quest or what I may do on it. */
function refreshSharing(qc: QueryClient, listId?: number) {
    qc.invalidateQueries({ queryKey: ['lists'] });
    qc.invalidateQueries({ queryKey: ['invites'] });
    if (listId) qc.invalidateQueries({ queryKey: ['list-members', listId] });
}

export function useInviteMember(listId: number) {
    const qc = useQueryClient();
    // No error toast: the dialog shows the server's message beside the form.
    return useMutation({
        mutationFn: (body: { username: string; role: ListRole }) => sharingApi.invite(listId, body),
        onSuccess: () => refreshSharing(qc, listId),
    });
}

/** Ask who a username is before inviting them (no toast: the dialog shows the server's message). */
export function useInvitePreview(listId: number) {
    return useMutation({ mutationFn: (body: { username: string; role: ListRole }) => sharingApi.invitePreview(listId, body) });
}

export function useSetMemberRole(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ memberKey, role }: { memberKey: string; role: ListRole }) => sharingApi.setRole(listId, memberKey, role),
        onSuccess: () => refreshSharing(qc, listId),
        onError: (error) => { showError(error); refreshSharing(qc, listId); },
    });
}

export function useRemoveMember(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (memberKey: string) => sharingApi.removeMember(listId, memberKey),
        onSuccess: () => refreshSharing(qc, listId),
        onError: (error) => { showError(error); refreshSharing(qc, listId); },
    });
}

export function useTransferList(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (memberKey: string) => sharingApi.transfer(listId, memberKey),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['lists'] });
            refreshSharing(qc, listId);
        },
        onError: (error) => { showError(error); refreshSharing(qc, listId); },
    });
}

export function useLeaveList(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => sharingApi.leave(listId),
        onSuccess: () => {
            qc.removeQueries({ queryKey: ['lists', listId] });
            qc.removeQueries({ queryKey: ['list-members', listId] });
            refreshSharing(qc);
        },
        onError: showError,
    });
}

export function useRevokeInvite(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (inviteId: number) => sharingApi.revoke(inviteId),
        onSuccess: () => refreshSharing(qc, listId),
        onError: (error) => { showError(error); refreshSharing(qc, listId); },
    });
}

export function useRespondToInvite() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, accept }: { id: number; accept: boolean }) => (accept ? sharingApi.accept(id) : sharingApi.decline(id)),
        onSuccess: () => refreshSharing(qc),
        // An expired or withdrawn invitation answers 404: show why and drop it from the banner.
        onError: (error) => { showError(error); refreshSharing(qc); },
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
            if (result.completed) {
                // Undo un-checks the task again; the XP stays paid, and finishing it again later pays nothing.
                const undo = () => itemsApi.toggle(result.id, false).then(() => qc.invalidateQueries({ queryKey: ['lists'] })).catch(showError);
                showXPNotification(result, 'Task done!', '✨', undo);
            }
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

export function usePushConfig() {
    return useQuery({ queryKey: ['push-config'], queryFn: pushApi.config, staleTime: 1000 * 60 * 10 });
}

export function useCosmetics() {
    return useQuery({ queryKey: ['cosmetics'], queryFn: cosmeticsApi.getAll });
}

export function useBuyCosmetic() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => cosmeticsApi.buy(id),
        onSuccess: (result) => {
            invalidateProgress(qc);
            showAchievementNotifications(result.newAchievements, qc);
        },
        onError: showError,
    });
}

export function useEquipCosmetic() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ kind, id }: { kind: CosmeticKind; id: string | null }) => cosmeticsApi.equip(kind, id),
        onSuccess: () => invalidateProgress(qc),
        onError: showError,
    });
}

export function useSkills() {
    return useQuery({ queryKey: ['skills'], queryFn: skillsApi.getAll });
}

/** What each skill's next level adds for the equipped class (a simulation, so it is cached for a while). */
export function useSkillPreview() {
    return useQuery({ queryKey: ['skills', 'preview'], queryFn: skillsApi.preview, staleTime: 1000 * 60 * 5 });
}

export function useRespecSkills() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (classKey: string) => skillsApi.respec(classKey),
        onSuccess: () => invalidateProgress(qc),
        onError: showError,
    });
}

export function useClassPreview(classKey: string | undefined, mix?: string) {
    return useQuery({ queryKey: ['classes', 'preview', classKey, mix ?? 'default'], queryFn: () => classesApi.preview(classKey as string, mix), enabled: Boolean(classKey), staleTime: 1000 * 60 * 5 });
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

export function useToday() {
    return useQuery({ queryKey: ['today'], queryFn: todayApi.get });
}

export function useWriteReflection() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (note: string) => reflectionApi.write(note),
        onSuccess: (result) => {
            invalidateProgress(qc);
            toast.success(result.xp > 0 ? `📝 Reflection saved +${result.xp} XP` : '📝 Reflection saved');
            showAchievementNotifications(result.newAchievements, qc);
        },
        onError: showError,
    });
}

export function useSetGoal() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (target: number) => goalApi.set(target),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['today'] }),
        onError: showError,
    });
}

export function useClaimGoal() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: goalApi.claim,
        onSuccess: (result) => {
            invalidateProgress(qc);
            celebrate(result.leveledUp ? 'level' : 'quest');
            toast.success(`🎯 Weekly goal reached +${result.xp} XP!`, { description: result.leveledUp ? `🎉 Level up! You are now level ${result.level}.` : undefined });
            showAchievementNotifications(result.newAchievements, qc);
        },
        onError: showError,
    });
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

// ─── Parties ─────────────────────────────────────────────────────────────────

export function useParty() {
    return useQuery({ queryKey: ['parties'], queryFn: partyApi.get, retry: false });
}

export function useCreateParty() {
    const qc = useQueryClient();
    // No error toast: the form shows the server's message beside the field.
    return useMutation({
        mutationFn: (name: string) => partyApi.create(name),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['parties'] }),
    });
}

export function useInviteToParty() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (username: string) => partyApi.invite(username),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['parties'] }),
    });
}

export function useInvitePartyPreview() {
    return useMutation({ mutationFn: (username: string) => partyApi.invitePreview(username) });
}

export function useRevokePartyInvite() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => partyApi.revoke(id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['parties'] }),
        onError: (error) => { showError(error); void qc.invalidateQueries({ queryKey: ['parties'] }); },
    });
}

export function useRespondToPartyInvite() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, accept }: { id: number; accept: boolean }) => (accept ? partyApi.accept(id) : partyApi.decline(id)),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['parties'] }),
        // An expired or withdrawn invitation answers 404: show why and drop it from the list.
        onError: (error) => { showError(error); void qc.invalidateQueries({ queryKey: ['parties'] }); },
    });
}

export function useLeaveParty() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: partyApi.leave,
        onSuccess: () => qc.invalidateQueries({ queryKey: ['parties'] }),
        onError: (error) => { showError(error); void qc.invalidateQueries({ queryKey: ['parties'] }); },
    });
}

export function useKickPartyMember() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (memberKey: string) => partyApi.kick(memberKey),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['parties'] }),
        onError: (error) => { showError(error); void qc.invalidateQueries({ queryKey: ['parties'] }); },
    });
}

export function useDisbandParty() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: partyApi.disband,
        onSuccess: () => qc.invalidateQueries({ queryKey: ['parties'] }),
        onError: (error) => { showError(error); void qc.invalidateQueries({ queryKey: ['parties'] }); },
    });
}

export function useClaimParty() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: partyApi.claim,
        onSuccess: (result) => {
            invalidateProgress(qc);
            void qc.invalidateQueries({ queryKey: ['parties'] });
            celebrate(result.leveledUp ? 'level' : 'quest');
            toast.success(`🛡️ Party quest claimed +${result.xp} XP!`, {
                description: result.leveledUp ? `🎉 Level up! You are now level ${result.level}.` : undefined,
            });
            showAchievementNotifications(result.newAchievements, qc);
        },
        onError: (error) => { showError(error); void qc.invalidateQueries({ queryKey: ['parties'] }); },
    });
}

export function useClaimPartyFocus() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: partyApi.claimFocus,
        onSuccess: (result) => {
            invalidateProgress(qc);
            void qc.invalidateQueries({ queryKey: ['parties'] });
            celebrate(result.leveledUp ? 'level' : 'quest');
            toast.success(`⏱️ Party focus quest claimed +${result.xp} XP!`, {
                description: result.leveledUp ? `🎉 Level up! You are now level ${result.level}.` : undefined,
            });
            showAchievementNotifications(result.newAchievements, qc);
        },
        onError: (error) => { showError(error); void qc.invalidateQueries({ queryKey: ['parties'] }); },
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
