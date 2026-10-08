/**
 * Achievement rules. Pure: given a stats snapshot, return which achievements
 * should be unlocked. Persisting them is done by db/progression.js.
 */

'use strict';

const { ACHIEVEMENTS, PURCHASABLE_CLASS_KEYS, classOwnershipColumn } = require('./constants');

const num = (v) => Number(v) || 0;

/**
 * @param {object} stats  A users row, optionally extended with
 *                        { games_played, games_won } from game_sessions.
 * @param {object} [events] One-off events from the current action:
 *                        { blackjack: boolean, gameWinXP: number }
 * @returns {Array<[string, boolean]>} [key, condition] pairs
 */
function achievementConditions(stats, events = {}) {
    const lists = num(stats.total_lists_created);
    const items = num(stats.total_items_added);
    const done = num(stats.total_items_completed);
    const xp = num(stats.lifetime_xp ?? stats.player_xp);
    const level = num(stats.player_level) || 1;
    const streak = num(stats.streak_count);
    const owned = PURCHASABLE_CLASS_KEYS.map((k) => Boolean(stats[classOwnershipColumn(k)]));

    return [
        ['FIRST_LIST', lists >= 1],
        ['FIVE_LISTS', lists >= 5],
        ['TEN_LISTS', lists >= 10],
        ['FIRST_ITEM', items >= 1],
        ['TEN_ITEMS', items >= 10],
        ['FIFTY_ITEMS', items >= 50],
        ['HUNDRED_ITEMS', items >= 100],
        ['FIRST_COMPLETE', done >= 1],
        ['TEN_COMPLETE', done >= 10],
        ['FIFTY_COMPLETE', done >= 50],
        ['HUNDRED_COMPLETE', done >= 100],
        ['XP_100', xp >= 100],
        ['XP_500', xp >= 500],
        ['XP_1000', xp >= 1000],
        ['XP_5000', xp >= 5000],
        ['XP_10000', xp >= 10000],
        ['LEVEL_5', level >= 5],
        ['LEVEL_10', level >= 10],
        ['LEVEL_25', level >= 25],
        ['LEVEL_50', level >= 50],
        ['STREAK_3', streak >= 3],
        ['STREAK_7', streak >= 7],
        ['STREAK_14', streak >= 14],
        ['STREAK_30', streak >= 30],
        ['FIRST_CLASS', owned.some(Boolean)],
        ['ALL_CLASSES', owned.every(Boolean)],
        ['FIRST_GAME', num(stats.games_played) >= 1],
        ['GAME_WIN_10', num(stats.games_won) >= 10],
        ['BLACKJACK', Boolean(events.blackjack)],
        ['HIGH_ROLLER', num(events.gameWinXP) >= 500]
    ];
}

/**
 * @param {object} stats
 * @param {Iterable<string>} unlockedKeys
 * @param {object} [events]
 * @returns {Array<{ key: string, name: string, emoji: string, description: string, category: string }>}
 */
function evaluateAchievements(stats, unlockedKeys, events = {}) {
    const unlocked = new Set(unlockedKeys);
    return achievementConditions(stats, events)
        .filter(([key, ok]) => ok && !unlocked.has(key))
        .map(([key]) => ({ key, ...ACHIEVEMENTS[key] }));
}

module.exports = { evaluateAchievements, achievementConditions };
