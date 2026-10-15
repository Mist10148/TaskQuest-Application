/**
 * Docs consistency: the tables in docs/GAMEPLAY.md must say what constants.js says.
 *
 * The code is the source of truth. A failure names the document row, so fix the doc (or, if the code has a typo,
 * fix the code and re-check). The parsing is deliberately tolerant: it finds markdown table rows by their first
 * column (emoji, bold and backticks stripped) and compares numbers, so rewording a cell does not break it.
 * No database is needed.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../src/constants');

const DOC = 'docs/GAMEPLAY.md';
const text = fs.readFileSync(path.join(__dirname, '..', '..', '..', DOC), 'utf8').replace(/\r\n/g, '\n');
const lines = text.split('\n');

// ─── Markdown helpers ─────────────────────────────────────────────────────────

/** Heading lines as { level, title, index }. */
const headings = lines
    .map((line, index) => {
        const m = /^(#{2,4})\s+(.*)$/.exec(line);
        return m ? { level: m[1].length, title: m[2].trim(), index } : null;
    })
    .filter(Boolean);

/** Remove emoji, bold markers and backticks from the start/inside of a cell: "⚔️ **Hero**" -> "Hero". */
function clean(cell) {
    return String(cell).replace(/\*\*|`/g, '').replace(/^[^A-Za-z0-9]+/, '').trim();
}

/** Every integer or decimal in a string, ignoring thousands separators ("1,000" -> 1000). */
function numbers(str) {
    return (String(str).replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(?:\.\d+)?/g) || []).map(Number);
}

/** Lines between a heading whose title matches `re` and the next heading of the same or a higher level. */
function section(re) {
    const i = headings.findIndex((h) => re.test(h.title));
    assert.ok(i >= 0, `${DOC}: no heading matching ${re}`);
    const end = headings.slice(i + 1).find((h) => h.level <= headings[i].level);
    return lines.slice(headings[i].index + 1, end ? end.index : lines.length);
}

/** Markdown tables inside some lines: [{ header: [cells], rows: [[cells]] }]. */
function tables(block) {
    const out = [];
    let cur = null;
    for (const line of block) {
        if (!/^\s*\|/.test(line)) {
            cur = null;
            continue;
        }
        const cells = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // the separator row
        if (!cur) {
            cur = { header: cells.map((c) => c.toLowerCase()), rows: [] };
            out.push(cur);
        } else {
            cur.rows.push(cells);
        }
    }
    return out;
}

const col = (table, re) => table.header.findIndex((h) => re.test(h));

/** Collect problems and fail once with every one of them listed. */
function check(label, problems) {
    assert.equal(problems.length, 0, `${label} disagrees with constants.js:\n  - ${problems.join('\n  - ')}`);
}

// ─── Classes ──────────────────────────────────────────────────────────────────

test('GAMEPLAY §3 class costs match CLASSES', () => {
    const [table] = tables(section(/^3\. Classes/));
    const cost = col(table, /cost/);
    assert.ok(cost > 0, 'the class table needs a Cost column');
    const problems = [];
    const seen = new Set();
    for (const row of table.rows) {
        const name = clean(row[0]);
        const entry = Object.values(C.CLASSES).find((c) => c.name === name);
        if (!entry) {
            problems.push(`§3 row "${name}": no such class`);
            continue;
        }
        seen.add(name);
        if (numbers(row[cost])[0] !== entry.cost) problems.push(`§3 row "${name}": cost ${row[cost]} but constants.js says ${entry.cost}`);
    }
    for (const c of Object.values(C.CLASSES)) if (!seen.has(c.name)) problems.push(`§3: class "${c.name}" has no row`);
    check('The class table', problems);
});

// ─── Skills ───────────────────────────────────────────────────────────────────

test('GAMEPLAY §4 skill tables match SKILL_TREES (name, max level, cost, prerequisite)', () => {
    const block = section(/^4\. Skills/);
    const problems = [];
    const trees = Object.values(C.SKILL_TREES);
    const documented = new Set();
    // Each "### <emoji> <Tree>" subsection holds one table. section() stops at the next heading of the same level,
    // so walk the lines of the whole §4 block by tree heading instead.
    const starts = [];
    lines.forEach((line, index) => {
        const m = /^###\s+(.*)$/.exec(line);
        if (m && trees.some((t) => t.name === clean(m[1]))) starts.push({ tree: trees.find((t) => t.name === clean(m[1])), index });
    });
    assert.ok(block.length > 0 && starts.length > 0, 'no skill tree headings found in §4');
    starts.forEach((s, i) => {
        const end = i + 1 < starts.length ? starts[i + 1].index : lines.findIndex((l, n) => n > s.index && /^## /.test(l));
        const [table] = tables(lines.slice(s.index + 1, end === -1 ? lines.length : end));
        assert.ok(table, `${DOC} §4 ${s.tree.name}: no table`);
        const max = col(table, /^max/);
        const cost = col(table, /^cost/);
        const req = col(table, /^requires/);
        assert.ok(max > 0 && cost > 0 && req > 0, `§4 ${s.tree.name}: the table needs Max, Cost and Requires columns`);
        const skills = Object.entries(s.tree.skills);
        const byName = new Map(skills.map(([id, sk]) => [sk.name, { id, sk }]));
        for (const row of table.rows) {
            const name = clean(row[0]);
            const found = byName.get(name);
            const where = `§4 ${s.tree.name} row "${name}"`;
            if (!found) {
                problems.push(`${where}: no such skill in this tree`);
                continue;
            }
            documented.add(found.id);
            if (numbers(row[max])[0] !== found.sk.maxLevel) problems.push(`${where}: max level ${row[max]} but constants.js says ${found.sk.maxLevel}`);
            if (numbers(row[cost])[0] !== found.sk.cost) problems.push(`${where}: cost ${row[cost]} but constants.js says ${found.sk.cost}`);
            const wanted = found.sk.requires ? C.findSkill(found.sk.requires).skill.name : null;
            const got = clean(row[req]);
            if (wanted ? got !== wanted : !/^$|^—$|^-$/.test(got)) problems.push(`${where}: requires "${row[req]}" but constants.js says ${wanted || 'nothing'}`);
        }
    });
    for (const [treeKey, tree] of Object.entries(C.SKILL_TREES)) {
        for (const [id, sk] of Object.entries(tree.skills)) if (!documented.has(id)) problems.push(`§4 ${tree.name}: skill "${sk.name}" (${id}) has no row`);
        if (!starts.some((s) => s.tree === tree)) problems.push(`§4: tree ${treeKey} has no heading`);
    }
    check('The skill tables', problems);
});

test('GAMEPLAY states the real number of skills and trees', () => {
    const skills = Object.values(C.SKILL_TREES).reduce((n, t) => n + Object.keys(t.skills).length, 0);
    const trees = Object.keys(C.SKILL_TREES).length;
    const m = /There are (\d+) skills in (\d+) trees/.exec(text);
    assert.ok(m, `${DOC}: the sentence "There are N skills in M trees" is missing`);
    assert.deepEqual([Number(m[1]), Number(m[2])], [skills, trees], `${DOC}: says ${m[1]} skills in ${m[2]} trees but constants.js has ${skills} in ${trees}`);
});

// ─── Quests ───────────────────────────────────────────────────────────────────

test('GAMEPLAY §5b quest tables match QUESTS (period, target, reward)', () => {
    const tabs = tables(section(/^5b\. Quests/));
    const problems = [];
    const seen = new Set();
    for (const table of tabs) {
        const goal = col(table, /goal/);
        const reward = col(table, /reward/);
        const period = col(table, /period/);
        for (const row of table.rows) {
            const name = clean(row[0]);
            const quest = Object.values(C.QUESTS).find((q) => q.name === name);
            const where = `§5b row "${name}"`;
            if (!quest) {
                problems.push(`${where}: no such quest`);
                continue;
            }
            seen.add(name);
            const target = numbers(row[goal])[0] ?? 1; // "Complete a high-priority task" has no number: a target of 1
            if (target !== quest.target) problems.push(`${where}: goal "${row[goal]}" but constants.js says a target of ${quest.target}`);
            if (numbers(row[reward])[0] !== quest.reward) problems.push(`${where}: reward ${row[reward]} but constants.js says ${quest.reward} XP`);
            if (period >= 0 && clean(row[period]).toLowerCase() !== quest.period) problems.push(`${where}: period ${row[period]} but constants.js says ${quest.period}`);
        }
    }
    for (const q of Object.values(C.QUESTS)) if (!seen.has(q.name)) problems.push(`§5b: quest "${q.name}" has no row`);
    check('The quest tables', problems);
});

test('GAMEPLAY rotates four weekly quests by ISO week mod 4', () => {
    assert.equal(C.ROTATING_QUESTS.length, 4);
    assert.match(text, /ISO week number mod 4/, `${DOC}: the rotation rule "ISO week number mod 4" is missing`);
});

// ─── Achievements ─────────────────────────────────────────────────────────────

test('GAMEPLAY §6 states the achievement count and lists every key', () => {
    const keys = Object.keys(C.ACHIEVEMENTS);
    const block = section(/^6\. Achievements/).join('\n');
    const m = /There are (\d+) achievements/.exec(block);
    assert.ok(m, `${DOC} §6: the sentence "There are N achievements" is missing`);
    const problems = [];
    if (Number(m[1]) !== keys.length) problems.push(`§6 says ${m[1]} achievements but constants.js has ${keys.length}`);
    for (const key of keys) if (!block.includes('`' + key + '`')) problems.push(`§6: achievement \`${key}\` is not listed`);
    const documented = [...block.matchAll(/`([A-Z][A-Z_0-9]+)`/g)].map((x) => x[1]);
    for (const key of documented) if (!C.ACHIEVEMENTS[key]) problems.push(`§6: \`${key}\` is not an achievement`);
    check('The achievements section', problems);
    // The documented per-category thresholds ("FIRST_LIST 1 · FIVE_LISTS 5 ...") follow the key names: spot-check the numbers.
    const thresholds = { FIRST_LIST: 1, FIVE_LISTS: 5, TEN_LISTS: 10, FIRST_ITEM: 1, TEN_ITEMS: 10, FIFTY_ITEMS: 50, HUNDRED_ITEMS: 100 };
    for (const [key, n] of Object.entries(thresholds)) {
        assert.match(block, new RegExp('`' + key + '` ' + n + '\\b'), `${DOC} §6: \`${key}\` should show the threshold ${n}`);
    }
});

// ─── Rewards, bonuses, limits ─────────────────────────────────────────────────

/** Find a row whose first column (cleaned) matches `re` in the tables of a block. */
function rowOf(block, re, label) {
    for (const t of tables(block)) for (const row of t.rows) if (re.test(clean(row[0]))) return row;
    assert.fail(`${DOC}: no table row for ${label} (looked for ${re})`);
}

/** Every number in `expected` must appear in the row's cells after the first. */
function expectRow(problems, where, row, expected) {
    const have = numbers(row.slice(1).join(' | '));
    for (const n of expected) if (!have.includes(n)) problems.push(`${where}: should mention ${n}, but the row says "${row.slice(1).join(' | ').slice(0, 90)}"`);
}

test('GAMEPLAY §1 base rewards match REWARDS', () => {
    const block = section(/^1\. XP and levels/);
    const problems = [];
    const spec = [
        [/^Create a list$/, C.REWARDS.LIST_CREATE, C.LIMITS.LIST_CREATE_REWARDS_PER_DAY],
        [/^Add a task$/, C.REWARDS.ITEM_ADD, C.LIMITS.ITEM_ADD_REWARDS_PER_DAY],
        [/^Complete a task$/, C.REWARDS.ITEM_COMPLETE, C.LIMITS.ITEM_COMPLETE_REWARDS_PER_DAY],
        [/^Daily reward$/, C.REWARDS.DAILY_BASE],
        [/^RPS win$/, C.REWARDS.RPS_WIN]
    ];
    for (const [re, ...nums] of spec) expectRow(problems, `§1 row "${re.source.replace(/[\^$]/g, '')}"`, rowOf(block, re, String(re)), nums);
    assert.match(block.join('\n'), new RegExp(`100 XP`), `${DOC} §1: levels should say 100 XP per level`);
    assert.equal(C.XP_PER_LEVEL, 100, 'XP_PER_LEVEL changed: update §1, the level formula in xp.js docs and docs/design/balance.md');
    check('The base reward table', problems);
});

test('GAMEPLAY §5c bonus sources match REWARDS, LIMITS and STREAK_CHESTS', () => {
    const block = section(/^5c\. Bonus XP sources/);
    const R = C.REWARDS;
    const L = C.LIMITS;
    const problems = [];
    const spec = {
        first_of_day: [R.FIRST_OF_DAY],
        list_cleared: [R.LIST_CLEARED, L.LIST_CLEARED_PER_DAY],
        early_finish: [R.EARLY_FINISH_PER_DAY, L.EARLY_FINISH_MAX, L.DEADLINE_BONUS_XP_PER_DAY],
        overdue_clear: [R.OVERDUE_CLEAR, L.DEADLINE_BONUS_XP_PER_DAY],
        subtasks_done: [R.SUBTASKS_DONE, L.SUBTASKS_DONE_XP_PER_DAY],
        streak_chest: Object.entries(C.STREAK_CHESTS).flat().map(Number),
        achievement_reward: [R.ACHIEVEMENT],
        habit_bonus: [R.HABIT_PER_STREAK, R.HABIT_MIN_STREAK, L.HABIT_MAX, L.HABIT_XP_PER_DAY],
        focus_session: [R.FOCUS_XP_PER_MINUTE, L.FOCUS_XP_PER_DAY, L.FOCUS_SESSIONS_PER_DAY],
        weekly_review: [R.WEEKLY_REVIEW],
        perfect_day: [R.PERFECT_DAY, L.PERFECT_DAY_MIN_TASKS],
        inbox_zero: [R.INBOX_ZERO, L.INBOX_ZERO_MIN_OVERDUE],
        boss_defeated: [R.BOSS_DEFEATED, L.BOSS_MIN_SUBTASKS, L.BOSS_XP_PER_DAY],
        comeback: [R.COMEBACK, L.COMEBACK_AFTER_DAYS],
        party_assist: [R.PARTY_ASSIST, L.PARTY_ASSIST_XP_PER_DAY],
        estimate_accuracy: [R.ESTIMATE_ACCURACY, L.ESTIMATE_TOLERANCE_PERCENT, L.ESTIMATE_XP_PER_DAY],
        reflection: [R.REFLECTION],
        weekly_goal: [R.WEEKLY_GOAL_BASE, R.WEEKLY_GOAL_PER_TASK, L.WEEKLY_GOAL_MAX_XP]
    };
    for (const [source, expected] of Object.entries(spec)) {
        expectRow(problems, `§5c row \`${source}\``, rowOf(block, new RegExp('^' + source + '$'), source), expected);
    }
    for (const source of Object.keys(spec)) {
        if (!C.WEEKLY_XP_SOURCES.includes(source)) problems.push(`§5c: \`${source}\` is documented as counting for the weekly board but is missing from WEEKLY_XP_SOURCES`);
    }
    if (L.DUE_DATE_MIN_AGE_HOURS !== 24) problems.push(`§5c says a due date must be at least 24 hours old, but DUE_DATE_MIN_AGE_HOURS is ${L.DUE_DATE_MIN_AGE_HOURS}`);
    check('The bonus source table', problems);
});

test('GAMEPLAY §5 daily reward, chests and streak freezes match DAILY and STREAK_FREEZE', () => {
    const daily = section(/^5\. Daily reward/).join('\n');
    const problems = [];
    const cooldown = C.DAILY.COOLDOWN_MS / 3600e3;
    if (!new RegExp(`\\b${cooldown}\\s*(?:-| )?hours?\\b`).test(daily)) problems.push(`§5 should mention a ${cooldown} hour cooldown`);
    // The streak window is counted in calendar days: Streak Shield (one missed day) and Sanctuary (two).
    for (const n of [C.DAILY.SHIELDED_STREAK_DAYS, C.DAILY.SANCTUARY_STREAK_DAYS]) {
        if (!new RegExp(`\\b${n}\\s*days?\\b`).test(daily)) problems.push(`§5 should mention a streak window of ${n} days`);
    }
    const streak = rowOfText(daily, /\*\*XP\*\*/);
    if (!streak || !numbers(streak).includes(C.REWARDS.DAILY_STREAK_MAX_BONUS) || !numbers(streak).includes(C.REWARDS.DAILY_STREAK_STEP)) {
        problems.push(`§5 XP line should say ${C.REWARDS.DAILY_STREAK_STEP} per streak day and a max of ${C.REWARDS.DAILY_STREAK_MAX_BONUS}`);
    }
    const chests = rowOfText(daily, /Streak chests/);
    for (const n of Object.entries(C.STREAK_CHESTS).flat().map(Number)) if (!chests || !numbers(chests).includes(n)) problems.push(`§5 streak chest line should mention ${n}`);
    const freeze = text.slice(text.indexOf('### Streak freeze'), text.indexOf('## 5b.'));
    assert.ok(freeze.length > 0, `${DOC}: the "Streak freeze" subsection is missing`);
    for (const n of [C.STREAK_FREEZE.COST, C.STREAK_FREEZE.MAX, C.STREAK_FREEZE_CACHE.COST, C.STREAK_FREEZE_CACHE.MAX]) {
        if (!new RegExp(`\\b${n}\\b`).test(freeze)) problems.push(`§5 Streak freeze should mention ${n}`);
    }
    check('The daily reward section', problems);
});

/** The first line in `str` matching `re` (a paragraph or bullet is one line in this document). */
function rowOfText(str, re) {
    return String(str).split('\n').find((l) => re.test(l)) || null;
}

test('GAMEPLAY §8 limits table matches LIMITS, STREAK_FREEZE, PRESTIGE, PARTY_QUEST and the game limits', () => {
    const block = section(/^8\. Limits and anti-farming/);
    const L = C.LIMITS;
    const problems = [];
    const spec = [
        [/^Rewarded list creations per day$/, [L.LIST_CREATE_REWARDS_PER_DAY]],
        [/^Rewarded task additions per day$/, [L.ITEM_ADD_REWARDS_PER_DAY]],
        [/^Rewarded task completions per day$/, [L.ITEM_COMPLETE_REWARDS_PER_DAY]],
        [/^Streak freezes held$/, [C.STREAK_FREEZE.MAX, C.STREAK_FREEZE_CACHE.MAX]],
        [/^List-cleared bonus$/, [L.LIST_CLEARED_PER_DAY]],
        [/^Early-finish \+ overdue-clear bonuses$/, [L.DEADLINE_BONUS_XP_PER_DAY]],
        [/^Subtasks-done bonus$/, [L.SUBTASKS_DONE_XP_PER_DAY]],
        [/^Habit bonus$/, [L.HABIT_MAX, L.HABIT_XP_PER_DAY]],
        [/^Focus sessions$/, [L.FOCUS_MIN_MINUTES, L.FOCUS_MAX_MINUTES, L.FOCUS_XP_PER_DAY, L.FOCUS_SESSIONS_PER_DAY]],
        [/^Party quest$/, [C.PARTY_QUEST.PER_MEMBER_TARGET, C.PARTY_QUEST.REWARD, C.PARTY_QUEST.MIN_OWN_TO_CLAIM]],
        [/^List members$/, [L.MAX_LIST_MEMBERS, L.INVITES_PER_DAY, L.INVITE_TTL_DAYS]],
        [/^Party members$/, [L.MAX_PARTY_MEMBERS]],
        [/^Achievement rewards$/, [C.REWARDS.ACHIEVEMENT]],
        [/^Prestige$/, [C.PRESTIGE.MIN_LEVEL, C.PRESTIGE.MAX]],
        [/^Free-game XP/, [L.FREE_GAME_XP_PER_DAY]],
        [/^Cooldown between RPS and Hangman rounds$/, [L.GAME_COOLDOWN_MS / 1000]],
        [/^Abandoned game session timeout$/, [L.GAME_SESSION_TTL_MINUTES]]
    ];
    for (const [re, expected] of spec) {
        expectRow(problems, `§8 row "${re.source.replace(/[\^$\\]/g, '')}"`, rowOf(block, re, String(re)), expected);
    }
    check('The limits table', problems);
});

test('GAMEPLAY quotes the import quota and the web rate limits from the code', () => {
    // The quota and rate limits live in the API docs, but GAMEPLAY must not contradict the constants either.
    assert.equal(C.LIMITS.MAX_LISTS_PER_USER, 200);
    assert.equal(C.LIMITS.MAX_ITEMS_PER_USER, 5000);
    const api = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs/API.md'), 'utf8');
    assert.match(api, /200 quests per account and 5000 tasks/, 'docs/API.md: the account limits should say 200 quests and 5000 tasks');
});

// ─── Prestige, cosmetics, parties ─────────────────────────────────────────────

test('GAMEPLAY §5f prestige titles and numbers match PRESTIGE and PRESTIGE_TITLES', () => {
    const block = section(/^5f\. Prestige/);
    const problems = [];
    const [table] = tables(block);
    const titles = table.rows.find((r) => /^Title$/i.test(clean(r[0])));
    assert.ok(titles, `${DOC} §5f: the "Title" row is missing`);
    C.PRESTIGE_TITLES.slice(1).forEach((title, i) => {
        if (clean(titles[i + 1]) !== title) problems.push(`§5f title for prestige ${i + 1}: "${titles[i + 1]}" but constants.js says "${title}"`);
    });
    const body = block.join('\n');
    for (const n of [C.PRESTIGE.MIN_LEVEL, C.PRESTIGE.MAX, C.PRESTIGE.BONUS_PERCENT]) if (!new RegExp(`\\b${n}\\b`).test(body)) problems.push(`§5f should mention ${n}`);
    if (!body.includes(C.PRESTIGE.CONFIRM)) problems.push(`§5f should mention the confirmation word ${C.PRESTIGE.CONFIRM}`);
    check('The prestige section', problems);
});

test('GAMEPLAY §5g cosmetics match COSMETICS (name, cost)', () => {
    const block = section(/^5g\. Cosmetics/);
    const problems = [];
    const seen = new Set();
    for (const table of tables(block)) {
        const cost = col(table, /cost/);
        for (const row of table.rows) {
            const name = clean(row[0]);
            const [id, item] = Object.entries(C.COSMETICS).find(([, c]) => c.name === name) || [];
            if (!item) {
                problems.push(`§5g row "${name}": no such cosmetic`);
                continue;
            }
            seen.add(id);
            if (numbers(row[cost])[0] !== item.cost) problems.push(`§5g row "${name}": cost ${row[cost]} but constants.js says ${item.cost}`);
            const req = item.requires;
            const needs = row[col(table, /needs/)] || '';
            if (req && req.level && !numbers(needs).includes(req.level)) problems.push(`§5g row "${name}": needs "${needs}" but constants.js requires level ${req.level}`);
            if (req && req.prestige && !/prestige/i.test(needs)) problems.push(`§5g row "${name}": needs "${needs}" but constants.js requires a prestige`);
            if (req && req.achievement && !needs.includes(C.ACHIEVEMENTS[req.achievement].name)) problems.push(`§5g row "${name}": needs "${needs}" but constants.js requires the ${C.ACHIEVEMENTS[req.achievement].name} achievement`);
            if (!req && !/^-?\s*$/.test(needs.replace(/[–—]/g, '-').trim())) problems.push(`§5g row "${name}": needs "${needs}" but constants.js has no requirement`);
        }
    }
    for (const [id, c] of Object.entries(C.COSMETICS)) if (!seen.has(id)) problems.push(`§5g: cosmetic "${c.name}" (${id}) has no row`);
    check('The cosmetics tables', problems);
});

test('GAMEPLAY §5h party quest numbers match PARTY_QUEST and the party size', () => {
    const body = section(/^5h\. Parties/).join('\n');
    const P = C.PARTY_QUEST;
    const problems = [];
    for (const n of [P.PER_MEMBER_TARGET, P.MIN_OWN_TO_CLAIM, P.REWARD, C.LIMITS.MAX_PARTY_MEMBERS]) {
        if (!new RegExp(`\\b${n}\\b`).test(body)) problems.push(`§5h should mention ${n}`);
    }
    const F = C.PARTY_FOCUS_QUEST;
    for (const n of [F.PER_MEMBER_MINUTES, F.MIN_OWN_MINUTES, F.REWARD]) {
        if (!new RegExp(`\\b${n}\\b`).test(body)) problems.push(`§5h should mention the focus quest number ${n}`);
    }
    if (P.MIN_OWN_TO_CLAIM * 2 !== P.PER_MEMBER_TARGET) problems.push('§5h says the claim needs half the per-member target, but MIN_OWN_TO_CLAIM is not half of PER_MEMBER_TARGET');
    check('The party section', problems);
});

// ─── Games ────────────────────────────────────────────────────────────────────

test('GAMEPLAY §7 blackjack and arcade numbers match BLACKJACK_CONFIG and ARCADE_CONFIG', () => {
    const block = section(/^7\. Games/);
    const body = block.join('\n');
    const B = C.BLACKJACK_CONFIG;
    const problems = [];
    for (const n of [B.MIN_BET, B.MAX_BET_PERCENT * 100, B.HARD_CAP, B.BLACKJACK_MULTIPLIER, C.LIMITS.GAME_SESSION_TTL_MINUTES]) {
        if (!new RegExp(`\\b${String(n).replace('.', '\\.')}\\b`).test(body)) problems.push(`§7 should mention ${n}`);
    }
    const arcade = tables(block).find((t) => col(t, /xp per point/) > 0);
    assert.ok(arcade, `${DOC} §7: the arcade table is missing`);
    const names = { snake: 'Snake', dino: 'Dino Runner', invaders: 'Space Invaders' };
    for (const [key, cfg] of Object.entries(C.ARCADE_CONFIG)) {
        const row = arcade.rows.find((r) => clean(r[0]) === names[key]);
        if (!row) {
            problems.push(`§7: arcade game "${names[key]}" has no row`);
            continue;
        }
        const where = `§7 row "${names[key]}"`;
        if (numbers(row[col(arcade, /xp per point/)])[0] !== cfg.xpPerPoint) problems.push(`${where}: XP per point ${row[col(arcade, /xp per point/)]} but constants.js says ${cfg.xpPerPoint}`);
        if (numbers(row[col(arcade, /max xp/)])[0] !== cfg.maxXP) problems.push(`${where}: max XP ${row[col(arcade, /max xp/)]} but constants.js says ${cfg.maxXP}`);
        if (numbers(row[col(arcade, /second/)])[0] !== cfg.maxPointsPerSecond) problems.push(`${where}: points per second ${row[col(arcade, /second/)]} but constants.js says ${cfg.maxPointsPerSecond}`);
    }
    if (C.HANGMAN_CONFIG.LIVES !== 6 || !/6 lives/.test(body)) problems.push(`§7 Hangman should say ${C.HANGMAN_CONFIG.LIVES} lives`);
    check('The games section', problems);
});
