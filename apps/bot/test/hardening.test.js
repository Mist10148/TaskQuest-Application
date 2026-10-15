/**
 * Bot hardening: other people's text is escaped in public embeds, an error on a button keeps its panel,
 * and the digest claim can be given back.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ui = require('../utils/ui');
const { handleError } = require('../utils/respond');
const { TaskQuestError } = require('@taskquest/shared');

test('task names, descriptions and list descriptions cannot inject links or formatting into a list view', () => {
    const list = { id: 1, name: 'Home', description: '[free nitro](https://evil.example)', priority: 'MEDIUM' };
    const items = [
        { id: 1, name: '[Claim](https://evil.example) **now**', description: '[x](https://evil.example)', completed: false, priority: 'LOW' },
        { id: 2, name: '[done](https://evil.example)', completed: true, priority: 'LOW' }
    ];
    const text = ui.listViewEmbed(list, items).toJSON().description;
    assert.ok(!text.includes('](https://'), 'no live masked link survives');
    assert.ok(!text.includes('https://evil'), 'the URL scheme separator is broken up');
    assert.ok(text.includes(String.fromCharCode(92) + '[Claim'), 'the brackets are escaped');
    assert.ok(text.includes('~~'), 'the strike-through formatting of a finished task is still ours');
});

const fakeInteraction = (over = {}) => {
    const calls = [];
    return {
        calls,
        customId: 'quests_claim',
        deferred: true,
        replied: false,
        isMessageComponent: () => true,
        editReply: async (p) => calls.push(['editReply', p]),
        followUp: async (p) => calls.push(['followUp', p]),
        reply: async (p) => calls.push(['reply', p]),
        ...over
    };
};

test('an error on a deferUpdate button is shown beside the panel, which keeps its buttons', async () => {
    const i = fakeInteraction(); // deferUpdate: `ephemeral` was never set
    await handleError(i, new TaskQuestError('CONFLICT', 'Already claimed.', 409));
    assert.equal(i.calls.length, 1);
    assert.equal(i.calls[0][0], 'followUp');
    assert.equal(i.calls[0][1].components, undefined, 'the panel is not touched');
});

test('an error after deferReply still replaces the thinking placeholder', async () => {
    const i = fakeInteraction({ ephemeral: true });
    await handleError(i, new TaskQuestError('CONFLICT', 'Already claimed.', 409));
    assert.equal(i.calls[0][0], 'editReply');
    const slash = fakeInteraction({ isMessageComponent: () => false, ephemeral: false });
    await handleError(slash, new TaskQuestError('NOT_FOUND', 'Nope.', 404));
    assert.equal(slash.calls[0][0], 'editReply');
});

test('the digest claim is stored and released as the same whole second', () => {
    const { wholeSecond } = require('@taskquest/shared/db').users;
    const at = new Date('2030-01-01T10:00:00.789Z');
    assert.equal(wholeSecond(at).getTime(), Date.parse('2030-01-01T10:00:00.000Z'));
    assert.equal(wholeSecond(wholeSecond(at)).getTime(), wholeSecond(at).getTime());
    assert.equal(wholeSecond(at.toISOString()).getTime(), wholeSecond(at).getTime(), 'a value read back as a string still matches');
});
