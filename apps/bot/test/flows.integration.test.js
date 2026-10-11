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
function fake({ userId = USER, customId, commandName, values, fields = {}, options = {}, message } = {}) {
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
        message,
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
            getInteger: (k) => options[k] ?? null,
            getFocused: () => ({ name: options.focusedName ?? 'name', value: options.focused ?? '' })
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

    await t.test('/list buttons on a different user public message are rejected', async () => {
        const mine = { interaction: { user: { id: USER } } };
        const clicker = fake({ userId: OTHER, customId: 'sort_az', message: mine });
        await list.handleButton(clicker);
        assert.deepEqual(clicker.calls.map((c) => c.type), ['reply'], 'must not update the shared message');
        assert.match(text(clicker.calls[0]), /isn't your list view/);
        const sel = fake({ userId: OTHER, customId: 'sel_list', values: [String(listId)], message: mine });
        await list.handleSelectMenu(sel);
        assert.deepEqual(sel.calls.map((c) => c.type), ['reply']);

        const owner = fake({ customId: 'sort_az', message: mine });
        await list.handleButton(owner);
        assert.equal(owner.calls[0].type, 'update');
    });

    await t.test('/list Details: picker, modal, validation, ownership and completion bonuses', async () => {
        const DET = '300000000000000004';
        await db.users.ensureUser(DET);
        const created = (await db.tasks.createList(DET, { name: 'Details' })).list;
        const parent = (await db.tasks.addItem(DET, created.id, { name: 'Parent' })).item;
        const child = (await db.tasks.addItem(DET, created.id, { name: 'Child', parent_id: parent.id })).item;

        const picker = fake({ userId: DET, customId: `item_details_${created.id}` });
        await list.handleButton(picker);
        assert.equal(picker.calls[0].type, 'reply');
        assert.equal(picker.calls[0].payload.components[0].toJSON().components[0].custom_id, `sel_details_${created.id}`);

        const pick = fake({ userId: DET, customId: `sel_details_${created.id}`, values: [String(child.id)] });
        await list.handleSelectMenu(pick);
        assert.equal(pick.calls[0].type, 'showModal');

        const stranger = fake({ userId: OTHER, customId: `sel_details_${created.id}`, values: [String(child.id)] });
        await list.handleSelectMenu(stranger);
        assert.notEqual(stranger.calls[0].type, 'showModal', 'another user cannot open the modal');

        const save = fake({ userId: DET, customId: `m_details_${child.id}`, fields: { due: '2031-04-02', priority: 'high', tags: '#home, Bills', repeat: 'weekly' } });
        await list.handleModal(save);
        assert.deepEqual(errors(save), []);
        const stored = await db.tasks.getItem(DET, child.id);
        assert.equal(String(stored.due_date).slice(0, 10), '2031-04-02');
        assert.equal(stored.priority, 'HIGH');
        assert.equal(stored.tags, 'home,bills');
        assert.equal(stored.recurrence, 'weekly');

        const view = fake({ userId: DET, customId: `edit_${created.id}` });
        await list.handleButton(view);
        const desc = view.calls[0].payload.embeds[0].toJSON().description;
        assert.match(desc, /↳ ⬜ Child/);
        assert.match(desc, /Apr 2, 2031/);
        assert.match(desc, /#home #bills/);

        const bad = fake({ userId: DET, customId: `m_details_${child.id}`, fields: { due: '2031-02-30', priority: '', tags: '', repeat: '' } });
        await list.handleModal(bad);
        assert.match(text(bad.calls[0]), /real calendar date/);
        const badTags = fake({ userId: DET, customId: `m_details_${child.id}`, fields: { due: '', priority: '', tags: 'a b c d e f', repeat: '' } });
        await list.handleModal(badTags);
        assert.match(text(badTags.calls[0]), /at most 5 tags/);
        assert.equal((await db.tasks.getItem(DET, child.id)).priority, 'HIGH', 'a rejected save changes nothing');

        const theft = fake({ userId: OTHER, customId: `m_details_${child.id}`, fields: { due: '2031-05-05', priority: 'low', tags: '', repeat: '' } });
        await list.handleModal(theft);
        assert.match(text(theft.calls[0]), /Not found/i);
        assert.equal(String((await db.tasks.getItem(DET, child.id)).due_date).slice(0, 10), '2031-04-02');

        const clear = fake({ userId: DET, customId: `m_details_${child.id}`, fields: { due: '', priority: '', tags: '', repeat: 'none' } });
        await list.handleModal(clear);
        const cleared = await db.tasks.getItem(DET, child.id);
        assert.deepEqual([cleared.due_date, cleared.priority, cleared.tags, cleared.recurrence], [null, null, null, null]);

        const done = fake({ userId: DET, customId: `sel_done_${created.id}`, values: [String(parent.id)] });
        await list.handleSelectMenu(done);
        assert.deepEqual(errors(done), []);
        assert.match(text(done.calls.find((c) => c.type === 'editReply')), /Completed/);
    });

    await t.test('/review claims once and /prestige needs the second confirmation', async () => {
        const REV = '300000000000000005';
        await db.users.ensureUser(REV);
        const reviewCmd = require('../commands/review');
        const prestigeCmd = require('../commands/prestige');
        const buttons = (call) => (call.payload.components || []).flatMap((r) => r.toJSON().components.map((c) => c.custom_id));

        const empty = fake({ userId: REV, commandName: 'review' });
        await reviewCmd.execute(empty);
        assert.deepEqual(errors(empty), []);
        assert.deepEqual(buttons(empty.calls.at(-1)), [], 'nothing finished yet: no claim button');

        const made = (await db.tasks.createList(REV, { name: 'Review week' })).list;
        const task = (await db.tasks.addItem(REV, made.id, { name: 'Do it' })).item;
        await db.tasks.setItemCompleted(REV, task.id, true);
        const ready = fake({ userId: REV, commandName: 'review' });
        await reviewCmd.execute(ready);
        assert.deepEqual(buttons(ready.calls.at(-1)), ['review_claim']);

        const claim = fake({ userId: REV, customId: 'review_claim' });
        await reviewCmd.handleButton(claim);
        assert.deepEqual(errors(claim), []);
        assert.ok(claim.calls.some((c) => c.type === 'followUp' && /Review claimed/.test(text(c))));
        const again = fake({ userId: REV, customId: 'review_claim' });
        await reviewCmd.handleButton(again);
        assert.match(text(again.calls.at(-1)), /already claimed/i, 'a second click pays nothing');

        // Prestige: not eligible below level 30, and a stale confirm click does nothing.
        const low = fake({ userId: REV, commandName: 'prestige' });
        await prestigeCmd.execute(low);
        assert.deepEqual(buttons(low.calls.at(-1)), []);
        const stale = fake({ userId: REV, customId: 'prestige_confirm' });
        await prestigeCmd.handleButton(stale);
        assert.match(text(stale.calls.at(-1)), /Reach level 30/);
        assert.equal((await db.users.getUser(REV)).prestige, 0);

        await pool.query('UPDATE users SET player_level = 30, player_class = ?, player_xp = 500 WHERE discord_id = ?', ['DEFAULT', REV]);
        const ask = fake({ userId: REV, commandName: 'prestige' });
        await prestigeCmd.execute(ask);
        assert.deepEqual(buttons(ask.calls.at(-1)), ['prestige_ask']);
        const warn = fake({ userId: REV, customId: 'prestige_ask' });
        await prestigeCmd.handleButton(warn);
        assert.deepEqual(buttons(warn.calls.at(-1)), ['prestige_confirm', 'prestige_cancel']);
        assert.equal((await db.users.getUser(REV)).prestige, 0, 'asking changes nothing');
        const cancel = fake({ userId: REV, customId: 'prestige_cancel' });
        await prestigeCmd.handleButton(cancel);
        assert.equal((await db.users.getUser(REV)).prestige, 0, 'cancel changes nothing');

        const yes = fake({ userId: REV, customId: 'prestige_confirm' });
        await prestigeCmd.handleButton(yes);
        assert.deepEqual(errors(yes), []);
        const after = await db.users.getUser(REV);
        assert.equal(after.prestige, 1);
        assert.equal(after.player_level, 1);
        assert.match(text(yes.calls.find((c) => c.type === 'editReply')), /Veteran/);
    });

    await t.test('/list menus page past 25 lists', async () => {
        const PAGER = '300000000000000003';
        await db.users.ensureUser(PAGER);
        for (let n = 1; n <= 30; n++) await db.tasks.createList(PAGER, { name: `L${String(n).padStart(2, '0')}` });
        const overview = fake({ userId: PAGER, commandName: 'list' });
        await list.execute(overview);
        const menu = overview.calls[0].payload.components.map((c) => c.toJSON()).find((c) => c.components[0].custom_id === 'sel_list').components[0];
        const menuOf = (call) => call.payload.components.map((c) => c.toJSON()).find((c) => c.components[0].custom_id === 'sel_list').components[0];
        const labels = new Set();
        let current = menu;
        for (let guard = 0; guard < 5; guard++) {
            assert.ok(current.options.length <= 25);
            for (const o of current.options) if (!o.value.startsWith('__page_')) labels.add(o.label);
            const more = current.options.find((o) => o.label.includes('More'));
            if (!more) break;
            const next = fake({ userId: PAGER, customId: 'sel_list', values: [more.value] });
            await list.handleSelectMenu(next);
            assert.equal(next.calls[0].type, 'update');
            current = menuOf(next.calls[0]);
        }
        assert.equal(labels.size, 30, 'every list reachable through the pages');
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
        const [[before]] = await pool.query("SELECT COALESCE(SUM(amount), 0) AS n FROM xp_transactions WHERE discord_id = ? AND source = 'achievement_reward'", [USER]);
        const rewards0 = Number(before.n);
        await gam.classShop(fake());
        for (const id of ['class_next', 'cbuy_HERO', 'class_skills', 'skill_unlock_hero_valor', 'skill_unlock_tank_fortify', 'ceq_DEFAULT', 'class_return_default']) {
            const i = fake({ customId: id });
            await gam.handleClassButton(i);
            assert.deepEqual(errors(i), [], id);
        }
        const user = await db.users.getUser(USER);
        assert.equal(user.owns_hero, 1);
        const [[paid]] = await pool.query("SELECT COALESCE(SUM(amount), 0) AS n FROM xp_transactions WHERE discord_id = ? AND source = 'achievement_reward'", [USER]);
        assert.equal(Number(user.player_xp), 2000 - 500 - 100 + Number(paid.n) - rewards0, 'prices spent, plus achievement rewards');
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

    await t.test('/quick, /quests, /freeze, /timezone and /weekly', async () => {
        const quick = require('../commands/quick');
        const quests = require('../commands/quests');
        const timezone = require('../commands/timezone');
        const weekly = require('../commands/weekly');

        const { list: target } = await db.tasks.createList(USER, { name: 'Quick list' });
        const q = fake({ commandName: 'quick', options: { text: 'Send invoice fri !high #work every week', list: 'Quick list' } });
        await quick.execute(q);
        assert.deepEqual(errors(q), []);
        const [added] = (await db.tasks.getItems(USER, target.id)).filter((i) => i.name === 'Send invoice');
        assert.ok(added, 'the name had its tokens stripped');
        assert.equal(added.priority, 'HIGH');
        assert.equal(added.tags, 'work');
        assert.equal(added.recurrence, 'weekly');
        assert.ok(added.due_date);

        const missing = fake({ commandName: 'quick', options: { text: 'x', list: 'Nope' } });
        await quick.execute(missing);
        assert.match(text(missing.calls.at(-1)), /List not found/);
        const empty = fake({ commandName: 'quick', options: { text: '!high tomorrow', list: 'Quick list' } });
        await quick.execute(empty);
        assert.match(text(empty.calls.at(-1)), /Nothing to add/);
        const ac = fake({ commandName: 'quick', options: { focusedName: 'list', focused: 'quick' } });
        await quick.autocomplete(ac);
        assert.deepEqual(ac.calls.at(-1).payload, [{ name: 'Quick list', value: 'Quick list' }]);

        const view = fake({ commandName: 'quests' });
        await quests.execute(view);
        assert.deepEqual(errors(view), []);
        assert.match(text(view.calls.at(-1)), /Daily Grind/);
        const noClaim = fake({ customId: 'quest_claim_WEEKLY_COMPLETE_15' });
        await quests.handleButton(noClaim);
        assert.match(text(noClaim.calls.at(-1)), /isn't finished/);

        const poor = fake({ commandName: 'freeze' });
        await pool.query('UPDATE users SET player_xp = 0 WHERE discord_id = ?', [USER]);
        await gam.freeze(poor);
        assert.match(text(poor.calls.at(-1)), /Not enough XP|INSUFFICIENT|need/i);
        await pool.query('UPDATE users SET player_xp = 500 WHERE discord_id = ?', [USER]);
        const buy = fake({ commandName: 'freeze' });
        await gam.freeze(buy);
        assert.deepEqual(errors(buy), []);
        assert.equal(Number((await db.users.getUser(USER)).streak_freezes), 1);

        const tz = fake({ commandName: 'timezone', options: { zone: 'Asia/Manila', hour: 7 } });
        await timezone.execute(tz);
        assert.deepEqual(errors(tz), []);
        const saved = await db.users.getUser(USER);
        assert.equal(saved.timezone, 'Asia/Manila');
        assert.equal(saved.reminder_hour, 7);
        const badTz = fake({ commandName: 'timezone', options: { zone: 'Mars/Base' } });
        await timezone.execute(badTz);
        assert.match(text(badTz.calls.at(-1)), /Unknown time zone/);
        assert.equal((await db.users.getUser(USER)).timezone, 'Asia/Manila', 'a bad zone changes nothing');
        const quick2 = fake({ commandName: 'timezone', options: { zone: 'Europe/Paris' } });
        await timezone.execute(quick2);
        assert.match(text(quick2.calls.at(-1)), /once every 24 hours/);
        assert.equal((await db.users.getUser(USER)).timezone, 'Asia/Manila', 'a second change within a day is refused');

        const on = fake({ commandName: 'weekly' });
        await weekly.execute(on);
        assert.match(text(on.calls.at(-1)), /Weekly digest on/);
        const off = fake({ commandName: 'weekly' });
        await weekly.execute(off);
        assert.match(text(off.calls.at(-1)), /Weekly digest off/);

        const board = fake({ commandName: 'leaderboard', options: { by: 'weekly' } });
        await gam.leaderboard(board);
        assert.deepEqual(errors(board), []);
    });

    await db.closePool();
});
