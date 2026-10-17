/**
 * The skill-tree reset in the /class browser: a Reset Tree button, a confirmation that shows the refund, then the
 * shared progression.respecSkills (the once-a-day limit and the 75% refund live there and are tested in the
 * database suite). The database helpers are stubbed.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('@taskquest/shared/db');
const { SKILL_TREES, TaskQuestError, errors, LIMITS } = require('@taskquest/shared');
const gamification = require('../commands/gamification');

const TREE = SKILL_TREES.HERO;
const [first, second] = Object.keys(TREE.skills);

let owned = [];
db.users.getUser = async () => ({ discord_id: '42', player_class: 'HERO', player_xp: 1000, player_level: 5 });
db.users.getUserSkills = async () => owned;

function fake(customId) {
    const calls = [];
    const record = (kind) => async (payload) => {
        calls.push({ kind, payload });
    };
    return {
        user: { id: '42' },
        customId,
        calls,
        deferred: false,
        replied: false,
        update: record('update'),
        reply: record('reply'),
        followUp: record('followUp'),
        deferUpdate: record('deferUpdate')
    };
}

const rows = (payload) => payload.components.map((r) => r.toJSON().components);
const description = (payload) => payload.embeds[0].toJSON().description || '';

test('the skill tree has a Reset Tree button that is disabled until you own a skill from it', async () => {
    owned = [];
    const none = fake('class_skills_HERO');
    await gamification.handleClassButton(none);
    const reset = rows(none.calls[0].payload)[1].find((c) => c.custom_id === 'skill_respec_HERO');
    assert.ok(reset, 'the button exists');
    assert.equal(reset.disabled, true);

    owned = [{ skill_id: first, skill_level: 1 }];
    const some = fake('class_skills_HERO');
    await gamification.handleClassButton(some);
    assert.equal(rows(some.calls[0].payload)[1].find((c) => c.custom_id === 'skill_respec_HERO').disabled, false);
});

test('a skill from another tree does not enable the button', async () => {
    owned = [{ skill_id: Object.keys(SKILL_TREES.TANK.skills)[0], skill_level: 1 }];
    const click = fake('class_skills_HERO');
    await gamification.handleClassButton(click);
    assert.equal(rows(click.calls[0].payload)[1].find((c) => c.custom_id === 'skill_respec_HERO').disabled, true);
});

test('Reset Tree asks first and shows the refund, with a confirm and a cancel that goes back to the tree', async () => {
    owned = [
        { skill_id: first, skill_level: 2 },
        { skill_id: second, skill_level: 1 }
    ];
    const spent = TREE.skills[first].cost * 2 + TREE.skills[second].cost;
    const refund = Math.floor((spent * LIMITS.RESPEC_REFUND_PERCENT) / 100);

    let respecCalled = false;
    db.progression.respecSkills = async () => {
        respecCalled = true;
    };
    const ask = fake('skill_respec_HERO');
    await gamification.handleClassButton(ask);

    assert.equal(respecCalled, false, 'asking changes nothing');
    assert.equal(ask.calls[0].kind, 'update');
    assert.match(description(ask.calls[0].payload), new RegExp(`${refund.toLocaleString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} XP`));
    const buttons = rows(ask.calls[0].payload)[0];
    assert.deepEqual(buttons.map((b) => b.custom_id), ['skill_respec_yes_HERO', 'skill_back_HERO']);
});

test('confirming resets the tree through progression, refreshes the tree and reports the refund', async () => {
    owned = [{ skill_id: first, skill_level: 1 }];
    let args = null;
    db.progression.respecSkills = async (...a) => {
        args = a;
        owned = [];
        return { treeKey: 'HERO', removed: [first], spent: 100, refund: 75, balance: 1075, percent: 75 };
    };
    const yes = fake('skill_respec_yes_HERO');
    await gamification.handleClassButton(yes);

    assert.deepEqual(args, ['42', 'HERO']);
    assert.deepEqual(yes.calls.map((c) => c.kind), ['update', 'followUp']);
    assert.ok(rows(yes.calls[0].payload)[0].some((c) => c.custom_id === 'skill_select_HERO'), 'back on the tree');
    assert.match(description(yes.calls[1].payload), /refunded \*\*75 XP\*\*/);
});

test('the once-a-day limit is shown as the error it is, and nothing else changes', async () => {
    owned = [{ skill_id: first, skill_level: 1 }];
    db.progression.respecSkills = async () => {
        throw errors.cooldown(3600e3);
    };
    const yes = fake('skill_respec_yes_HERO');
    await gamification.handleClassButton(yes);
    assert.equal(yes.calls.length, 1);
    assert.equal(yes.calls[0].kind, 'reply');
    assert.ok(errors.cooldown(1) instanceof TaskQuestError);
    assert.match(description(yes.calls[0].payload), /Slow down/);
});

test('with no skills in the tree there is nothing to confirm, and a bogus class is ignored', async () => {
    owned = [];
    const empty = fake('skill_respec_HERO');
    await gamification.handleClassButton(empty);
    assert.match(description(empty.calls[0].payload), /Nothing to reset/);

    const bogus = fake('skill_respec_yes_NOPE');
    await gamification.handleClassButton(bogus);
    assert.deepEqual(bogus.calls.map((c) => c.kind), ['deferUpdate']);
});
