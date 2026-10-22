/** Streak-at-risk warning: one DM a day, claimed before sending, given back on a temporary failure. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sendStreakWarnings, warningEmbed, deadlineText } = require('../utils/streakWarning');

const NOW = new Date('2030-03-12T20:00:00Z');
const warning = (over = {}) => ({ discord_id: '42', streak: 5, day: '2030-03-12', timezone: null, ...over });

function setup({ warnings = [warning()], sendError, claims = () => true, push } = {}) {
    const claimed = [];
    const released = [];
    const sent = [];
    const pushed = [];
    return {
        claimed,
        released,
        sent,
        pushed,
        log: () => {},
        now: NOW,
        push: push === undefined ? { enabled: true, notify: async (id, message) => void pushed.push([id, message]) } : push,
        db: {
            today: {
                getStreakWarnings: async () => warnings,
                claimStreakWarning: async (id, day) => {
                    const ok = claims(id);
                    if (ok) claimed.push([id, day]);
                    return ok;
                },
                releaseStreakWarning: async (id, day) => void released.push([id, day])
            }
        },
        client: {
            users: {
                fetch: async () => ({
                    send: async (m) => {
                        if (sendError) throw sendError;
                        sent.push(m);
                    }
                })
            }
        }
    };
}

test('the warning names the streak and says what to do', () => {
    const e = warningEmbed(7).toJSON();
    assert.match(e.title, /7-day streak/);
    assert.match(e.description, /\/daily/);
});

test('the warning gives the real deadline in the player\'s zone, not midnight', () => {
    // A claim at 23:30 UTC lapses 48 h later; for a player in UTC, warned at 20:00 the day it lapses.
    assert.equal(deadlineText('2030-03-12T23:30:00Z', 'UTC', NOW), '11:30 PM today');
    assert.equal(deadlineText('2030-03-13T08:00:00Z', null, NOW), '8:00 AM tomorrow');
    assert.equal(deadlineText('2030-03-13T01:00:00Z', 'America/New_York', NOW), '9:00 PM today', 'converted to their zone');
    assert.equal(deadlineText(null, 'UTC', NOW), null);
    assert.match(warningEmbed(7, '11:30 PM today').toJSON().description, /before 11:30 PM today/);
});

test('the DM and the push both carry the deadline', async () => {
    const ctx = setup({ warnings: [warning({ expiresAt: '2030-03-12T23:30:00Z', timezone: 'UTC' })] });
    await sendStreakWarnings(ctx);
    assert.match(ctx.sent[0].embeds[0].toJSON().description, /before 11:30 PM today/);
    assert.match(ctx.pushed[0][1].body, /before 11:30 PM today/);
});

test('sends one DM, claims the day first, and mirrors it as a web push', async () => {
    const ctx = setup();
    const res = await sendStreakWarnings(ctx);
    assert.deepEqual(res, { sent: 1, skipped: 0, retry: 0 });
    assert.deepEqual(ctx.claimed, [['42', '2030-03-12']]);
    assert.equal(ctx.sent.length, 1);
    assert.deepEqual(ctx.pushed.map(([id, m]) => [id, m.url]), [['42', '/today']]);
});

test('a run that lost the claim sends nothing', async () => {
    const ctx = setup({ claims: () => false });
    const res = await sendStreakWarnings(ctx);
    assert.deepEqual(res, { sent: 0, skipped: 0, retry: 0 });
    assert.equal(ctx.sent.length, 0);
    assert.equal(ctx.pushed.length, 0);
});

test('closed DMs are skipped for good (and still offered as a push); other errors give the day back to retry', async () => {
    const closed = setup({ sendError: Object.assign(new Error('Cannot send messages to this user'), { code: 50007 }) });
    assert.deepEqual(await sendStreakWarnings(closed), { sent: 0, skipped: 1, retry: 0 });
    assert.equal(closed.released.length, 0);
    assert.equal(closed.pushed.length, 1, 'a push still reaches someone with closed DMs');

    const flaky = setup({ sendError: new Error('Discord is down') });
    assert.deepEqual(await sendStreakWarnings(flaky), { sent: 0, skipped: 0, retry: 1 });
    assert.deepEqual(flaky.released, [['42', '2030-03-12']]);
    assert.equal(flaky.pushed.length, 0, 'no push until the warning is final, so a retry never repeats it');
});

test('works without a push client and with several people', async () => {
    const ctx = setup({ warnings: [warning(), warning({ discord_id: '43', streak: 9 })], push: null });
    assert.deepEqual(await sendStreakWarnings(ctx), { sent: 2, skipped: 0, retry: 0 });
    assert.deepEqual(ctx.claimed.map(([id]) => id), ['42', '43']);
});
