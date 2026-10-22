'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { streakState } = require('../src/db/today');

const user = (last, over = {}) => ({ discord_id: '1', timezone: 'UTC', player_class: 'DEFAULT', streak_count: 5, last_daily_claim: new Date(last), ...over });

test('a streak claimed late last night is not at risk before the cooldown ends, and its expiry is the rolling window', () => {
    // Claimed 23:30 on the 10th; at 18:00 on the 11th /daily would still refuse (24 h cooldown).
    const u = user('2030-03-10T23:30:00Z');
    const early = streakState(u, [], new Date('2030-03-11T18:00:00Z'));
    assert.equal(early.daysLeft, 0);
    assert.equal(early.atRisk, false, 'no warning for a claim the cooldown would refuse');
    assert.equal(early.claimableAt, '2030-03-11T23:30:00.000Z');
    assert.equal(early.expiresAt, '2030-03-12T23:30:00.000Z', 'it lapses 48 h after the claim, not at midnight');
    const late = streakState(u, [], new Date('2030-03-11T23:45:00Z'));
    assert.equal(late.atRisk, true, 'once the reward can be claimed again it is at risk');
});

test('a streak claimed yesterday morning is at risk in the evening, and a claim today makes it safe', () => {
    const risky = streakState(user('2030-03-10T08:00:00Z'), [], new Date('2030-03-11T19:00:00Z'));
    assert.deepEqual([risky.live, risky.claimedToday, risky.daysLeft, risky.atRisk], [5, false, 0, true]);
    assert.equal(risky.expiresAt, '2030-03-12T08:00:00.000Z');
    const safe = streakState(user('2030-03-11T08:00:00Z'), [], new Date('2030-03-11T19:00:00Z'));
    assert.deepEqual([safe.claimedToday, safe.atRisk], [true, false]);
});

test('a lapsed streak has no expiry and is not at risk', () => {
    const lapsed = streakState(user('2030-03-01T08:00:00Z'), [], new Date('2030-03-11T19:00:00Z'));
    assert.deepEqual([lapsed.live, lapsed.expiresAt, lapsed.atRisk], [0, null, false]);
});
