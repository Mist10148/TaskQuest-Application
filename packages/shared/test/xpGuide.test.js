/**
 * Docs consistency: every row of the "Every source" table in docs/XP_GUIDE.md must carry the amounts and caps that
 * constants.js pays. Like docs.test.js it compares numbers only, so a row can be reworded freely; a failure names the
 * source and the number it is missing. No database is needed.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../src/constants');

const text = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'XP_GUIDE.md'), 'utf8').replace(/\r\n/g, '\n');

/** The table rows keyed by their first cell's source name(s): "`blackjack_win`, `blackjack_blackjack`" gives both. */
const rows = new Map();
for (const line of text.split('\n')) {
    if (!line.startsWith('| `')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    for (const [, source] of cells[0].matchAll(/`(\w+)`/g)) rows.set(source, cells.slice(1).join(' | '));
}

/** Every number in a cell ("1,000" -> 1000, "0.6" stays). */
const numbers = (str) => (String(str).replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(?:\.\d+)?/g) || []).map(Number);

const { REWARDS: R, LIMITS: L, PARTY_QUEST, PARTY_FOCUS_QUEST, STREAK_CHESTS, ACHIEVEMENTS } = C;

/** What each source's row must mention: its amount(s) and its cap(s). */
const EXPECTED = {
    list_create: [R.LIST_CREATE, L.LIST_CREATE_REWARDS_PER_DAY],
    item_add: [R.ITEM_ADD, L.ITEM_ADD_REWARDS_PER_DAY],
    item_complete: [R.ITEM_COMPLETE, L.ITEM_COMPLETE_REWARDS_PER_DAY],
    daily: [R.DAILY_BASE, R.DAILY_STREAK_STEP, R.DAILY_STREAK_MAX_BONUS],
    first_of_day: [R.FIRST_OF_DAY],
    list_cleared: [R.LIST_CLEARED, L.LIST_CLEARED_PER_DAY],
    early_finish: [R.EARLY_FINISH_PER_DAY, L.DEADLINE_BONUS_XP_PER_DAY],
    overdue_clear: [R.OVERDUE_CLEAR, L.DEADLINE_BONUS_XP_PER_DAY],
    subtasks_done: [R.SUBTASKS_DONE, L.SUBTASKS_DONE_XP_PER_DAY],
    habit_bonus: [R.HABIT_PER_STREAK, R.HABIT_MIN_STREAK, L.HABIT_MAX, L.HABIT_XP_PER_DAY],
    perfect_day: [R.PERFECT_DAY],
    inbox_zero: [R.INBOX_ZERO],
    boss_defeated: [R.BOSS_DEFEATED, L.BOSS_XP_PER_DAY],
    comeback: [R.COMEBACK],
    party_assist: [R.PARTY_ASSIST, L.PARTY_ASSIST_XP_PER_DAY],
    estimate_accuracy: [R.ESTIMATE_ACCURACY, L.ESTIMATE_XP_PER_DAY],
    reflection: [R.REFLECTION],
    weekly_goal: [R.WEEKLY_GOAL_BASE, R.WEEKLY_GOAL_PER_TASK, L.WEEKLY_GOAL_MAX_XP],
    achievement_reward: [R.ACHIEVEMENT, Object.keys(ACHIEVEMENTS).length],
    focus_session: [R.FOCUS_XP_PER_MINUTE, L.FOCUS_MIN_MINUTES, L.FOCUS_MAX_MINUTES, L.FOCUS_XP_PER_DAY, L.FOCUS_SESSIONS_PER_DAY],
    weekly_review: [R.WEEKLY_REVIEW],
    party_quest: [PARTY_QUEST.REWARD, PARTY_QUEST.MIN_OWN_TO_CLAIM, PARTY_FOCUS_QUEST.REWARD, PARTY_FOCUS_QUEST.MIN_OWN_MINUTES],
    game_reward: [R.RPS_WIN, R.HANGMAN_PER_LIFE, L.FREE_GAME_XP_PER_DAY]
};

test('XP_GUIDE: every source in the table pays what the code pays', () => {
    for (const [source, expected] of Object.entries(EXPECTED)) {
        assert.ok(rows.has(source), `XP_GUIDE.md has no row for \`${source}\``);
        const found = numbers(rows.get(source));
        for (const n of expected) assert.ok(found.includes(n), `XP_GUIDE.md \`${source}\` should mention ${n} (row: ${rows.get(source)})`);
    }
});

test('XP_GUIDE: the streak chests match STREAK_CHESTS', () => {
    const found = numbers(rows.get('streak_chest'));
    for (const chest of Object.values(STREAK_CHESTS)) {
        for (const n of numbers(JSON.stringify(chest))) assert.ok(found.includes(n), `streak_chest should mention ${n}`);
    }
});

test('XP_GUIDE: the free-game cooldown matches LIMITS.GAME_COOLDOWN_MS', () => {
    assert.ok(numbers(rows.get('game_reward')).includes(L.GAME_COOLDOWN_MS / 1000));
});
