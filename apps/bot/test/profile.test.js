'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { refreshProfile, REFRESH_MS } = require('../utils/profile');

const fakeDb = () => {
    const calls = [];
    return { calls, users: { ensureUser: async (id, profile) => calls.push([id, profile]) } };
};

test('refreshProfile stores the display name, the unique username and the avatar once an hour', async () => {
    const db = fakeDb();
    const user = { id: '1', username: 'bob_42', globalName: 'Bob Smith', displayName: 'Bob Smith', avatar: 'hash' };
    assert.equal(await refreshProfile(db, user, 1000), true);
    assert.deepEqual(db.calls[0], ['1', { username: 'Bob Smith', handle: 'bob_42', avatar: 'hash' }]);
    assert.equal(await refreshProfile(db, user, 1000 + REFRESH_MS - 1), false, 'throttled');
    assert.equal(await refreshProfile(db, user, 1000 + REFRESH_MS), true);
    assert.equal(db.calls.length, 2);
});

test('refreshProfile skips bots and users without a username, and a failed write is retried next time', async () => {
    const db = fakeDb();
    assert.equal(await refreshProfile(db, { id: '2', username: 'robot', bot: true }), false);
    assert.equal(await refreshProfile(db, { id: '3' }), false);
    assert.equal(await refreshProfile(db, null), false);
    const failing = { users: { ensureUser: async () => { throw new Error('db down'); } } };
    assert.equal(await refreshProfile(failing, { id: '4', username: 'eve' }, 5000), false);
    assert.equal(await refreshProfile(db, { id: '4', username: 'eve' }, 5001), true, 'not throttled after a failure');
});

test('/profile @someone with XP turned off shows nothing of their progress', async () => {
    const db = require('@taskquest/shared/db');
    const { profile } = require('../commands/gamification');
    const real = { getUserStats: db.users.getUserStats, getUserSkills: db.users.getUserSkills, ensureUser: db.users.ensureUser };
    db.users.getUserStats = async () => ({ user: { discord_id: '9', gamification_enabled: 0, player_xp: 5000, lifetime_xp: 9000, player_class: 'DEFAULT', player_level: 91 }, lists: { total: 3 }, items: { total: 9, completed: 4 }, achievements: 2 });
    db.users.getUserSkills = async () => [];
    db.users.ensureUser = async () => {};
    try {
        const sent = [];
        await profile({
            user: { id: '1' },
            options: { getUser: () => ({ id: '9', username: 'quiet' }) },
            deferReply: async () => {},
            editReply: async (p) => void sent.push(p)
        });
        const text = JSON.stringify(sent[0].embeds[0].toJSON());
        assert.match(text, /Profile is private/);
        assert.doesNotMatch(text, /5,?000|9,?000|Level 91/);
    } finally {
        Object.assign(db.users, real);
    }
});
