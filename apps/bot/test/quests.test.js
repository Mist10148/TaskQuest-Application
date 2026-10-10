/** /quests rendering: claim buttons appear only for finished, unclaimed quests. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../commands/quests');

const quest = (over) => ({
    key: 'DAILY_COMPLETE_3',
    name: 'Daily Grind',
    emoji: '⚒️',
    description: 'Complete 3 tasks today',
    period: 'daily',
    target: 3,
    reward: 30,
    progress: 1,
    claimed: false,
    claimable: false,
    ...over
});

test('unfinished and claimed quests have no claim button', () => {
    const out = render([quest(), quest({ key: 'DAILY_ADD_3', progress: 3, claimed: true }), quest({ key: 'WEEKLY_DAILY_5', period: 'weekly' })]);
    assert.equal(out.components.length, 0);
    const text = JSON.stringify(out.embeds[0].toJSON());
    assert.match(text, /1\/3/);
    assert.match(text, /claimed/);
});

test('finished quests get one button each, with a stable custom id', () => {
    const out = render([quest({ progress: 3, claimable: true }), quest({ key: 'DAILY_HIGH_1', period: 'daily', claimable: true, progress: 1, target: 1 })]);
    const ids = out.components[0].toJSON().components.map((c) => c.custom_id);
    assert.deepEqual(ids, ['quest_claim_DAILY_COMPLETE_3', 'quest_claim_DAILY_HIGH_1']);
});
