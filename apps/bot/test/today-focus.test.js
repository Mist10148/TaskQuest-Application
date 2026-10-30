/** /today and /focus: what they show, and that /focus finish never cancels a session that cannot pay yet. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('@taskquest/shared/db');
const { LIMITS } = require('@taskquest/shared');
const today = require('../commands/today');
const focus = require('../commands/focus');

const text = (payload) => {
    const json = payload.embeds[0].toJSON();
    return [json.title, json.description, ...(json.fields || []).flatMap((f) => [f.name, f.value])].filter(Boolean).join('\n');
};

const day = (over = {}) => ({
    day: '2030-01-10',
    counts: { dueToday: 1, overdue: 1, doneToday: 2 },
    tasks: [
        { id: 1, name: 'Pay rent', listName: 'Home', dueDate: '2030-01-08', priority: 'HIGH', overdueDays: 2 },
        { id: 2, name: 'Call mum', listName: 'Home', dueDate: '2030-01-10', priority: null, overdueDays: 0 }
    ],
    upcoming: [{ id: 3, name: 'Dentist', listName: 'Health', dueDate: '2030-01-12', priority: null, overdueDays: 0 }],
    streak: { live: 4, claimedToday: false, atRisk: true },
    goal: { target: 10, progress: 3, claimed: false, claimable: false, min: 3, max: 60 },
    xpEnabled: true,
    ...over
});

test('/today shows the counts, late and due tasks, what is coming, the streak and the goal', () => {
    const out = text(today.render(day()));
    assert.match(out, /\*\*1\*\* due today · \*\*1\*\* overdue · \*\*2\*\* done today/);
    assert.match(out, /🔴 Pay rent · \*Home\* · \*\*2 days late\*\*/);
    assert.match(out, /Call mum · \*Home\* · due today/);
    assert.match(out, /Coming up this week\nDentist|Dentist · \*Health\* · due 2030-01-12/);
    assert.match(out, /🔥 4 days · \*\*claim \/daily today to keep it\*\*/);
    assert.match(out, /3\/10 tasks/);
});

test('/today says when nothing is due, and leaves XP out when it is off', () => {
    const out = text(today.render(day({ tasks: [], upcoming: [], counts: { dueToday: 0, overdue: 0, doneToday: 0 }, xpEnabled: false })));
    assert.match(out, /Nothing due/);
    assert.doesNotMatch(out, /Streak|Weekly goal/);
});

test('/today says how many are due in all when the list is cut short', () => {
    const out = text(today.render(day({ counts: { dueToday: 5, overdue: 4, doneToday: 0 } })));
    assert.match(out, /9 tasks are due or overdue in all/);
});

/** A slash interaction that records what the bot answers. */
function fake(sub, minutes = null) {
    const calls = [];
    const record = (kind) => async (payload) => calls.push({ kind, payload });
    return {
        user: { id: '42' },
        options: { getSubcommand: () => sub, getInteger: () => minutes },
        calls,
        deferReply: record('deferReply'),
        editReply: record('editReply'),
        followUp: record('followUp')
    };
}

const status = (active) => ({ active, today: { sessions: 1, xp: 15, remainingSessions: 7, remainingXP: 85 } });

test('/focus start uses 25 minutes unless told otherwise and shows the running session', async () => {
    let started = null;
    const now = new Date().toISOString();
    db.focus.startFocus = async (_id, minutes) => {
        started = minutes;
    };
    db.focus.getFocusStatus = async () => status({ sessionId: 9, startedAt: now, minutes: 25, endsAt: new Date(Date.now() + 25 * 60_000).toISOString() });
    const i = fake('start');
    await focus.execute(i);
    assert.equal(started, 25);
    assert.match(text(i.calls.at(-1).payload), /25 minute session/);
});

test('/focus finish refuses to cancel a session that cannot pay yet', async () => {
    let finished = false;
    db.focus.finishFocus = async () => {
        finished = true;
    };
    db.focus.getFocusStatus = async () => status({ sessionId: 9, startedAt: new Date().toISOString(), minutes: 25, endsAt: new Date().toISOString() });
    const i = fake('finish');
    await focus.execute(i);
    assert.equal(finished, false);
    assert.match(text(i.calls.at(-1).payload), /Too early to finish/);
});

test('/focus finish pays a session that ran long enough', async () => {
    const startedAt = new Date(Date.now() - (LIMITS.FOCUS_MIN_MINUTES + 5) * 60_000).toISOString();
    db.focus.getFocusStatus = async () => status({ sessionId: 9, startedAt, minutes: 25, endsAt: new Date(Date.now() + 60_000).toISOString() });
    db.focus.finishFocus = async (_id, sid) => ({ sessionId: sid, state: 'finished', minutesCredited: 15, xp: 9, capped: false, balance: 1009, achievements: [] });
    const i = fake('finish');
    await focus.execute(i);
    assert.match(text(i.calls.at(-1).payload), /15 minutes focused · \*\*\+9 XP\*\*/);
});
