/**
 * /review and /prestige rendering. The database flows (claiming, the two-step reset) are in
 * flows.integration.test.js.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const review = require('../commands/review');
const prestige = require('../commands/prestige');

const ids = (payload) => payload.components.flatMap((r) => r.toJSON().components.map((c) => c.custom_id));
const embed = (payload) => payload.embeds[0].toJSON();

const week = (over = {}) => ({ weekStart: '2030-03-04', completed: 3, xpEarned: 120, claimed: false, claimable: true, streak: 4, reward: 40, ...over });

test('/review offers the claim button only when the bonus is claimable', () => {
    assert.deepEqual(ids(review.render(week())), ['review_claim']);
    assert.match(embed(review.render(week())).description, /\+40 XP/);
    assert.deepEqual(ids(review.render(week({ claimable: false, claimed: true }))), []);
    assert.match(embed(review.render(week({ claimable: false, claimed: true }))).description, /claimed/);
    const none = review.render(week({ completed: 0, claimable: false }));
    assert.deepEqual(ids(none), []);
    assert.match(embed(none).description, /Finish at least one task/);
    assert.match(embed(review.render(week())).fields.map((f) => f.value).join(' '), /3/);
});

const state = (over = {}) => ({ prestige: 0, title: '', nextTitle: 'Veteran', bonusPercent: 0, nextBonusPercent: 2, level: 30, minLevel: 30, max: 10, eligible: true, ...over });

test('/prestige shows the way in only when eligible', () => {
    assert.deepEqual(ids(prestige.render(state())), ['prestige_ask']);
    const low = prestige.render(state({ level: 12, eligible: false }));
    assert.deepEqual(ids(low), []);
    assert.match(embed(low).description, /level 12/);
    const maxed = prestige.render(state({ prestige: 10, title: 'Eternal', nextTitle: null, bonusPercent: 20, nextBonusPercent: null, eligible: false }));
    assert.match(embed(maxed).description, /highest prestige/);
    assert.deepEqual(ids(maxed), []);
});

test('the prestige confirmation is a separate step with an explicit Yes, reset button', () => {
    const c = prestige.confirmation(state());
    assert.deepEqual(ids(c), ['prestige_confirm', 'prestige_cancel']);
    const labels = c.components[0].toJSON().components.map((b) => b.label);
    assert.deepEqual(labels, ['Yes, reset', 'Cancel']);
    assert.match(embed(c).description, /cannot be undone/);
    assert.ok(!ids(prestige.render(state())).includes('prestige_confirm'), 'the first screen cannot reset');
});
