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
        XP_WEEKLY_MODIFIER: 'off',
        DB_HOST: process.env.TEST_DB_HOST || '127.0.0.1',
        DB_PORT: process.env.TEST_DB_PORT || '5432',
        DB_USER: process.env.TEST_DB_USER || 'postgres',
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
            getSubcommand: () => options.subcommand ?? null,
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
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
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


    // ─── Shared lists ─────────────────────────────────────────────────────────────

    await t.test('shared lists: /share, invitation DM, /invites, roles in /list, /members and /leave', async () => {
        const sharing = require('../commands/sharing');
        const P = { own: '300000000000000901', ed: '300000000000000902', vw: '300000000000000903', st: '300000000000000904', nodm: '300000000000000905' };
        for (const [k, id] of Object.entries(P)) await db.users.ensureUser(id, { username: `bot_${k}`, handle: `bot_${k}`, avatar: null });
        const { list: shared } = await db.tasks.createList(P.own, { name: 'Flat chores' });
        const { item } = await db.tasks.addItem(P.own, shared.id, { name: 'Take out bins' });
        const target = (id, username) => {
            const sent = [];
            return { id, username, bot: false, sent, send: async (payload) => sent.push(payload) };
        };

        // /share by the owner: the invitee gets a DM with Accept / Decline.
        const edUser = target(P.ed, 'bot_ed');
        const s1 = fake({ userId: P.own, commandName: 'share', options: { list: 'Flat chores', user: edUser, role: 'editor' } });
        await sharing.share(s1);
        assert.deepEqual(errors(s1), []);
        assert.match(text(s1.calls.at(-1)), /Invitation sent/);
        assert.equal(edUser.sent.length, 1);
        const dmButtons = edUser.sent[0].components[0].toJSON().components.map((c) => c.custom_id);
        assert.match(dmButtons[0], /^inv_accept_\d+$/);
        assert.match(dmButtons[1], /^inv_decline_\d+$/);
        assert.match(JSON.stringify(edUser.sent[0].embeds[0].toJSON()), /Flat chores/);
        assert.deepEqual(edUser.sent[0].allowedMentions, { parse: [] }, 'an invitation DM never pings anybody');

        // Names written by other people cannot add links, formatting or mentions to a DM sent in the bot's name.
        const hostile = JSON.parse(JSON.stringify(sharing.inviteEmbed({
            listName: '[Claim your prize](https://evil.example/login) @everyone <@123456789012345678>',
            ownerName: '**Boss** https://evil.example',
            invitedByName: '__Eve__ @here',
            role: 'viewer'
        }).toJSON())).description;
        assert.equal(/\]\(/.test(hostile), false, 'no masked link');
        assert.equal(/https?:\/\//.test(hostile), false, 'no clickable link');
        assert.equal(/@(everyone|here)|<@\d/.test(hostile), false, 'no mention');
        assert.match(hostile, /\\\*\\\*Boss\\\*\\\*/, 'markdown is escaped');

        // Closed DMs: the owner is told, and the invitation is still in /invites.
        const closed = { ...target(P.vw, 'bot_vw'), send: async () => { throw new Error('Cannot send messages to this user'); } };
        const s2 = fake({ userId: P.own, commandName: 'share', options: { list: 'Flat chores', user: closed } });
        await sharing.share(s2);
        assert.match(text(s2.calls.at(-1)), /DMs are closed[\s\S]*\/invites/);
        const inv = fake({ userId: P.vw, commandName: 'invites' });
        await sharing.invites(inv);
        const invView = inv.calls.at(-1).payload;
        assert.match(JSON.stringify(invView.embeds[0].toJSON()), /Flat chores[\s\S]*viewer/);
        assert.equal(invView.components.length, 1);

        // A stranger, an unknown person and a self-invite are refused with a friendly message; a bot account cannot be invited.
        const noList = fake({ userId: P.st, commandName: 'share', options: { list: 'Flat chores', user: target(P.ed, 'bot_ed') } });
        await sharing.share(noList);
        assert.match(text(noList.calls.at(-1)), /List not found/);
        const unknown = fake({ userId: P.own, commandName: 'share', options: { list: 'Flat chores', user: target('399999999999999999', 'ghost') } });
        await sharing.share(unknown);
        assert.match(text(unknown.calls.at(-1)), /If that person can be invited/);
        const self = fake({ userId: P.own, commandName: 'share', options: { list: 'Flat chores', user: target(P.own, 'bot_own') } });
        await sharing.share(self);
        assert.match(text(self.calls.at(-1)), /yourself/);
        const botUser = fake({ userId: P.own, commandName: 'share', options: { list: 'Flat chores', user: { ...target(P.st, 'robot'), bot: true } } });
        await sharing.share(botUser);
        assert.match(text(botUser.calls.at(-1)), /Bots cannot/);

        // Someone else cannot answer the invitation; the invitee can (from the DM, which has no interaction metadata).
        const edInvite = (await db.sharing.listInvites(P.ed))[0];
        const hijack = fake({ userId: P.st, customId: `inv_accept_${edInvite.id}`, message: { embeds: [] } });
        await sharing.handleInviteButton(hijack);
        assert.match(text(hijack.calls.at(-1)), /No longer open|Invitation not found/);
        assert.equal(await db.tasks.getList(P.st, shared.id), null);
        const accept = fake({ userId: P.ed, customId: `inv_accept_${edInvite.id}`, message: { embeds: [] } });
        await sharing.handleInviteButton(accept);
        assert.equal(accept.calls[0].type, 'update');
        assert.match(text(accept.calls[0]), /Joined/);
        const again = fake({ userId: P.ed, customId: `inv_accept_${edInvite.id}`, message: { embeds: [] } });
        await sharing.handleInviteButton(again);
        assert.match(text(again.calls.at(-1)), /no longer open/i, 'a stale button explains itself');
        // The viewer accepts from the /invites message, which re-renders.
        const vwInvite = (await db.sharing.listInvites(P.vw))[0];
        const accept2 = fake({ userId: P.vw, customId: `inv_accept_${vwInvite.id}`, message: { embeds: [{ title: '📨 Invitations' }] } });
        await sharing.handleInviteButton(accept2);
        assert.match(accept2.calls[0].payload.content, /Joined/);
        assert.match(text(accept2.calls[0]), /No invitations/);

        // /list shows the sharing marker and role; an editor edits, a viewer only reads.
        const ov = fake({ userId: P.ed, commandName: 'list' });
        await list.execute(ov);
        assert.match(text(ov.calls[0]), /Flat chores[\s\S]*👥[\s\S]*editor · by bot\\\\_own/);
        const editorView = fake({ userId: P.ed, commandName: 'list', options: { name: 'Flat chores' } });
        await list.execute(editorView);
        const rowIds = (call) => call.payload.components.flatMap((r) => r.toJSON().components.map((c) => c.custom_id));
        assert.ok(rowIds(editorView.calls[0]).includes(`edit_${shared.id}`));
        const editMode = fake({ userId: P.ed, customId: `edit_${shared.id}` });
        await list.handleButton(editMode);
        const editIds = rowIds(editMode.calls[0]);
        assert.ok(editIds.includes(`item_add_${shared.id}`));
        assert.ok(!editIds.includes(`list_meta_${shared.id}`) && !editIds.includes(`list_del_${shared.id}`), 'an editor has no list settings and no delete');
        const viewerView = fake({ userId: P.vw, commandName: 'list', options: { name: 'Flat chores' } });
        await list.execute(viewerView);
        assert.ok(!rowIds(viewerView.calls[0]).includes(`edit_${shared.id}`), 'a viewer gets no Edit button');
        assert.match(text(viewerView.calls[0]), /View only/);
        const forced = fake({ userId: P.vw, customId: `edit_${shared.id}` });
        await list.handleButton(forced);
        assert.equal(forced.calls[0].type, 'reply');
        assert.match(text(forced.calls[0]), /view access/);
        const addModal = fake({ userId: P.vw, customId: `item_add_${shared.id}` });
        await list.handleButton(addModal);
        assert.equal(addModal.calls[0].type, 'reply', 'no modal for a viewer');
        const toggle = fake({ userId: P.vw, customId: `sel_done_${shared.id}`, values: [String(item.id)] });
        await list.handleSelectMenu(toggle);
        assert.equal((await db.tasks.getItem(P.own, item.id)).completed, 0, 'the viewer changed nothing');
        assert.match(text(toggle.calls.at(-1)), /view access/);
        const submit = fake({ userId: P.vw, customId: `m_additem_${shared.id}`, fields: { name: 'sneaky' } });
        await list.handleModal(submit);
        assert.equal((await db.tasks.getItems(P.own, shared.id)).length, 1);
        // The editor completes a task: the XP and the item are theirs.
        const doneEd = fake({ userId: P.ed, customId: `sel_done_${shared.id}`, values: [String(item.id)] });
        await list.handleSelectMenu(doneEd);
        assert.deepEqual(errors(doneEd), []);
        assert.equal(Number((await db.users.getUser(P.ed)).total_items_completed), 1);
        assert.equal(Number((await db.users.getUser(P.own)).total_items_completed), 0);

        // The public-message guard still holds on a shared list: a stranger clicking the owner's message is turned away first.
        const mineMsg = { interaction: { user: { id: P.own } } };
        const stranger = fake({ userId: P.st, customId: `view_${shared.id}`, message: mineMsg });
        await list.handleButton(stranger);
        assert.deepEqual(stranger.calls.map((c) => c.type), ['reply']);
        assert.match(text(stranger.calls[0]), /isn't your list view/);
        const stranger2 = fake({ userId: P.st, customId: `sel_list`, values: [String(shared.id)] });
        await list.handleSelectMenu(stranger2);
        assert.match(text(stranger2.calls.at(-1)), /Not found/i, 'without the guard the service still says not found');

        // /members: names and roles, no IDs; only a manager gets the remove menu, and only the owner can remove a manager.
        const mem = fake({ userId: P.own, commandName: 'members', options: { list: 'Flat chores' } });
        await sharing.members(mem);
        const memText = text(mem.calls.at(-1));
        assert.match(memText, /bot\\\\_own[\s\S]*owner[\s\S]*bot\\\\_ed[\s\S]*editor[\s\S]*bot\\\\_vw[\s\S]*viewer/);
        assert.equal(/\d{15,}/.test(memText), false, 'no Discord ID is shown');
        const menu = mem.calls.at(-1).payload.components[0].toJSON().components[0];
        assert.equal(menu.custom_id, `mem_rm_${shared.id}`);
        assert.deepEqual(menu.options.map((o) => o.label).sort(), ['bot_ed', 'bot_vw']);
        const memEd = fake({ userId: P.ed, commandName: 'members', options: { list: 'Flat chores' } });
        await sharing.members(memEd);
        assert.deepEqual(memEd.calls.at(-1).payload.components, [], 'an editor cannot remove people');
        const strangerMembers = fake({ userId: P.st, commandName: 'members', options: { list: 'Flat chores' } });
        await sharing.members(strangerMembers);
        assert.match(text(strangerMembers.calls.at(-1)), /List not found/);
        const forgedRemove = fake({ userId: P.ed, customId: `mem_rm_${shared.id}`, values: [menu.options.find((o) => o.label === 'bot_vw').value] });
        await sharing.handleSelect(forgedRemove);
        assert.match(text(forgedRemove.calls.at(-1)), /manager/i, 'a forged select from an editor is refused by the service');
        assert.ok(await db.tasks.getList(P.vw, shared.id));
        const remove = fake({ userId: P.own, customId: `mem_rm_${shared.id}`, values: [menu.options.find((o) => o.label === 'bot_vw').value] });
        await sharing.handleSelect(remove);
        assert.equal(remove.calls[0].type, 'update');
        assert.equal(await db.tasks.getList(P.vw, shared.id), null, 'removed');
        const staleView = fake({ userId: P.vw, customId: `edit_${shared.id}` });
        await list.handleButton(staleView);
        assert.match(text(staleView.calls[0]), /Not found/i, 'a removed member\'s open message stops working');

        // /leave asks first, then the member is out; the owner cannot leave.
        const lv = fake({ userId: P.ed, commandName: 'leave', options: { list: 'Flat chores' } });
        await sharing.leave(lv);
        assert.match(text(lv.calls.at(-1)), /Leave this list/);
        const no = fake({ userId: P.ed, customId: 'leave_no' });
        await sharing.handleLeaveButton(no);
        assert.ok(await db.tasks.getList(P.ed, shared.id));
        const yes = fake({ userId: P.ed, customId: `leave_yes_${shared.id}` });
        await sharing.handleLeaveButton(yes);
        assert.equal(await db.tasks.getList(P.ed, shared.id), null);
        const ownerLeave = fake({ userId: P.own, commandName: 'leave', options: { list: 'Flat chores' } });
        await sharing.leave(ownerLeave);
        assert.match(text(ownerLeave.calls.at(-1)), /cannot leave/);

        // Autocomplete: /share offers only lists you manage.
        const { list: other } = await db.tasks.createList(P.st, { name: 'Flat chores 2' });
        await db.tasks.addItem(P.st, other.id, { name: 'x' });
        const inv3 = await db.sharing.invite(P.st, other.id, { discordId: P.ed, role: 'viewer' });
        await db.sharing.respond(P.ed, inv3.id, true);
        const ac = fake({ userId: P.ed, commandName: 'share', options: { focused: 'flat', focusedName: 'list' } });
        await sharing.autocomplete(ac);
        assert.deepEqual(ac.calls[0].payload, [], 'a viewer manages nothing');
        const ac2 = fake({ userId: P.ed, commandName: 'leave', options: { focused: 'flat', focusedName: 'list' } });
        await sharing.autocomplete(ac2);
        assert.deepEqual(ac2.calls[0].payload.map((o) => o.value), ['Flat chores 2']);
        void P.nodm;
    });


    await t.test('/party: create, invite DM, join, status, claim, leave and disband', async () => {
        const party = require('../commands/party');
        const P = { own: '300000000000000951', mem: '300000000000000952', out: '300000000000000953' };
        for (const [k, id] of Object.entries(P)) await db.users.ensureUser(id, { username: `pbot_${k}`, handle: `pbot_${k}`, avatar: null });
        const run = async (userId, subcommand, options = {}) => {
            const i = fake({ userId, commandName: 'party', options: { subcommand, ...options } });
            await party.execute(i);
            return i;
        };
        assert.match(text((await run(P.own, 'status')).calls.at(-1)), /No party yet/);
        assert.match(text((await run(P.own, 'invite', { user: { id: P.mem, username: 'pbot_mem', bot: false, send: async () => {} } })).calls.at(-1)), /not in a party/i);
        const created = await run(P.own, 'create', { name: 'Bot Crew' });
        assert.match(text(created.calls.at(-1)), /Party created/);
        assert.match(text((await run(P.own, 'create', { name: 'Two' })).calls.at(-1)), /already in a party/);

        const sent = [];
        const target = { id: P.mem, username: 'pbot_mem', bot: false, send: async (m) => sent.push(m) };
        const inv = await run(P.own, 'invite', { user: target });
        assert.match(text(inv.calls.at(-1)), /Invitation sent/);
        assert.equal(sent.length, 1);
        const ids = sent[0].components[0].toJSON().components.map((c) => c.custom_id);
        assert.match(ids[0], /^party_accept_\d+$/);
        const closed = await run(P.own, 'invite', { user: { id: P.out, username: 'pbot_out', bot: false, send: async () => { throw new Error('closed'); } } });
        assert.match(text(closed.calls.at(-1)), /DMs are closed[\s\S]*\/party invites/);
        assert.match(text((await run(P.own, 'invite', { user: { ...target, bot: true } })).calls.at(-1)), /Bots cannot/);

        // A stranger's click is refused; the invitee joins from the DM.
        const invite = (await db.parties.listInvites(P.mem))[0];
        const hijack = fake({ userId: P.out, customId: `party_accept_${invite.id}`, message: { embeds: [] } });
        await party.handleButton(hijack);
        assert.match(text(hijack.calls.at(-1)), /No longer open|Invitation not found/);
        const join = fake({ userId: P.mem, customId: `party_accept_${invite.id}`, message: { embeds: [] } });
        await party.handleButton(join);
        assert.match(text(join.calls[0]), /Joined the party/);
        assert.match(text((await run(P.mem, 'invite', { user: { id: P.out, username: 'pbot_out', bot: false, send: async () => {} } })).calls.at(-1)), /Only the owner/);
        // The out user sees the closed-DM invitation under /party invites and can decline it.
        const list = await run(P.out, 'invites');
        assert.match(text(list.calls.at(-1)), /Bot Crew/);
        const decline = fake({ userId: P.out, customId: `party_decline_${(await db.parties.listInvites(P.out))[0].id}`, message: { embeds: [{ title: '📨 Party invitations' }] } });
        await party.handleButton(decline);
        assert.match(decline.calls[0].payload.content, /declined/i);

        // Status: names and counts, no Discord IDs, no Claim button until the quest is done.
        const st = await run(P.mem, 'status');
        const body = text(st.calls.at(-1));
        assert.match(body, /pbot\\\\_own[\s\S]*pbot\\\\_mem/);
        assert.equal(/\d{15,}/.test(body), false);
        assert.deepEqual(st.calls.at(-1).payload.components, []);
        const early = fake({ userId: P.mem, customId: 'party_claim' });
        await party.handleButton(early);
        assert.match(text(early.calls.at(-1)), /isn't finished/);

        for (const who of [P.own, P.mem]) {
            const { list: l } = await db.tasks.createList(who, { name: `Party tasks ${who.slice(-2)}` });
            for (let n = 0; n < 12; n++) await db.tasks.setItemCompleted(who, (await db.tasks.addItem(who, l.id, { name: `t${n}` })).item.id);
        }
        const ready = await run(P.mem, 'status');
        const readyIds = ready.calls.at(-1).payload.components.flatMap((r) => r.toJSON().components.map((c) => c.custom_id));
        assert.deepEqual(readyIds, ['party_claim']);
        const claim = fake({ userId: P.mem, customId: 'party_claim' });
        await party.handleButton(claim);
        assert.deepEqual(errors(claim), []);
        assert.ok(claim.calls.some((c) => c.type === 'followUp' && /Party reward claimed/.test(text(c))));
        assert.equal((await db.query("SELECT COUNT(*) AS n FROM xp_transactions WHERE discord_id = ? AND source = 'party_quest'", [P.mem]))[0].n, 1);
        const twice = fake({ userId: P.mem, customId: 'party_claim' });
        await party.handleButton(twice);
        assert.match(text(twice.calls.at(-1)), /already claimed/);

        // Removing a member: the owner only, never themselves; the removed person is out and can be invited again.
        const memTarget = { id: P.mem, username: 'pbot_mem', displayName: 'pbot_mem', bot: false };
        assert.match(text((await run(P.mem, 'kick', { user: { id: P.own, username: 'pbot_own', bot: false } })).calls.at(-1)), /Only the owner/);
        assert.match(text((await run(P.own, 'kick', { user: { id: P.own, username: 'pbot_own', displayName: 'pbot_own', bot: false } })).calls.at(-1)), /Disband/);
        assert.match(text((await run(P.own, 'kick', { user: { id: P.out, username: 'pbot_out', bot: false } })).calls.at(-1)), /Member not found/);
        assert.match(text((await run(P.own, 'kick', { user: memTarget })).calls.at(-1)), /Member removed/);
        assert.equal(await db.parties.status(P.mem), null);
        await db.parties.respond(P.mem, (await db.parties.invite(P.own, { discordId: P.mem })).id, true);

        // Leave and disband (the owner cannot leave; the disband asks first).
        assert.match(text((await run(P.own, 'leave')).calls.at(-1)), /Disband/);
        assert.match(text((await run(P.mem, 'leave')).calls.at(-1)), /Left the party/);
        const ask = await run(P.own, 'disband');
        assert.match(text(ask.calls.at(-1)), /Disband the party/);
        const keep = fake({ userId: P.own, customId: 'party_disband_no' });
        await party.handleButton(keep);
        assert.ok(await db.parties.status(P.own));
        const yes = fake({ userId: P.own, customId: 'party_disband_yes' });
        await party.handleButton(yes);
        assert.equal(await db.parties.status(P.own), null);
        const notOwner = fake({ userId: P.mem, customId: 'party_disband_yes' });
        await party.handleButton(notOwner);
        assert.match(text(notOwner.calls.at(-1)), /not in a party/i);
    });

    await db.closePool();
});
