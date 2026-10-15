/**
 * A deterministic simulation of the XP a class earns per action (used by scripts/balance-sim.js, the balance tests and the
 * "what would I earn?" preview in the web app). Per-task numbers: a task with `base` XP finished `perDay` times a day on a
 * 7-day streak, averaged after a warm-up, so counters sit at their caps. Random classes are averages (a fixed seed).
 */

'use strict';

const { calculateFinalXP } = require('./xp');

/** The situations a class can be simulated in. */
const MIXES = ['plain', 'high', 'early', 'overdue', 'list', 'variety', 'rotate', 'habit', 'focus', 'shared'];

/** The mix each class is built for (the others are simulated on plain tasks). */
const FAVOURABLE = { WARDEN: 'shared', CHRONOMANCER: 'focus', DRUID: 'habit', ALCHEMIST: 'rotate', BARD: 'variety', HERO: 'high', ARCHER: 'high', PALADIN: 'high', RANGER: 'early', NECROMANCER: 'overdue', ARTISAN: 'list' };

function rngFor(seed) {
    let a = seed | 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Average XP of one rewarded action for a class with the given skills.
 * @param {string} cls class key
 * @param {Array<{skill_id: string, skill_level: number}>} skills
 * @param {object} o { level, action, base, mix, perDay, days }
 */
function simulateAverage(cls, skills, o = {}) {
    const { level = 6, action = 'item_complete', base = 10, mix = 'plain', perDay = 5, days = 60 } = o;
    const rng = rngFor(7);
    const user = { player_class: cls, player_level: level, timezone: 'UTC', streak_count: 7, last_daily_claim: null, total_items_completed: 0 };
    const start = Date.parse('2026-01-01T09:00:00Z');
    let sum = 0;
    let n = 0;
    for (let d = 0; d < days; d++) {
        for (let i = 0; i < perDay; i++) {
            const now = start + d * 864e5 + i * 36e5;
            const step = d * perDay + i;
            const priority = mix === 'high' && i % 2 === 0 ? 'HIGH' : mix === 'rotate' ? ['LOW', 'MEDIUM', 'HIGH'][step % 3] : 'MEDIUM';
            const context = { action, priority, recurring: mix === 'habit', listId: mix === 'variety' ? (step % 5) + 1 : 1, firstOfDay: i === 0 };
            if (mix === 'habit') Object.assign(context, { habitStreak: 8, recurrence: 'daily' });
            if (mix === 'focus') context.afterFocus = { minutes: 10, completions: i };
            if (mix === 'shared') context.sharedMembers = 3;
            if (mix === 'early') {
                context.dueDate = new Date(now + 3 * 864e5).toISOString().slice(0, 10);
                context.today = new Date(now).toISOString().slice(0, 10);
            }
            if (mix === 'overdue' && i % 3 === 0) context.overdueDays = 3;
            if (mix === 'list' && i === perDay - 1) context.listCleared = true;
            const r = calculateFinalXP(user, skills, base, { context, rng, now });
            Object.assign(user, r.userUpdates);
            if (action === 'item_complete') user.total_items_completed = (user.total_items_completed || 0) + 1;
            if (d >= 10) {
                sum += r.finalXP;
                n++;
            }
        }
    }
    return sum / n;
}


module.exports = { MIXES, FAVOURABLE, simulateAverage };
