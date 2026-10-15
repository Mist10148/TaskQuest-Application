'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CLASSES, SKILL_TREES } = require('@taskquest/shared');
const ui = require('../utils/ui');

const KEYS = Object.keys(CLASSES);
const userOf = (cls, extra = {}) => ({ discord_id: '1', player_class: cls, player_xp: 5000, ...extra });
const embedSize = (e) => {
    const j = e.toJSON();
    return (j.title || '').length + (j.description || '').length + (j.footer?.text || '').length + (j.fields || []).reduce((n, f) => n + f.name.length + f.value.length, 0);
};

test('there are 14 classes and every one has a colour and an emoji', () => {
    assert.equal(KEYS.length, 14);
    for (const k of KEYS) {
        assert.equal(typeof ui.COLORS[k], 'number', `${k} colour`);
        assert.equal(ui.classEmoji(k), CLASSES[k].emoji);
    }
    assert.equal(ui.classEmoji('NOPE'), '⚪');
});

test('the class browser fits Discord limits for every class', () => {
    for (const k of KEYS) {
        const rows = ui.classBrowserButtons(userOf(k), k, CLASSES[k], KEYS.indexOf(k), KEYS.length).map((r) => r.toJSON());
        assert.ok(rows.length <= 5, `${k} rows`);
        for (const r of rows) assert.ok(r.components.length <= 5, `${k} components`);
        const select = rows[0].components[0];
        assert.equal(select.custom_id, 'class_select');
        assert.equal(select.options.length, 14);
        assert.ok(select.options.length <= 25);
        assert.equal(select.options.filter((o) => o.default).length, 1);
        assert.equal(select.options.find((o) => o.default).value, k);
        const nav = rows[1].components;
        assert.equal(nav[0].disabled, KEYS.indexOf(k) === 0);
        assert.equal(nav[2].disabled, KEYS.indexOf(k) === KEYS.length - 1);
        assert.match(nav[1].label, new RegExp(`^${KEYS.indexOf(k) + 1} / 14$`));
        for (const o of select.options) {
            assert.ok(o.label.length <= 100 && o.description.length <= 100);
        }
    }
});

test('class and skill embeds respect Discord field and embed limits', () => {
    for (const k of KEYS) {
        const detail = ui.classDetailEmbed(userOf(k), k, CLASSES[k], SKILL_TREES[k], 0, 14);
        const skills = ui.skillTreeEmbed(userOf(k), k, SKILL_TREES, []);
        for (const e of [detail, skills]) {
            assert.ok(embedSize(e) <= 6000, `${k} embed size`);
            for (const f of e.toJSON().fields) assert.ok(f.value.length > 0 && f.value.length <= 1024, `${k} field ${f.name}`);
            assert.ok(e.toJSON().fields.length <= 25);
        }
        const menu = ui.skillSelectMenu(SKILL_TREES[k], []).toJSON().components[0];
        assert.equal(menu.options.length, Object.keys(SKILL_TREES[k].skills).length);
        assert.ok(menu.options.length >= 1 && menu.options.length <= 25);
        for (const o of menu.options) assert.ok(o.description.length <= 100);
        // Every skill is listed somewhere in the tree embed.
        const text = JSON.stringify(skills.toJSON());
        for (const s of Object.values(SKILL_TREES[k].skills)) assert.ok(text.includes(s.name), `${k}: ${s.name}`);
    }
});

test('the class view shows the mechanic and, for the equipped class, the counter', () => {
    const monk = ui.classDetailEmbed(userOf('MONK', { monk_rhythm: 4, monk_day: new Date().toISOString().slice(0, 10) }), 'MONK', CLASSES.MONK, SKILL_TREES.MONK, 6, 14).toJSON();
    assert.match(monk.description, /Rhythm/);
    assert.ok(monk.fields.some((f) => f.name.includes('Playstyle') && f.value === CLASSES.MONK.playstyle));
    assert.ok(monk.fields.some((f) => f.name.includes('Current') && /Rhythm \*\*4\/14\*\*/.test(f.value)));
    const notEquipped = ui.classDetailEmbed(userOf('HERO', { monk_rhythm: 4 }), 'MONK', CLASSES.MONK, SKILL_TREES.MONK, 6, 14).toJSON();
    assert.ok(!notEquipped.fields.some((f) => f.name.includes('Current')));
});

test('classCounterLine reads the counters and the skill-dependent caps', () => {
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(ui.classCounterLine(userOf('HERO')), '');
    assert.match(ui.classCounterLine(userOf('MONK', { monk_rhythm: 3, monk_day: today })), /Rhythm \*\*3\/14\*\*$/);
    assert.match(ui.classCounterLine(userOf('MONK', { monk_rhythm: 3, monk_day: today }), [{ skill_id: 'monk_discipline', skill_level: 1 }]), /3\/16/);
    assert.match(ui.classCounterLine(userOf('MONK', { monk_rhythm: 3, monk_day: '2020-01-01' })), /lapsed/);
    assert.match(ui.classCounterLine(userOf('ALCHEMIST', { alchemist_mix: 3 })), /Brew \*\*2\/3\*\*/);
    assert.match(ui.classCounterLine(userOf('BARD', { bard_recent: '1,2,2,3' })), /Medley \*\*3\/5\*\*/);
    assert.match(ui.classCounterLine(userOf('ARTISAN', { artisan_progress: 7 })), /Project \*\*7\/10\*\*/);
    assert.match(ui.classCounterLine(userOf('ARTISAN', { artisan_progress: 7 }), [{ skill_id: 'artisan_blueprint', skill_level: 1 }]), /7\/13/);
    assert.match(ui.classCounterLine(userOf('NECROMANCER', { necro_souls: 2 })), /Souls \*\*2\/5\*\*/);
    assert.match(ui.classCounterLine(userOf('NECROMANCER', { necro_souls: 2 }), [{ skill_id: 'necro_jar', skill_level: 1 }]), /2\/8/);
});

test('describeChest copes with numbers, strings and objects', () => {
    assert.equal(ui.describeChest(null), '');
    assert.equal(ui.describeChest(100), '+100 XP');
    assert.equal(ui.describeChest({ streak: 7, xp: 75 }), '7-day streak: +75 XP');
    assert.equal(ui.describeChest({ label: 'Week chest', xp: 50 }), 'Week chest: +50 XP');
});

test('chunkFieldValue never exceeds the limit', () => {
    const text = Array.from({ length: 30 }, (_, i) => `block ${i} ${'x'.repeat(100)}`).join('\n\n');
    const fields = ui.chunkFieldValue(text);
    assert.ok(fields.length > 1);
    for (const f of fields) assert.ok(f.value.length <= 1024);
});

// ─── /daily and /freeze text ────────────────────────────────────────────────

const { progression } = require('@taskquest/shared/db');
const gamification = require('../commands/gamification');

function fakeInteraction() {
    const out = { replies: [] };
    return {
        out,
        user: { id: '1' },
        deferReply: async () => {},
        editReply: async (p) => { out.replies.push(p); },
        followUp: async (p) => { out.replies.push(p); },
        reply: async (p) => { out.replies.push(p); }
    };
}

test('/daily shows the Daily Surprise and a milestone chest', async () => {
    const original = progression.claimDaily;
    progression.claimDaily = async () => ({
        claimed: true, totalXP: 250, baseXP: 100, classBonus: 0, streakBonus: 50, skillDailyBonus: 0, surpriseBonus: 50,
        chest: { streak: 7, xp: 50 }, bonusInfo: {}, streak: 7, balance: 900, level: 3, leveledUp: false, achievements: []
    });
    try {
        const i = fakeInteraction();
        await gamification.daily(i);
        const embed = i.out.replies[0].embeds[0].toJSON();
        assert.match(embed.description, /Daily Surprise: \+50 XP/);
        assert.ok(embed.fields.some((f) => f.name.includes('Milestone Chest') && f.value === '7-day streak: +50 XP'));
    } finally {
        progression.claimDaily = original;
    }
});

test('/daily without the new fields shows neither', async () => {
    const original = progression.claimDaily;
    progression.claimDaily = async () => ({ claimed: true, totalXP: 100, baseXP: 100, classBonus: 0, streakBonus: 0, skillDailyBonus: 0, bonusInfo: {}, streak: 1, balance: 100, level: 1, leveledUp: false, achievements: [] });
    try {
        const i = fakeInteraction();
        await gamification.daily(i);
        const embed = i.out.replies[0].embeds[0].toJSON();
        assert.doesNotMatch(embed.description, /Surprise/);
        assert.ok(!embed.fields.some((f) => f.name.includes('Chest')));
    } finally {
        progression.claimDaily = original;
    }
});

test('/freeze reports the holder\'s own cap and cost', async () => {
    const original = progression.buyStreakFreeze;
    progression.buyStreakFreeze = async () => ({ freezes: 2, max: 5, cost: 120, balance: 880, achievements: [] });
    try {
        const i = fakeInteraction();
        await gamification.freeze(i);
        assert.match(i.out.replies[0].embeds[0].toJSON().description, /\*\*2\/5\*\*.*120 XP/);
    } finally {
        progression.buyStreakFreeze = original;
    }
});
