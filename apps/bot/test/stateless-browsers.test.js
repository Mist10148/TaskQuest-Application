/**
 * The class browser, the achievements pager and the /list reorder keep no state on the bot: what a click needs is
 * in the button's custom ID. These tests pin that, so a bot restart between two clicks cannot break a flow.
 * The database helpers are stubbed.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('@taskquest/shared/db');
const { CLASSES, SKILL_TREES, ACHIEVEMENTS } = require('@taskquest/shared');
const ui = require('../utils/ui');
const gamification = require('../commands/gamification');
const listCommand = require('../commands/list');

const KEYS = Object.keys(CLASSES);
const user = (cls = 'DEFAULT') => ({ discord_id: '42', player_class: cls, player_xp: 5000, player_level: 5 });

db.users.getUser = async () => user();
db.users.ensureUser = async () => user();
db.users.getUserSkills = async () => [];
db.users.getAchievements = async () => [];

/** A button / select interaction that records what the bot answers. */
function fake({ customId, values } = {}) {
    const calls = [];
    const record = (kind) => async (payload) => {
        calls.push({ kind, payload });
    };
    return {
        user: { id: '42' },
        customId,
        values,
        message: { embeds: [], components: [] },
        calls,
        update: record('update'),
        reply: record('reply'),
        followUp: record('followUp'),
        deferUpdate: record('deferUpdate'),
        deferReply: record('deferReply'),
        editReply: record('editReply')
    };
}

const idsOf = (payload) => payload.components.flatMap((row) => row.toJSON().components.map((c) => c.custom_id));
/** Class embeds use a title; the success/error helpers put their bold heading in the description. */
const embedTitle = (payload) => {
    const json = payload.embeds[0].toJSON();
    return json.title || json.description || '';
};

// ─── achievements pager ─────────────────────────────────────────────────────

const PAGES = Math.ceil(Object.keys(ACHIEVEMENTS).length / 8) || 1;

test('achievement buttons carry their target page and never share a custom ID', () => {
    for (const page of [0, 1, PAGES - 1]) {
        const buttons = ui.achButtons(page, PAGES).toJSON().components;
        const ids = buttons.map((b) => b.custom_id);
        assert.equal(new Set(ids).size, ids.length, `page ${page} has unique ids`);
        for (const id of ids.filter((i) => i !== 'ach_x')) assert.match(id, /^ach_(first|prev|next|last)_\d+$/);
        assert.equal(ids[0], 'ach_first_0');
        assert.equal(ids[1], `ach_prev_${Math.max(0, page - 1)}`);
        assert.equal(ids[3], `ach_next_${Math.min(PAGES - 1, page + 1)}`);
        assert.equal(ids[4], `ach_last_${PAGES - 1}`);
    }
});

test('clicking an achievement button shows that page, whatever the bot remembers', async () => {
    const click = fake({ customId: `ach_next_${PAGES - 1}` });
    await gamification.handleAchievementPagination(click);
    assert.equal(click.calls.length, 1);
    assert.equal(click.calls[0].kind, 'update');
    // The new buttons are built for the last page: next and last are disabled, prev points at the page before.
    const buttons = click.calls[0].payload.components[0].toJSON().components;
    assert.equal(buttons[3].disabled, true);
    assert.equal(buttons[1].custom_id, `ach_prev_${PAGES - 2 < 0 ? 0 : PAGES - 2}`);
});

test('an achievement page past the end is clamped, and a malformed ID is ignored', async () => {
    const far = fake({ customId: 'ach_next_999' });
    await gamification.handleAchievementPagination(far);
    assert.equal(far.calls[0].payload.components[0].toJSON().components[3].disabled, true, 'clamped to the last page');

    const bad = fake({ customId: 'ach_next_x' });
    await gamification.handleAchievementPagination(bad);
    assert.deepEqual(bad.calls.map((c) => c.kind), ['deferUpdate']);
});

// ─── class browser ───────────────────────────────────────────────────────────

test('every class browser button names a real class and the message has unique custom IDs', () => {
    KEYS.forEach((key, index) => {
        const rows = ui.classBrowserButtons(user(key), key, CLASSES[key], index, KEYS.length);
        const ids = rows.flatMap((r) => r.toJSON().components.map((c) => c.custom_id));
        assert.equal(new Set(ids).size, ids.length, `${key}: unique ids`);
        for (const id of ids) assert.ok(id.length <= 100, `${key}: ${id} fits 100 characters`);

        const prev = ids.find((i) => i.startsWith('class_prev_'));
        const next = ids.find((i) => i.startsWith('class_next_'));
        assert.equal(prev, `class_prev_${KEYS[Math.max(0, index - 1)]}`);
        assert.equal(next, `class_next_${KEYS[Math.min(KEYS.length - 1, index + 1)]}`);
        assert.ok(ids.includes(`class_skills_${key}`), `${key}: skill tree button names its class`);
    });
});

test('prev, next and back show the class named in the button', async () => {
    for (const id of ['class_next_HERO', 'class_prev_HERO', 'class_browse_HERO']) {
        const click = fake({ customId: id });
        await gamification.handleClassButton(click);
        assert.equal(click.calls[0].kind, 'update', id);
        assert.match(embedTitle(click.calls[0].payload), new RegExp(CLASSES.HERO.name), id);
        assert.ok(idsOf(click.calls[0].payload).includes('class_skills_HERO'), `${id}: now showing Hero`);
    }
});

test('an unknown class in a button is ignored instead of crashing', async () => {
    const click = fake({ customId: 'class_next_NOPE' });
    await gamification.handleClassButton(click);
    assert.deepEqual(click.calls.map((c) => c.kind), ['deferUpdate']);
});

test('the skill tree view is chosen by the class in the button, and its menu and back button keep it', async () => {
    const click = fake({ customId: 'class_skills_TANK' });
    await gamification.handleClassButton(click);
    assert.equal(click.calls[0].kind, 'update');
    const ids = idsOf(click.calls[0].payload);
    assert.ok(ids.includes('skill_select_TANK'));
    assert.ok(ids.includes('class_browse_TANK'));
});

test('picking a skill uses the tree named by the menu and gives a Back button for that tree', async () => {
    const skillId = Object.keys(SKILL_TREES.HERO.skills)[0];
    const pick = fake({ customId: 'skill_select_HERO', values: [skillId] });
    await gamification.handleSkillSelect(pick);
    assert.equal(pick.calls[0].kind, 'update');
    const ids = idsOf(pick.calls[0].payload);
    assert.ok(ids.includes(`skill_unlock_${skillId}`));
    assert.ok(ids.includes('skill_back_HERO'));

    const back = fake({ customId: 'skill_back_HERO' });
    await gamification.handleClassButton(back);
    assert.ok(idsOf(back.calls[0].payload).includes('skill_select_HERO'));
});

test('a skill that is not in the menu is refused without changing anything', async () => {
    const pick = fake({ customId: 'skill_select_HERO', values: ['not_a_skill'] });
    await gamification.handleSkillSelect(pick);
    assert.match(embedTitle(pick.calls[0].payload), /Invalid Skill/);
});

// ─── /list reorder ───────────────────────────────────────────────────────────

test('the first pick of a reorder travels in the second menu, so a restart does not lose it', async () => {
    db.tasks.getItems = async () => [
        { id: 11, name: 'One', completed: 0 },
        { id: 12, name: 'Two', completed: 0 },
        { id: 13, name: 'Three', completed: 0 }
    ];
    const first = fake({ customId: 'sel_swap1_5', values: ['12'] });
    first.message = { embeds: [], components: [] };
    await listCommand.handleSelectMenu(first);
    const menu = first.calls[0].payload.components[0].toJSON().components[0];
    assert.equal(menu.custom_id, 'sel_swap2_5_12');
    assert.deepEqual(menu.options.map((o) => o.value), ['11', '13'], 'the first pick is not offered again');

    let swapped = null;
    db.tasks.swapItemPositions = async (...args) => {
        swapped = args;
    };
    const second = fake({ customId: 'sel_swap2_5_12', values: ['13'] });
    await listCommand.handleSelectMenu(second);
    assert.deepEqual(swapped, ['42', 12, '13']);
    assert.match(embedTitle(second.calls[0].payload), /Swapped/);
});

test('a second reorder menu without the first pick says it expired', async () => {
    let swapped = false;
    db.tasks.swapItemPositions = async () => {
        swapped = true;
    };
    const stale = fake({ customId: 'sel_swap2_5', values: ['13'] });
    await listCommand.handleSelectMenu(stale);
    assert.equal(swapped, false);
    assert.match(embedTitle(stale.calls[0].payload), /Expired/);
});
