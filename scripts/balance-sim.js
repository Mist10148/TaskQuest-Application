'use strict';

/**
 * Class balance estimates from the shared XP functions (docs/design/balance.md).
 *
 *   node scripts/balance-sim.js          prints the tables
 *
 * Deterministic (fixed seed). Per-task numbers: a task with `base` XP finished `perDay` times a day on a
 * 7-day streak, averaged after a warm-up, so counters sit at their caps. Random classes are averages.
 */

const { calculateFinalXP, CLASSES, SKILL_TREES } = require('../packages/shared/src');

const PURCHASABLE = Object.keys(CLASSES).filter((k) => k !== 'DEFAULT');
const MIXES = ['plain', 'high', 'early', 'overdue', 'list', 'variety', 'rotate', 'habit', 'focus', 'shared'];
/** The mix each class is built for. */
const FAVOURABLE = { ALCHEMIST: 'rotate', BARD: 'variety', HERO: 'high', ARCHER: 'high', PALADIN: 'high', RANGER: 'early', NECROMANCER: 'overdue', ARTISAN: 'list' };

function rngFor(seed) {
    let a = seed | 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Every skill of the class tree at its maximum level, as user_skills rows, and what the levels cost. */
function fullTree(cls) {
    const tree = SKILL_TREES[cls];
    const rows = [];
    let cost = 0;
    for (const [id, s] of Object.entries(tree ? tree.skills : {})) {
        rows.push({ skill_id: id, skill_level: s.maxLevel });
        cost += s.cost * s.maxLevel;
    }
    return { rows, cost };
}

/**
 * Average XP of one rewarded action.
 * @param {string} cls class key
 * @param {object} o { level, tree: 'none'|'full', action, base, mix, perDay, days }
 */
function perAction(cls, o = {}) {
    return perActionRows(cls, o.tree === 'full' ? fullTree(cls).rows : [], o);
}

function perActionRows(cls, skills, o = {}) {
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

/** XP of a whole capped day of one action: adds 50 x 5, completions 50 x 10, list creations 10 x 10. */
const DAY = { item_add: { base: 5, count: 50 }, item_complete: { base: 10, count: 50 }, list_create: { base: 10, count: 10 } };
function perDayTotal(cls, action, o = {}) {
    const { base, count } = DAY[action];
    return Math.round(perAction(cls, { ...o, action, base, perDay: count, mix: 'plain' }) * count);
}

/** Tasks until the class price plus its whole tree is paid back by the gain over a Default player (10 per task). */
function paybackTasks(cls, level = 16) {
    const cost = CLASSES[cls].cost + fullTree(cls).cost;
    const mix = FAVOURABLE[cls] || 'plain';
    const gain = perAction(cls, { level, tree: 'full', mix }) - 10;
    return gain > 0 ? Math.ceil(cost / gain) : Infinity;
}

/** Cheap starter builds used by docs/CLASS_GUIDE.md: [skill id, levels]. */
const STARTER = {
    HERO: [['hero_valor', 3], ['hero_inspire', 2]],
    GAMBLER: [['gambler_lucky', 3], ['gambler_double', 2]],
    ASSASSIN: [['assassin_swift', 3], ['assassin_critical', 2]],
    WIZARD: [['wizard_study', 3], ['wizard_combo', 2]],
    ARCHER: [['archer_aim', 3], ['archer_multishot', 2]],
    TANK: [['tank_fortify', 3], ['tank_absorb', 2]],
    MONK: [['monk_breath', 3]],
    ARTISAN: [['artisan_toolkit', 3]],
    RANGER: [['ranger_scout', 3]],
    NECROMANCER: [['necro_siphon', 3]],
    PALADIN: [['paladin_aura', 3]],
    BARD: [['bard_encore', 3]],
    ALCHEMIST: [['alch_catalyst', 3]]
};

/** XP of one task for an arbitrary skill list (rows of { skill_id, skill_level }). */
function perActionWith(cls, skills, o = {}) {
    const rows = skills.map(([skill_id, skill_level]) => ({ skill_id, skill_level }));
    return perActionRows(cls, rows, o);
}

function skillCost(rows) {
    let cost = 0;
    for (const [id, levels] of rows) {
        for (const tree of Object.values(SKILL_TREES)) if (tree.skills[id]) cost += tree.skills[id].cost * levels;
    }
    return cost;
}

/** The builds table of one class for the docs: none, starter and full tree at levels 5 / 15 / 30. */
function buildTable(cls) {
    const mix = FAVOURABLE[cls] || null;
    const levels = [5, 15, 30];
    const full = fullTree(cls).rows.map((r) => [r.skill_id, r.skill_level]);
    const name = (id) => Object.values(SKILL_TREES).map((t) => t.skills[id]).find(Boolean).name;
    const label = (rows) => rows.map(([id, n]) => (n > 1 ? `${name(id)} ×${n}` : name(id))).join(', ');
    const builds = [['No skills', [], '-'], ['Starter', STARTER[cls], label(STARTER[cls])], ['Full tree', full, label(full)]];
    const cell = (rows, m) => levels.map((l) => Math.round(perActionWith(cls, rows, { level: l, mix: m }))).join(' / ');
    const head = mix
        ? ['| Build | Skills (in order) | Skill cost | Plain task, level 5 / 15 / 30 | Favourable mix, level 5 / 15 / 30 |', '|---|---|---|---|---|']
        : ['| Build | Skills (in order) | Skill cost | Average XP for a plain task, level 5 / 15 / 30 |', '|---|---|---|---|'];
    const lines = builds.map(([b, rows, text]) => `| ${b} | ${text} | ${skillCost(rows)} | ${cell(rows, 'plain')} |` + (mix ? ` ${cell(rows, mix)} |` : ''));
    return [...head, ...lines].join('\n');
}

function report() {
    const rows = [];
    for (const cls of PURCHASABLE) {
        const mix = FAVOURABLE[cls] || 'plain';
        const f = (tree, m, lv) => perAction(cls, { level: lv, tree, mix: m }).toFixed(1);
        rows.push({
            class: cls,
            price: CLASSES[cls].cost,
            tree: fullTree(cls).cost,
            none: [6, 16, 29].map((l) => f('none', 'plain', l)).join(' / '),
            full: [6, 16, 29].map((l) => f('full', 'plain', l)).join(' / '),
            favourable: `${mix}: ` + [6, 16, 29].map((l) => f('full', mix, l)).join(' / '),
            addsPerDay: perDayTotal(cls, 'item_add', { level: 6, tree: 'full' }),
            payback: paybackTasks(cls)
        });
    }
    return rows;
}

module.exports = { PURCHASABLE, FAVOURABLE, MIXES, STARTER, fullTree, perAction, perActionWith, perDayTotal, paybackTasks, buildTable, report };

if (require.main === module && process.argv.includes('--markdown')) {
    for (const cls of PURCHASABLE) console.log(['### ' + cls, '', buildTable(cls), ''].join('\n'));
} else if (require.main === module) {
    console.log('Per task (base 10, levels 6 / 16 / 29). payback = tasks to repay class + whole tree.');
    console.table(report());
}
