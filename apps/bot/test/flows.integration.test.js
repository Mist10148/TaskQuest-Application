/**
 * Drives the bot's command handlers with fake interactions against a real
 * database. Skipped unless TEST_DB_NAME is set (the database is wiped):
 *
 *   TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=3307 TEST_DB_NAME=tq_test npm test -w @taskquest/bot
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const enabled = Boolean(process.env.TEST_DB_NAME);
if (enabled) {
    Object.assign(process.env, {
        DB_URL: '',
        DB_HOST: process.env.TEST_DB_HOST || '127.0.0.1',
        DB_PORT: process.env.TEST_DB_PORT || '3306',
        DB_USER: process.env.TEST_DB_USER || 'root',
        DB_PASSWORD: process.env.TEST_DB_PASSWORD || '',
        DB_NAME: process.env.TEST_DB_NAME
    });
}

const USER = '300000000000000001';
const OTHER = '300000000000000002';

/** Minimal stand-in for a discord.js interaction that records every response. */
function fake({ userId = USER, customId, commandName, values, fields = {}, options = {} } = {}) {
    const calls = [];
    const record = (type) => async (payload) => {
        calls.push({ type, payload });
        // Serialise builders like discord.js would, surfacing validation errors.
        for (const e of payload?.embeds || []) if (e.toJSON) e.toJSON();
        for (const c of payload?.components || []) if (c.toJSON) c.toJSON();
        if (type === 'reply') i.replied = true;
        if (type === 'deferReply' || type === 'deferUpdate') i.deferred = true;
        if (type === 'showModal' && payload.toJSON) payload.toJSON();
    };
    const i = {
        user: { id: userId, username: `u${userId.slice(-2)}`, displayName: 'Tester', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' },
        customId,
        commandName,
        values,
        replied: false,
        deferred: false,
        guild: null,
        client: { users: { cache: new Map(), fetch: async () => null }, ws: { ping: 5 } },
        fields: { getTextInputValue: (k) => (k in fields ? fields[k] : '') },
        options: {
            getString: (k) => options[k] ?? null,
            getUser: (k) => options[k] ?? null,
            getFocused: () => ({ name: 'name', value: options.focused ?? '' })
        },
        reply: record('reply'),
        update: record('update'),
        editReply: record('editReply'),
        followUp: record('followUp'),
        deferReply: record('deferReply'),
        deferUpdate: record('deferUpdate'),
        showModal: record('showModal'),
        respond: record('respond'),
        calls
    };
    return i;
}

const text = (call) => JSON.stringify(call.payload?.embeds?.map((e) => (e.toJSON ? e.toJSON() : e)) || call.payload);
const errors = (i) => i.calls.filter((c) => /Something went wrong|An error occurred/.test(text(c)));

test('bot flows', { skip: !enabled && 'set TEST_DB_NAME to run' }, async (t) => {
    const db = require('@taskquest/shared/db');
    const pool = db.getPool();
    const [tables] = await pool.query('SHOW TABLES');
    await pool.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const row of tables) await pool.query(`DROP TABLE \`${Object.values(row)[0]}\``);
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');
    await db.runMigrations({ log: () => {} });

    const list = require('../commands/list');
    const game = require('../commands/game');
    const gam = require('../commands/gamification');

    let listId;
    await t.test('/list create, add task, complete once', async () => {
        const create = fake({ customId: 'm_newlist', fields: { name: 'Homework 📚', desc: '', deadline: '2030-05-01' } });
        await list.handleModal(create);
        assert.deepEqual(errors(create), []);
        listId = (await db.tasks.getListByName(USER, 'Homework 📚')).id;
        assert.ok(create.calls.some((c) => c.type === 'followUp'), 'XP follow-up sent');

        const bad = fake({ customId: 'm_newlist', fields: { name: 'x', deadline: '2024-13-45' } });
        await list.handleModal(bad);
        assert.match(text(bad.calls[0]), /real calendar date|YYYY-MM-DD/);

        const add = fake({ customId: `m_additem_${listId}`, fields: { name: 'Essay', desc: '' } });
        await list.handleModal(add);
        assert.deepEqual(errors(add), []);
        const [item] = await db.tasks.getItems(USER, listId);

        const done = fake({ customId: `sel_done_${listId}`, values: [String(item.id)] });
        await list.handleSelectMenu(done);
        assert.deepEqual(errors(done), []);

        const overview = fake({ commandName: 'list' });
        await list.execute(overview);
        const view = fake({ customId: `edit_${listId}` });
        await list.handleButton(view);
        assert.equal(view.calls[0].type, 'update');
        const meta = fake({ customId: `rename_${listId}` });
        await list.handleButton(meta);
        assert.equal(meta.calls[0].type, 'showModal');
        const auto = fake({ options: { focused: 'home' } });
        await list.autocomplete(auto);
        assert.equal(auto.calls[0].payload.length, 1);
    });

    await t.test('other users cannot touch the list via buttons', async () => {
        const intruder = fake({ userId: OTHER, customId: `item_done_${listId}` });
        await list.handleButton(intruder);
        assert.match(text(intruder.calls[0]), /not yours|Not found/i);
        const [item] = await db.tasks.getItems(USER, listId);
        const sel = fake({ userId: OTHER, customId: `sel_del_${listId}`, values: [String(item.id)] });
        await list.handleSelectMenu(sel);
        assert.ok(await db.tasks.getItem(USER, item.id), 'item still exists');
        const add = fake({ userId: OTHER, customId: `m_additem_${listId}`, fields: { name: 'spam' } });
        await list.handleModal(add);
        assert.equal((await db.tasks.getItems(USER, listId)).length, 1);
    });

    await t.test('/daily, /profile, /achievements, /leaderboard', async () => {
        for (const [fn, extra] of [
            [gam.daily, {}],
            [gam.daily, {}],
            [gam.profile, {}],
            [gam.profile, { options: { user: { id: OTHER, username: 'nobody', displayAvatarURL: () => null } } }],
            [gam.achievements, {}],
            [gam.leaderboard, {}],
            [gam.help, {}],
            [gam.app, {}],
            [gam.toggle, {}],
            [gam.toggle, {}],
            [gam.automation, {}]
        ]) {
            const i = fake(extra);
            await fn(i);
            assert.deepEqual(errors(i), [], fn.name);
        }
        assert.equal(await db.users.getUser(OTHER), null, '/profile @other must not create rows');
    });

    await t.test('/class buy, equip and skill unlock', async () => {
        await pool.query('UPDATE users SET player_xp = 2000 WHERE discord_id = ?', [USER]);
        await gam.classShop(fake());
        for (const id of ['class_next', 'cbuy_HERO', 'class_skills', 'skill_unlock_hero_valor', 'skill_unlock_tank_fortify', 'ceq_DEFAULT', 'class_return_default']) {
            const i = fake({ customId: id });
            await gam.handleClassButton(i);
            assert.deepEqual(errors(i), [], id);
        }
        const user = await db.users.getUser(USER);
        assert.equal(user.owns_hero, 1);
        assert.equal(Number(user.player_xp), 2000 - 500 - 100);
        const sel = fake({ customId: 'skill_select', values: ['hero_inspire'] });
        await gam.handleSkillSelect(sel);
        assert.deepEqual(errors(sel), []);
    });

    await t.test('/game blackjack, rps and hangman', async () => {
        await game.execute(fake({ commandName: 'game' }));
        const menu = fake({ customId: 'game_select', values: ['blackjack'] });
        await game.handleSelectMenu(menu);
        assert.deepEqual(errors(menu), []);

        let bet = fake({ customId: 'bj_bet_50' });
        await game.handleButton(bet);
        assert.deepEqual(errors(bet), []);
        if (await db.games.getActiveBlackjack(USER)) {
            const stand = fake({ customId: 'bj_stand' });
            await game.handleButton(stand);
            assert.deepEqual(errors(stand), []);
            const again = fake({ customId: 'bj_stand' });
            await game.handleButton(again);
            assert.match(text(again.calls.at(-1)), /No active blackjack/);
        }

        const modal = fake({ customId: 'bj_bet_modal', fields: { bet_amount: 'abc' } });
        await game.handleModal(modal);
        assert.match(text(modal.calls.at(-1)), /Invalid input|positive whole number/);

        await pool.query('UPDATE users SET last_game_at = NULL WHERE discord_id = ?', [USER]);
        const rps = fake({ customId: 'rps_rock' });
        await game.handleButton(rps);
        assert.deepEqual(errors(rps), []);

        await pool.query('UPDATE users SET last_game_at = NULL WHERE discord_id = ?', [USER]);
        const hm = fake({ customId: 'game_select', values: ['hangman'] });
        await game.handleSelectMenu(hm);
        assert.deepEqual(errors(hm), []);
        const rows = hm.calls.at(-1).payload.components.map((c) => c.toJSON());
        const letters = rows.flatMap((r) => r.components.flatMap((c) => (c.options || []).map((o) => o.value)));
        assert.equal(letters.length, 26, 'all letters including Z are selectable');

        for (const l of 'ETAOINSHRDLUCMFWYPVBGKQJXZ') {
            const g = fake({ customId: 'hm_letter_select_a', values: [`letter_${l}`] });
            await game.handleHangmanSelect(g);
            assert.deepEqual(errors(g), []);
            if (!(await db.games.getActiveHangman(USER))) break;
        }
    });

    await db.closePool();
});
