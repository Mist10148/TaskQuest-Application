/** Weekly digest: timing in the user's zone, content, and best-effort AI recap. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sendWeeklyDigests, isDigestTime, digestEmbed, pushForRecap } = require('../utils/digest');

const MONDAY_9_UTC = new Date('2030-03-11T09:00:00Z'); // 2030-03-11 is a Monday
const STATS = { completed: 4, xpEarned: 120, listsOpen: 3, listsOverdue: 1, streak: 5, level: 7 };

test('digests go out on Monday at the reminder hour, in the user\'s own zone', () => {
    assert.equal(isDigestTime({ timezone: null, reminder_hour: 9 }, MONDAY_9_UTC), true);
    assert.equal(isDigestTime({ timezone: null, reminder_hour: 10 }, MONDAY_9_UTC), false, 'before the hour');
    assert.equal(isDigestTime({ timezone: null, reminder_hour: 9 }, new Date('2030-03-12T09:00:00Z')), false, 'Tuesday');
    // Sunday 21:00 UTC is already Monday 05:00 in Manila (UTC+8), but only Sunday in New York.
    const sundayNight = new Date('2030-03-10T21:00:00Z');
    assert.equal(isDigestTime({ timezone: 'Asia/Manila', reminder_hour: 5 }, sundayNight), true);
    assert.equal(isDigestTime({ timezone: 'America/New_York', reminder_hour: 0 }, sundayNight), false);
});

test('the embed reports real numbers, with or without an AI recap', () => {
    const plain = digestEmbed(STATS, null).toJSON();
    assert.match(plain.description, /\*\*4\*\* tasks/);
    assert.match(plain.description, /120 XP/);
    assert.equal(plain.fields.length, 3);
    const withAi = digestEmbed(STATS, { headline: 'Solid week', highlights: ['Finished taxes', 'Cleared inbox'] }).toJSON();
    assert.equal(withAi.fields.at(-1).name, '✨ AI recap');
    assert.match(withAi.fields.at(-1).value, /Finished taxes/);
    assert.match(digestEmbed({ ...STATS, completed: 0 }, null).toJSON().description, /No tasks finished/);
});

function setup({ users, sendError, recapError, claims = () => true }) {
    const marked = [];
    const released = [];
    const order = [];
    const sent = [];
    const aiCalls = [];
    return {
        marked,
        released,
        order,
        sent,
        aiCalls,
        log: () => {},
        db: {
            users: {
                getDigestCandidates: async () => users,
                getWeeklyStats: async () => STATS,
                claimDigest: async (id) => {
                    order.push('claim');
                    const ok = claims(id);
                    if (ok) marked.push(id);
                    return ok;
                },
                releaseDigest: async (id) => {
                    released.push(id);
                    marked.splice(marked.indexOf(id), 1);
                }
            }
        },
        client: {
            users: {
                fetch: async () => ({
                    send: async (m) => {
                        order.push('send');
                        if (sendError) throw sendError;
                        sent.push(m);
                    }
                })
            }
        },
        ai: {
            enabled: true,
            post: async (path, id, body) => {
                aiCalls.push([path, id, body.mode]);
                if (recapError) throw recapError;
                return { headline: 'Good week', highlights: ['x'] };
            }
        }
    };
}

const user = (over = {}) => ({ discord_id: '42', timezone: null, reminder_hour: 9, ai_enabled: 1, ...over });

test('sends to users whose Monday morning it is, adds the AI recap, and marks them', async () => {
    const ctx = setup({ users: [user(), user({ discord_id: '43', reminder_hour: 20 })] });
    const res = await sendWeeklyDigests({ ...ctx, now: MONDAY_9_UTC });
    assert.deepEqual(res, { sent: 1, skipped: 0, retry: 0 });
    assert.deepEqual(ctx.marked, ['42']);
    assert.deepEqual(ctx.aiCalls, [['/v1/summary', '42', 'recap']]);
    assert.equal(ctx.sent[0].embeds[0].toJSON().fields.at(-1).name, '✨ AI recap');
});

test('a failing AI recap never blocks the digest', async () => {
    const ctx = setup({ users: [user()], recapError: new Error('model down') });
    const res = await sendWeeklyDigests({ ...ctx, now: MONDAY_9_UTC });
    assert.equal(res.sent, 1);
    assert.equal(ctx.sent[0].embeds[0].toJSON().fields.length, 3);
});

test('users who opted out of AI are never sent to it', async () => {
    const ctx = setup({ users: [user({ ai_enabled: 0 })] });
    await sendWeeklyDigests({ ...ctx, now: MONDAY_9_UTC });
    assert.equal(ctx.aiCalls.length, 0);
    assert.equal(ctx.sent.length, 1);
});

test('closed DMs are marked; temporary errors retry on the next run', async () => {
    const closed = setup({ users: [user()], sendError: Object.assign(new Error('closed'), { code: 50007 }) });
    assert.equal((await sendWeeklyDigests({ ...closed, now: MONDAY_9_UTC })).skipped, 1);
    assert.deepEqual(closed.marked, ['42']);

    const flaky = setup({ users: [user()], sendError: Object.assign(new Error('503'), { code: 0 }) });
    assert.equal((await sendWeeklyDigests({ ...flaky, now: MONDAY_9_UTC })).retry, 1);
    assert.deepEqual(flaky.marked, []);
    assert.deepEqual(flaky.released, ['42'], 'the claim is handed back for the retry');
});

test('the week is claimed atomically before sending, so overlapping runs cannot double send', async () => {
    const claimed = new Set();
    const claims = (id) => (claimed.has(id) ? false : (claimed.add(id), true));
    const a = setup({ users: [user()], claims });
    const b = setup({ users: [user()], claims });
    const [ra, rb] = await Promise.all([sendWeeklyDigests({ ...a, now: MONDAY_9_UTC }), sendWeeklyDigests({ ...b, now: MONDAY_9_UTC })]);
    assert.equal(ra.sent + rb.sent, 1);
    assert.equal(a.sent.length + b.sent.length, 1);
    for (const ctx of [a, b]) assert.equal(ctx.order[0], 'claim', 'claimed before any send');
});

// ─── web push for the AI recap ─────────────────────────────────────────────────────

const fakePush = () => {
    const calls = [];
    return { enabled: true, calls, notify: async (id, message) => calls.push([id, message]) };
};

test('the AI recap is also offered as a web push once the digest went out', async () => {
    const ctx = setup({ users: [user()] });
    const push = fakePush();
    await sendWeeklyDigests({ ...ctx, push, now: MONDAY_9_UTC });
    assert.equal(ctx.sent.length, 1);
    assert.deepEqual(push.calls, [['42', { title: 'Your weekly recap', body: 'Good week', url: '/stats' }]]);
});

test('no recap, no push: a digest without an AI recap stays a DM only', async () => {
    const push = fakePush();
    await sendWeeklyDigests({ ...setup({ users: [user()], recapError: new Error('model down') }), push, now: MONDAY_9_UTC });
    await sendWeeklyDigests({ ...setup({ users: [user({ ai_enabled: 0 })] }), push, now: MONDAY_9_UTC });
    assert.deepEqual(push.calls, []);
});

test('closed DMs still get the push (the digest is final), a temporary error waits for the retry', async () => {
    const push = fakePush();
    const closed = setup({ users: [user()], sendError: Object.assign(new Error('closed'), { code: 50007 }) });
    await sendWeeklyDigests({ ...closed, push, now: MONDAY_9_UTC });
    assert.equal(push.calls.length, 1, 'DMs can never go out, so the push is the only way');

    const flaky = setup({ users: [user()], sendError: Object.assign(new Error('503'), { code: 0 }) });
    await sendWeeklyDigests({ ...flaky, push, now: MONDAY_9_UTC });
    assert.equal(push.calls.length, 1, 'no push while the digest is still being retried');
});

test('a broken or missing push client never breaks the digest', async () => {
    const throwing = { enabled: true, notify: async () => { throw new Error('push server down'); } };
    const ctx = setup({ users: [user()] });
    const res = await sendWeeklyDigests({ ...ctx, push: throwing, now: MONDAY_9_UTC });
    assert.equal(res.sent, 1);
    assert.deepEqual(await sendWeeklyDigests({ ...setup({ users: [user()] }), push: undefined, now: MONDAY_9_UTC }), { sent: 1, skipped: 0, retry: 0 });
    assert.deepEqual(await sendWeeklyDigests({ ...setup({ users: [user()] }), push: { enabled: false, notify: async () => assert.fail('disabled') }, now: MONDAY_9_UTC }), { sent: 1, skipped: 0, retry: 0 });
});

test('pushForRecap needs a headline and keeps the body short', () => {
    assert.equal(pushForRecap(null), null);
    assert.equal(pushForRecap({}), null);
    assert.equal(pushForRecap({ headline: '   ' }), null);
    const long = pushForRecap({ headline: 'x'.repeat(500) });
    assert.equal(long.body.length, 140);
    assert.equal(long.url, '/stats');
});
