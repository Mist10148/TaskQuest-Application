/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🪝 REACT QUERY HOOKS - TaskQuest Web v1.6
 *  ALL XP displays show class + skill bonuses
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userApi, listsApi, itemsApi, classesApi, skillsApi, achievementsApi, leaderboardApi, gamesApi } from '@/lib/api';
import { toast } from 'sonner';

// ═══════════════════════════════════════════════════════════════════════════════
//  TOAST NOTIFICATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function showXPNotification(result: any, action: string, emoji: string = '✨') {
  if (!result) return;
  
  // Extract XP data from result - handle multiple response formats
  const xpResult = result.xpResult || result;
  const finalXP = xpResult?.finalXP || result?.finalXP || 0;
  const details = xpResult?.bonusInfo?.details || result?.bonusInfo?.details || '';
  
  if (finalXP <= 0) return;
  
  toast.success(`${emoji} ${action} +${finalXP} XP!`, {
    description: details || undefined,
    duration: 3500,
  });
}

function showGameXPNotification(xpChange: number, bonusInfo: any, gameType: string, result: string) {
  const details = bonusInfo?.details || '';
  
  if (gameType === 'rps') {
    if (result === 'won') {
      toast.success(`🎮 Won +${xpChange} XP!`, { description: details || undefined, duration: 3500 });
    } else if (result === 'lost') {
      toast.info('Better luck next time! (Risk-free)');
    } else {
      toast.info('Tie - try again!');
    }
  } else if (gameType === 'hangman') {
    if (result === 'won') {
      toast.success(`📝 Won +${xpChange} XP!`, { description: details || undefined, duration: 3500 });
    } else {
      toast.error(`Lost XP`);
    }
  } else if (gameType === 'snake') {
    if (xpChange > 0) {
      toast.success(`🐍 Snake +${xpChange} XP!`, { description: details || undefined, duration: 3500 });
    } else {
      toast.info('🐍 Snake - Game Over! Try again.');
    }
  } else if (gameType === 'dino') {
    if (xpChange > 0) {
      toast.success(`🦖 Dino Run +${xpChange} XP!`, { description: details || undefined, duration: 3500 });
    } else {
      toast.info('🦖 Dino - Game Over! Try again.');
    }
  } else if (gameType === 'invaders') {
    if (xpChange > 0) {
      toast.success(`👾 Invaders +${xpChange} XP!`, { description: details || undefined, duration: 3500 });
    } else {
      toast.info('👾 Invaders - Game Over! Try again.');
    }
  } else {
    // Blackjack and others
    if (['won', 'blackjack', 'win'].includes(result)) {
      toast.success(`🃏 Won +${xpChange} XP!`, { description: details || undefined, duration: 3500 });
    } else if (result === 'lost') {
      toast.error(`Lost XP`);
    } else if (result === 'push') {
      toast.info('Push - bet returned');
    }
  }
}

function showAchievementNotifications(newAchievements: any[], queryClient: any) {
  if (newAchievements && newAchievements.length > 0) {
    newAchievements.forEach((ach: any) => {
      toast.success(`🏆 Achievement Unlocked: ${ach.name}!`, {
        description: ach.description,
        duration: 5000,
      });
    });
    queryClient.invalidateQueries({ queryKey: ['achievements'] });
    queryClient.invalidateQueries({ queryKey: ['user'] });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MOCK DATA
// ═══════════════════════════════════════════════════════════════════════════════

const MOCK_LISTS = [
  { id: 1, name: 'Weekly Goals', description: 'Important tasks for this week', category: 'Personal', priority: 'HIGH', deadline: null, itemsTotal: 5, itemsCompleted: 3, created_at: new Date().toISOString() },
  { id: 2, name: 'Work Projects', description: 'Current work assignments', category: 'Work', priority: 'MEDIUM', deadline: new Date(Date.now() + 7*24*60*60*1000).toISOString(), itemsTotal: 8, itemsCompleted: 5, created_at: new Date().toISOString() },
];

const MOCK_ITEMS: Record<number, any[]> = {
  1: [
    { id: 1, name: 'Complete project proposal', description: 'Draft and submit the Q1 proposal', completed: true, position: 1 },
    { id: 2, name: 'Review team updates', description: '', completed: true, position: 2 },
    { id: 3, name: 'Schedule meetings', description: 'Set up weekly sync calls', completed: true, position: 3 },
    { id: 4, name: 'Update documentation', description: '', completed: false, position: 4 },
    { id: 5, name: 'Send weekly report', description: 'Include metrics from this week', completed: false, position: 5 },
  ],
  2: [
    { id: 6, name: 'API integration', description: 'Connect to external services', completed: true, position: 1 },
    { id: 7, name: 'Unit tests', description: '', completed: true, position: 2 },
  ],
};

const MOCK_CLASSES = {
  classes: [
    { key: 'DEFAULT', name: 'Default', emoji: '⚪', description: 'No XP bonus. Balanced starter class.', playstyle: 'Standard XP gains with no modifiers', cost: 0, owned: true, equipped: true },
    { key: 'HERO', name: 'Hero', emoji: '⚔️', description: '+25 XP on every action. Reliable and simple.', playstyle: 'Consistent bonus XP on everything', cost: 500, owned: false, equipped: false },
    { key: 'GAMBLER', name: 'Gambler', emoji: '🎲', description: 'RNG-based XP. High-risk, high-reward.', playstyle: 'Variable 0.5x-2x XP on tasks. High risk, high reward!', cost: 300, owned: false, equipped: false },
    { key: 'ASSASSIN', name: 'Assassin', emoji: '🗡️', description: 'XP streak mechanic. +5% per stack (max 10).', playstyle: 'Streak bonuses stack multiplicatively.', cost: 400, owned: false, equipped: false },
    { key: 'WIZARD', name: 'Wizard', emoji: '🔮', description: 'Spell combos + Wisdom scaling (+5 XP/level).', playstyle: 'Every 3rd task grants 2x XP.', cost: 700, owned: false, equipped: false },
    { key: 'ARCHER', name: 'Archer', emoji: '🏹', description: 'Precision shot system with crits.', playstyle: 'Bonus XP for high priority and on-time tasks.', cost: 600, owned: false, equipped: false },
    { key: 'TANK', name: 'Tank', emoji: '🛡️', description: 'Shield momentum stacking. Strong early.', playstyle: 'Build stacks for massive XP bursts.', cost: 500, owned: false, equipped: false },
  ],
  playerXP: 1250,
};

const MOCK_SKILLS = {
  skillTrees: [
    { classKey: 'DEFAULT', name: 'Default', emoji: '⚪', description: 'Basic skills available to all classes', classOwned: true, skills: [
      { id: 'default_xp_boost', name: 'Quick Learner', emoji: '📚', description: '+5% XP from all sources', maxLevel: 3, currentLevel: 0, cost: 50, requires: null },
      { id: 'default_daily_boost', name: 'Early Bird', emoji: '🌅', description: '+10 bonus daily XP', maxLevel: 2, currentLevel: 0, cost: 75, requires: 'default_xp_boost' },
      { id: 'default_streak_shield', name: 'Streak Shield', emoji: '🛡️', description: 'Protect streak on miss', maxLevel: 1, currentLevel: 0, cost: 100, requires: 'default_daily_boost' },
    ]},
    { classKey: 'HERO', name: 'Hero', emoji: '⚔️', description: 'Reliable XP gains', classOwned: false, skills: [
      { id: 'hero_valor', name: 'Valor', emoji: '⚔️', description: '+10 flat XP per action', maxLevel: 3, currentLevel: 0, cost: 100, requires: null },
      { id: 'hero_inspire', name: 'Inspire', emoji: '✨', description: 'Bonus XP when helping others', maxLevel: 2, currentLevel: 0, cost: 150, requires: 'hero_valor' },
      { id: 'hero_champion', name: 'Champion', emoji: '👑', description: 'Double XP on level milestones', maxLevel: 1, currentLevel: 0, cost: 200, requires: 'hero_inspire' },
      { id: 'hero_legend', name: 'Legendary', emoji: '🏆', description: 'Permanent XP multiplier', maxLevel: 1, currentLevel: 0, cost: 300, requires: 'hero_champion' },
    ]},
  ],
  userXP: 1250,
};

const MOCK_ACHIEVEMENTS = {
  achievements: [
    { key: 'FIRST_LIST', name: 'Getting Started', emoji: '📋', description: 'Create your first list', category: 'lists', unlocked: false },
    { key: 'XP_100', name: 'Novice', emoji: '🌱', description: 'Earn 100 XP', category: 'xp', unlocked: true },
    { key: 'XP_500', name: 'Apprentice', emoji: '📖', description: 'Earn 500 XP', category: 'xp', unlocked: true },
  ],
  unlockedCount: 2,
  totalCount: 28,
};

const MOCK_LEADERBOARD = {
  leaderboard: [
    { discord_id: '1', username: 'Player1', player_xp: 5000, player_level: 12, avatar: null },
    { discord_id: '2', username: 'Player2', player_xp: 3500, player_level: 10, avatar: null },
  ],
  userRank: 1,
};

const MOCK_GAME_HISTORY: any[] = [];

export const HANGMAN_WORDS = [
  'JAVASCRIPT', 'TYPESCRIPT', 'REACT', 'NODEJS', 'EXPRESS', 'MONGODB', 'PYTHON',
  'DISCORD', 'DATABASE', 'FUNCTION', 'VARIABLE', 'COMPONENT', 'INTERFACE'
];

export const BLACKJACK_CONFIG = {
  MIN_BET: 10,
  MAX_BET_PERCENT: 0.25,
  HARD_CAP: 1000,
  BLACKJACK_MULTIPLIER: 1.5,
  WIN_MULTIPLIER: 1.0
};

// ═══════════════════════════════════════════════════════════════════════════════
//  USER HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

export function useUser() {
  return useQuery({
    queryKey: ['user'],
    queryFn: async () => {
      try { return await userApi.getProfile(); }
      catch { return { discord_id: 'mock', username: 'Demo User', avatar: null, player_xp: 1250, player_level: 5, player_class: 'DEFAULT', gamification_enabled: true, daily_streak: 3, lists_created: 2, items_created: 7, items_completed: 5 }; }
    },
  });
}

export function useClaimDaily() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        return await userApi.claimDaily();
      } catch {
        return {
          success: true,
          baseXP: 100,
          classBonus: 0,
          streakBonus: 0,
          skillDailyBonus: 0,
          totalXP: 100,
          streak: 4,
          bonusInfo: { type: null, details: '' }
        };
      }
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['user'] });
      // Toast handled in Dashboard.tsx with full breakdown
    },
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: any) => { try { return await userApi.updateSettings(settings); } catch { return settings; } },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user'] }),
  });
}

export function useResetProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => { 
      try { return await userApi.resetProgress(); } 
      catch { return { success: false, message: 'Failed to reset' }; } 
    },
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LIST HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

export function useLists() {
  return useQuery({ queryKey: ['lists'], queryFn: async () => { try { return await listsApi.getAll(); } catch { return MOCK_LISTS; } } });
}

export function useList(listId: number) {
  return useQuery({
    queryKey: ['lists', listId],
    queryFn: async () => { 
      try { return await listsApi.getById(listId); } 
      catch { 
        const l = MOCK_LISTS.find(x => x.id === listId); 
        const items = (MOCK_ITEMS[listId] || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
        return l ? { ...l, items } : null; 
      } 
    },
    enabled: listId > 0,
  });
}

export function useCreateList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => { try { return await listsApi.create(data); } catch { const nl = { id: Date.now(), ...data, itemsTotal: 0, itemsCompleted: 0, created_at: new Date().toISOString() }; MOCK_LISTS.push(nl); return nl; } },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['lists'] });
      qc.invalidateQueries({ queryKey: ['user'] });
      showXPNotification(result, 'Quest created!', '🎉');
      if (result?.newAchievements) showAchievementNotifications(result.newAchievements, qc);
    },
  });
}

export function useUpdateList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ listId, data }: { listId: number; data: any }) => { try { return await listsApi.update(listId, data); } catch { const l = MOCK_LISTS.find(x => x.id === listId); if (l) Object.assign(l, data); return l; } },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lists'] }),
  });
}

export function useDeleteList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (listId: number) => { try { return await listsApi.delete(listId); } catch { const i = MOCK_LISTS.findIndex(x => x.id === listId); if (i > -1) MOCK_LISTS.splice(i, 1); } },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lists'] }),
  });
}

export function useCreateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ listId, name, description }: { listId: number; name: string; description?: string }) => {
      try { return await itemsApi.create(listId, { name, description }); }
      catch { const items = MOCK_ITEMS[listId] || []; const ni = { id: Date.now(), name, description, completed: false, position: items.length + 1 }; if (!MOCK_ITEMS[listId]) MOCK_ITEMS[listId] = []; MOCK_ITEMS[listId].push(ni); return ni; }
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['lists'] });
      qc.invalidateQueries({ queryKey: ['user'] });
      showXPNotification(result, 'Task added!', '✅');
      if (result?.newAchievements) showAchievementNotifications(result.newAchievements, qc);
    },
  });
}

export function useUpdateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, data }: { itemId: number; data: any }) => { 
      try { return await itemsApi.update(itemId, data); } 
      catch { 
        for (const lid of Object.keys(MOCK_ITEMS)) {
          const listId = Number(lid);
          const items = MOCK_ITEMS[listId];
          if (!items) continue;
          const itemIndex = items.findIndex(x => x.id === itemId);
          if (itemIndex > -1) {
            const item = items[itemIndex];
            if (data.position !== undefined && data.position !== item.position) {
              items.splice(itemIndex, 1);
              const newIndex = Math.max(0, Math.min(items.length, data.position - 1));
              items.splice(newIndex, 0, { ...item, ...data });
              items.forEach((it, idx) => it.position = idx + 1);
            } else {
              Object.assign(item, data);
            }
            break;
          }
        }
        return { id: itemId, ...data }; 
      } 
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lists'] }),
  });
}

export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: number) => { try { return await itemsApi.delete(itemId); } catch { for (const lid in MOCK_ITEMS) { const i = MOCK_ITEMS[lid].findIndex(x => x.id === itemId); if (i > -1) MOCK_ITEMS[lid].splice(i, 1); } } },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lists'] }),
  });
}

export function useToggleItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: number) => { try { return await itemsApi.toggle(itemId); } catch { for (const lid in MOCK_ITEMS) { const item = MOCK_ITEMS[lid].find(x => x.id === itemId); if (item) item.completed = !item.completed; } return { id: itemId, completed: true }; } },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['lists'] });
      qc.invalidateQueries({ queryKey: ['user'] });
      if (result?.completed) showXPNotification(result, 'Task done!', '✨');
      if (result?.newAchievements) showAchievementNotifications(result.newAchievements, qc);
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CLASS & SKILL HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

export function useClasses() {
  return useQuery({ queryKey: ['classes'], queryFn: async () => { try { return await classesApi.getAll(); } catch { return MOCK_CLASSES; } } });
}

export function useBuyClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (classKey: string) => { try { return await classesApi.buy(classKey); } catch { const c = MOCK_CLASSES.classes.find(x => x.key === classKey); if (c) c.owned = true; return { success: true }; } },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['classes'] });
      qc.invalidateQueries({ queryKey: ['skills'] });
      if (result?.newAchievements) showAchievementNotifications(result.newAchievements, qc);
    },
  });
}

export function useEquipClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (classKey: string) => { try { return await classesApi.equip(classKey); } catch { MOCK_CLASSES.classes.forEach(c => c.equipped = c.key === classKey); return { success: true }; } },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['classes'] });
      qc.invalidateQueries({ queryKey: ['user'] });
    },
  });
}

export function useSkills() {
  return useQuery({ queryKey: ['skills'], queryFn: async () => { try { return await skillsApi.getAll(); } catch { return MOCK_SKILLS; } } });
}

export function useUnlockSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ skillId, classKey }: { skillId: string; classKey: string }) => {
      try { return await skillsApi.unlock(skillId, classKey); }
      catch { return { success: true }; }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skills'] });
      qc.invalidateQueries({ queryKey: ['user'] });
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  OTHER HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

export function useAchievements() {
  return useQuery({ queryKey: ['achievements'], queryFn: async () => { try { return await achievementsApi.getAll(); } catch { return MOCK_ACHIEVEMENTS; } } });
}

export function useLeaderboard() {
  return useQuery({ queryKey: ['leaderboard'], queryFn: async () => { try { return await leaderboardApi.get(); } catch { return MOCK_LEADERBOARD; } } });
}

export function useGameHistory() {
  return useQuery({ queryKey: ['games', 'history'], queryFn: async () => { try { return await gamesApi.getHistory(); } catch { return MOCK_GAME_HISTORY; } } });
}

export function useRecordGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { gameType: string; result: string; bet: number; payout: number }) => {
      try { return await gamesApi.recordResult(data); }
      catch { MOCK_GAME_HISTORY.unshift({ game_type: data.gameType, state: data.result, bet_amount: data.bet, payout: data.payout, ended_at: new Date().toISOString() }); return { success: true, xpChange: data.payout - data.bet }; }
    },
    onSuccess: (result, variables) => {
      qc.invalidateQueries({ queryKey: ['games'] });
      qc.invalidateQueries({ queryKey: ['user'] });
      
      const { gameType, result: gameResult, bet, payout } = variables;
      const xpChange = result?.xpChange ?? (payout - bet);
      const bonusInfo = result?.bonusInfo;
      
      showGameXPNotification(xpChange, bonusInfo, gameType, gameResult);
      
      if (result?.newAchievements) showAchievementNotifications(result.newAchievements, qc);
    },
  });
}