/**
 * Database integration tests. Skipped unless TEST_DB_NAME is set, e.g.
 *
 *   TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=3307 TEST_DB_NAME=tq_test npm test -w @taskquest/shared
 *
 * WARNING: the target database is wiped. Never point this at real data.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const enabled = Boolean(process.env.TEST_DB_NAME);

if (enabled) {
    process.env.DB_URL = '';
    process.env.DB_HOST = process.env.TEST_DB_HOST || '127.0.0.1';
    process.env.DB_PORT = process.env.TEST_DB_PORT || '3306';
    process.env.DB_USER = process.env.TEST_DB_USER || 'root';
    process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || '';
    process.env.DB_NAME = process.env.TEST_DB_NAME;
}

const db = enabled ? require('../src/db') : null;

const ALICE = '100000000000000001';
const BOB = '100000000000000002';
const CAROL = '100000000000000003';

async function setXP(id, xp) {
    await db.query('UPDATE users SET player_xp = ?, lifetime_xp = GREATEST(lifetime_xp, ?) WHERE discord_id = ?', [xp, xp, id]);
}

test('database services', { skip: !enabled && 'set TEST_DB_NAME to run' }, async (t) => {
    const pool = db.getPool();
    const [tables] = await pool.query('SHOW TABLES');
    await pool.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const row of tables) await pool.query(`DROP TABLE \`${Object.values(row)[0]}\``);
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');
    await db.runMigrations({ log: () => {} });
    await db.assertSchemaCurrent();
    await db.users.ensureUser(ALICE, { username: 'alice', avatar: null });
    await db.users.ensureUser(BOB);

    await t.test('migrations 007-011 are idempotent and add the new columns', async () => {
        await pool.query("DELETE FROM schema_migrations WHERE id >= '007'"); // pretend they were interrupted
        const again = await db.runMigrations({ log: () => {} });
        assert.deepEqual(again.filter((id) => id >= '007'), ['007_item_fields', '008_user_prefs', '009_quest_claims', '010_quest_integrity', '011_class_rework']);
        const cols = async (table) => (await pool.query(`SHOW COLUMNS FROM ${table}`))[0].map((c) => c.Field);
        const items = await cols('items');
        for (const c of ['due_date', 'priority', 'tags', 'parent_id', 'recurrence']) assert.ok(items.includes(c), `items.${c}`);
        const users = await cols('users');
        for (const c of ['timezone', 'reminder_hour', 'weekly_digest', 'last_digest_at', 'calendar_token', 'streak_freezes', 'xp_spent']) {
            assert.ok(users.includes(c), `users.${c}`);
        }
        assert.ok((await cols('lists')).includes('remind_at'));
        assert.equal((await pool.query("SHOW TABLES LIKE 'quest_claims'"))[0].length, 1);
        for (const c of ['first_completed_at', 'counts_for_quests', 'first_completed_high', 'repeat_anchor_day']) assert.ok(items.includes(c), `items.${c}`);
        assert.ok(users.includes('assassin_last_at'));
    });

    await t.test('lists, items and ownership', async () => {
        const { list, xp } = await db.tasks.createList(ALICE, { name: 'Groceries 🛒', priority: 'high' });
        assert.equal(list.priority, 'HIGH');
        assert.ok(xp.finalXP >= 10);
        await assert.rejects(db.tasks.createList(ALICE, { name: 'Groceries 🛒' }), { code: 'CONFLICT' });
        await assert.rejects(db.tasks.createList(ALICE, { name: 'x', deadline: '2024-02-30' }), { code: 'VALIDATION' });

        const { item } = await db.tasks.addItem(ALICE, list.id, { name: 'Milk' });
        await assert.rejects(db.tasks.addItem(BOB, list.id, { name: 'Hack' }), { code: 'NOT_FOUND' });
        await assert.rejects(db.tasks.setItemCompleted(BOB, item.id), { code: 'NOT_FOUND' });
        await assert.rejects(db.tasks.updateItem(BOB, item.id, { name: 'pwned' }), { code: 'NOT_FOUND' });
        await assert.rejects(db.tasks.deleteItem(BOB, item.id), { code: 'NOT_FOUND' });
        assert.equal(await db.tasks.getItems(BOB, list.id), null);
        assert.equal(await db.tasks.getItem(BOB, item.id), null);

        const first = await db.tasks.setItemCompleted(ALICE, item.id);
        assert.equal(first.completed, true);
        assert.ok(first.xp.finalXP > 0);
        const undo = await db.tasks.setItemCompleted(ALICE, item.id);
        assert.equal(undo.completed, false);
        const again = await db.tasks.setItemCompleted(ALICE, item.id);
        assert.equal(again.xp, null, 'completion XP must only be paid once');

        const user = await db.users.getUser(ALICE);
        assert.equal(user.total_items_completed, 1);
        const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM achievements WHERE discord_id = ?', [ALICE]);
        assert.ok(n >= 3);

        const found = await db.tasks.searchLists(ALICE, '%');
        assert.equal(found.length, 0, 'LIKE wildcards are escaped');
        const lists = await db.tasks.getLists(ALICE, { sortBy: 'priority', order: 'DESC' });
        assert.equal(lists[0].items_total, 1);
    });

    await t.test('completion XP is capped per day', async () => {
        await db.users.ensureUser(CAROL);
        const { list } = await db.tasks.createList(CAROL, { name: 'Farm' });
        const cap = 3;
        // Pretend the cap was nearly reached by seeding today's completion payouts.
        await pool.query(
            `INSERT INTO xp_transactions (discord_id, amount, source, balance_before, balance_after)
             SELECT ?, 10, 'item_complete', 0, 0 FROM (SELECT 1 FROM information_schema.TABLES LIMIT ${cap}) t`,
            [CAROL]
        );
        const limit = require('../src/constants').LIMITS.ITEM_COMPLETE_REWARDS_PER_DAY;
        await pool.query(
            `INSERT INTO xp_transactions (discord_id, amount, source, balance_before, balance_after)
             SELECT ?, 10, 'item_complete', 0, 0 FROM information_schema.COLUMNS LIMIT ${limit - cap}`,
            [CAROL]
        );
        const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM xp_transactions WHERE discord_id = ? AND source = 'item_complete'", [CAROL]);
        assert.equal(Number(n), limit);

        const { item } = await db.tasks.addItem(CAROL, list.id, { name: 'one more' });
        const done = await db.tasks.setItemCompleted(CAROL, item.id);
        assert.equal(done.completed, true);
        assert.equal(done.xp.capped, true);
        assert.equal(done.xp.finalXP, 0);
        const redo = await db.tasks.setItemCompleted(CAROL, item.id, false);
        const again = await db.tasks.setItemCompleted(CAROL, item.id, true);
        assert.equal(redo.completed, false);
        assert.equal(again.xp, null, 'a capped completion cannot be re-earned later');
    });

    await t.test('reordering keeps positions unique and contiguous', async () => {
        const { list } = await db.tasks.createList(CAROL, { name: 'Order me' });
        const ids = [];
        for (const name of ['a', 'b', 'c', 'd']) ids.push((await db.tasks.addItem(CAROL, list.id, { name })).item.id);
        const order = async () => (await db.tasks.getItems(CAROL, list.id)).map((i) => i.name).join('');
        const positions = async () => (await db.tasks.getItems(CAROL, list.id)).map((i) => i.position);

        await db.tasks.updateItem(CAROL, ids[3], { position: 0 });
        assert.equal(await order(), 'dabc');
        assert.deepEqual(await positions(), [0, 1, 2, 3]);
        await db.tasks.updateItem(CAROL, ids[3], { position: 99 }); // clamped to the end
        assert.equal(await order(), 'abcd');

        await db.tasks.reorderItems(CAROL, list.id, [ids[2], ids[0], ids[3], ids[1]]);
        assert.equal(await order(), 'cadb');
        await assert.rejects(db.tasks.reorderItems(CAROL, list.id, [ids[0], ids[1]]), { code: 'VALIDATION' });
        await assert.rejects(db.tasks.reorderItems(CAROL, list.id, [ids[0], ids[0], ids[1], ids[2]]), { code: 'VALIDATION' });
        await assert.rejects(db.tasks.reorderItems(BOB, list.id, ids), { code: 'NOT_FOUND' });
        await assert.rejects(db.tasks.moveItem(BOB, ids[0], 0), { code: 'NOT_FOUND' });

        // Legacy lists may hold duplicate positions; a swap must still swap.
        await db.getPool().query('UPDATE items SET position = 0 WHERE list_id = ?', [list.id]);
        await db.tasks.swapItemPositions(CAROL, ids[0], ids[1]);
        const [first, second] = (await db.tasks.getItems(CAROL, list.id)).map((i) => i.id);
        assert.ok(first !== undefined && second !== undefined);
        assert.deepEqual(await positions(), [0, 1, 2, 3]);
    });

    await t.test('reminder candidates, snooze and re-arming', async () => {
        const FRANK = '100000000000000006';
        await db.users.ensureUser(FRANK);
        await db.users.updateSettings(FRANK, { timezone: 'Asia/Manila', reminder_hour: 7 });
        const u = await db.users.getUser(FRANK);
        assert.equal(u.timezone, 'Asia/Manila');
        assert.equal(u.reminder_hour, 7);
        await assert.rejects(db.users.updateSettings(FRANK, { timezone: 'Mars/Base' }), { code: 'VALIDATION' });
        await assert.rejects(db.users.updateSettings(FRANK, { reminder_hour: 24 }), { code: 'VALIDATION' });
        assert.equal((await db.users.updateSettings(FRANK, { timezone: null })).timezone, null);

        const now = new Date('2030-06-10T12:00:00Z');
        const mk = async (name, deadline) => (await db.tasks.createList(FRANK, { name, deadline })).list;
        const today = await mk('due today', '2030-06-10');
        const missed = await mk('missed', '2030-06-08');
        const ancient = await mk('ancient', '2030-05-01');
        const far = await mk('far future', '2030-07-20');
        const ids = async () => (await db.tasks.getReminderCandidates(now)).map((l) => l.id);
        let found = await ids();
        assert.ok(found.includes(today.id) && found.includes(missed.id));
        assert.ok(!found.includes(ancient.id) && !found.includes(far.id));
        const row = (await db.tasks.getReminderCandidates(now)).find((l) => l.id === today.id);
        assert.equal(row.reminder_hour, 7, "the candidate carries the owner reminder hour");
        assert.equal(row.items_total, 0);

        await db.tasks.markReminderSent(today.id, 'due');
        found = await ids();
        assert.ok(found.includes(today.id), 'still a candidate until the overdue notice is also sent');
        await db.tasks.markReminderSent(today.id, 'overdue');
        await db.tasks.markReminderSent(missed.id, 'due', { late: true });
        found = await ids();
        assert.ok(!found.includes(today.id) && !found.includes(missed.id));

        // Snooze: not a candidate until the snooze ends, then again.
        await db.tasks.snoozeList(FRANK, today.id, new Date('2030-06-11T09:00:00Z'));
        assert.ok(!(await ids()).includes(today.id));
        const later = new Date('2030-06-11T10:00:00Z');
        assert.ok((await db.tasks.getReminderCandidates(later)).some((l) => l.id === today.id));
        await db.tasks.markReminderSent(today.id, 'snooze');
        assert.ok(!(await db.tasks.getReminderCandidates(later)).some((l) => l.id === today.id));
        await assert.rejects(db.tasks.snoozeList(BOB, today.id, later), { code: 'NOT_FOUND' });

        // Changing the deadline re-arms everything.
        await db.tasks.updateList(FRANK, today.id, { deadline: '2030-06-10' });
        assert.ok((await ids()).includes(today.id));
    });

    await t.test('weekly digest: opt-in, once a week, real numbers', async () => {
        const GINA = '100000000000000007';
        await db.users.ensureUser(GINA);
        const now = new Date();
        assert.ok(!(await db.users.getDigestCandidates(now)).some((u) => u.discord_id === GINA), 'off by default');
        assert.equal(await db.users.toggleSetting(GINA, 'weekly_digest'), true);
        assert.ok((await db.users.getDigestCandidates(now)).some((u) => u.discord_id === GINA));

        const { list } = await db.tasks.createList(GINA, { name: 'Week', deadline: '2000-01-01' });
        const { item } = await db.tasks.addItem(GINA, list.id, { name: 'done' });
        await db.tasks.addItem(GINA, list.id, { name: 'open' });
        await db.tasks.setItemCompleted(GINA, item.id, true);
        const stats = await db.users.getWeeklyStats(GINA, now);
        assert.equal(stats.completed, 1);
        assert.ok(stats.xpEarned >= 10, 'list, task and completion XP');
        assert.equal(stats.listsOpen, 1);
        assert.equal(stats.listsOverdue, 1);

        await db.users.markDigestSent(GINA, now);
        assert.ok(!(await db.users.getDigestCandidates(now)).some((u) => u.discord_id === GINA), 'not again this week');
        assert.ok((await db.users.getDigestCandidates(new Date(now.getTime() + 7 * 86400e3))).some((u) => u.discord_id === GINA), 'due again next week');
    });

    await t.test('digest claim is atomic, releasable, and overdue follows the user zone', async () => {
        const IVY = '100000000000000091';
        await db.users.ensureUser(IVY);
        await db.users.toggleSetting(IVY, 'weekly_digest');
        const now = new Date('2030-06-10T12:00:00Z');
        const claims = await Promise.all([db.users.claimDigest(IVY, now), db.users.claimDigest(IVY, now), db.users.claimDigest(IVY, now)]);
        assert.equal(claims.filter(Boolean).length, 1, 'exactly one overlapping run wins');
        assert.equal(await db.users.claimDigest(IVY, new Date(now.getTime() + 3600e3)), false, 'not again within the week');
        await db.users.releaseDigest(IVY, now, null);
        assert.equal(await db.users.claimDigest(IVY, now), true, 'released claims can be retaken');

        // 2030-06-10 23:30 UTC is already June 11 in Manila: a June 10 deadline is overdue there only.
        await db.users.updateSettings(IVY, { timezone: 'Asia/Manila' });
        const { list } = await db.tasks.createList(IVY, { name: 'Zone', deadline: '2030-06-10' });
        await db.tasks.addItem(IVY, list.id, { name: 'open' });
        const late = new Date('2030-06-10T23:30:00Z');
        assert.equal((await db.users.getWeeklyStats(IVY, late)).listsOverdue, 1);
        await db.users.updateSettings(IVY, { timezone: 'America/New_York' });
        assert.equal((await db.users.getWeeklyStats(IVY, late)).listsOverdue, 0);
    });

    await t.test('createListWithItems is all or nothing (the AI create_list tool)', async () => {
        const KIT = '100000000000000093';
        await db.users.ensureUser(KIT);
        const ok = await db.tasks.createListWithItems(KIT, { name: 'Kit' }, ['one', 'two', 'three']);
        assert.deepEqual(ok.items.map((r) => r.item.name), ['one', 'two', 'three']);
        assert.deepEqual((await db.tasks.getItems(KIT, ok.list.id)).map((i) => i.position), [0, 1, 2]);

        // A bad item name must not leave a list without its items behind.
        await assert.rejects(db.tasks.createListWithItems(KIT, { name: 'Half made' }, ['fine', '   ']), { code: 'VALIDATION' });
        assert.equal(await db.tasks.getListByName(KIT, 'Half made'), null);
        // A duplicate list name fails before any item is written.
        await assert.rejects(db.tasks.createListWithItems(KIT, { name: 'Kit' }, ['x']), { code: 'CONFLICT' });
        assert.equal((await db.tasks.getItems(KIT, ok.list.id)).length, 3);
    });

    await t.test('a snooze that fires after the deadline also settles the due/overdue notices', async () => {
        const JON = '100000000000000092';
        await db.users.ensureUser(JON);
        const { list } = await db.tasks.createList(JON, { name: 'Snoozed', deadline: '2030-06-08' });
        await db.tasks.markReminderSent(list.id, 'snooze', { late: true, pastDeadline: true });
        const row = await db.tasks.getList(JON, list.id);
        assert.equal(Boolean(row.deadline_notified), true);
        assert.equal(Boolean(row.overdue_notified), true);
        assert.equal(row.remind_at, null);
    });

    await t.test('export, import (reward-free) and the calendar feed', async () => {
        const HANNA = '100000000000000008';
        await db.users.ensureUser(HANNA);
        const { list } = await db.tasks.createList(HANNA, { name: 'Trip, 2030', deadline: '2030-08-01', category: 'Travel' });
        const { item: a } = await db.tasks.addItem(HANNA, list.id, { name: 'Book flights', due_date: '2030-06-01', tags: 'travel' });
        await db.tasks.addItem(HANNA, list.id, { name: '=HYPERLINK("http://evil")', parent_id: a.id, priority: 'high' });
        await db.tasks.setItemCompleted(HANNA, a.id, true);

        const exported = await db.transfer.exportAll(HANNA);
        assert.equal(exported.version, 1);
        assert.equal(exported.lists[0].items.length, 2);
        assert.equal(exported.lists[0].items[1].parent_id, a.id);
        const csv = db.transfer.toCsv(exported);
        assert.ok(csv.startsWith('list,task,subtask_of,done'));
        assert.ok(csv.includes('"Trip, 2030"'), 'commas are quoted');
        assert.ok(csv.includes("'=HYPERLINK"), 'spreadsheet formulas are defused');

        // Import into a second account: same names get a suffix, nothing is rewarded.
        const IVY = '100000000000000009';
        await db.users.ensureUser(IVY);
        await db.tasks.createList(IVY, { name: 'Trip, 2030' });
        const before = await db.users.getUser(IVY);
        const result = await db.transfer.importAll(IVY, JSON.parse(JSON.stringify(exported)));
        assert.deepEqual(result, { lists: 1, items: 2 });
        const after = await db.users.getUser(IVY);
        assert.equal(Number(after.player_xp), Number(before.player_xp), 'importing never pays XP');
        assert.equal(Number(after.total_items_added), Number(before.total_items_added));
        assert.equal(Number(after.total_lists_created), Number(before.total_lists_created));
        const lists = await db.tasks.getLists(IVY);
        const imported = lists.find((l) => l.name === 'Trip, 2030 (imported)');
        assert.ok(imported, 'name clash gets a suffix');
        const items = await db.tasks.getItems(IVY, imported.id);
        assert.equal(items.length, 2);
        const parent = items.find((i) => i.name === 'Book flights');
        assert.equal(Boolean(parent.completed), true);
        assert.equal(Boolean(parent.xp_awarded), true, 'imported completions cannot be re-earned');
        assert.equal(items.find((i) => i.name.startsWith('=')).parent_id, parent.id, 'subtask links survive');
        assert.equal((await db.tasks.setItemCompleted(IVY, parent.id, false)).xp, null);
        assert.equal((await db.tasks.setItemCompleted(IVY, parent.id, true)).xp, null);

        // All or nothing, and bounded.
        const count = async () => (await db.tasks.getLists(IVY)).length;
        const n = await count();
        await assert.rejects(db.transfer.importAll(IVY, { lists: [{ name: 'ok' }, { name: 'bad', deadline: '2030-02-30' }] }), { code: 'VALIDATION' });
        assert.equal(await count(), n, 'a bad entry imports nothing');
        await assert.rejects(db.transfer.importAll(IVY, { lists: 'nope' }), { code: 'VALIDATION' });
        await assert.rejects(db.transfer.importAll(IVY, { lists: Array.from({ length: 101 }, (_, i) => ({ name: `l${i}` })) }), { code: 'VALIDATION' });
        await assert.rejects(db.transfer.importAll(IVY, { lists: [{ name: 'x', items: [{ name: 'y', tags: 'a b c d e f' }] }] }), { code: 'VALIDATION' });

        // Calendar token: create, look up, rotate (old one dies), revoke.
        const token = await db.transfer.regenerateCalendarToken(HANNA);
        assert.match(token, /^[a-f0-9]{32}$/);
        assert.equal(await db.transfer.findUserByCalendarToken(token), HANNA);
        assert.equal(await db.transfer.findUserByCalendarToken('0'.repeat(32)), null);
        assert.equal(await db.transfer.findUserByCalendarToken("x' OR '1'='1"), null);
        const rotated = await db.transfer.regenerateCalendarToken(HANNA);
        assert.notEqual(rotated, token);
        assert.equal(await db.transfer.findUserByCalendarToken(token), null);
        const feed = await db.transfer.getCalendarData(HANNA);
        assert.equal(feed.lists[0].deadline, '2030-08-01');
        assert.equal(feed.items[0].due_date, '2030-06-01');
        assert.equal(feed.items[0].completed, true);
        await db.transfer.clearCalendarToken(HANNA);
        assert.equal(await db.transfer.findUserByCalendarToken(rotated), null);
    });

    await t.test('class purchase is atomic under concurrency', async () => {
        await setXP(ALICE, 600);
        const results = await Promise.allSettled([db.progression.buyClass(ALICE, 'hero'), db.progression.buyClass(ALICE, 'HERO')]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        const user = await db.users.getUser(ALICE);
        assert.equal(Number(user.player_xp), 100);
        assert.equal(user.player_class, 'HERO');
        const levelBefore = Number(user.player_level);
        assert.ok(levelBefore >= 6, 'spending XP does not lower level');
        await assert.rejects(db.progression.buyClass(ALICE, '__proto__'), { code: 'NOT_FOUND' });
    });

    await t.test('skills enforce prerequisites, ownership and cost', async () => {
        await setXP(ALICE, 1000);
        await assert.rejects(db.progression.unlockSkill(ALICE, 'hero_inspire'), { code: 'FORBIDDEN' });
        await assert.rejects(db.progression.unlockSkill(ALICE, 'tank_fortify'), { code: 'FORBIDDEN' });
        const r = await db.progression.unlockSkill(ALICE, 'hero_valor');
        assert.equal(r.level, 1);
        const r2 = await db.progression.unlockSkill(ALICE, 'hero_valor');
        assert.equal(r2.level, 2);
        await assert.rejects(db.progression.unlockSkill(ALICE, 'nope'), { code: 'NOT_FOUND' });
    });

    await t.test('daily reward once per 24h', async () => {
        const first = await db.progression.claimDaily(BOB);
        assert.equal(first.claimed, true);
        assert.equal(first.streak, 1);
        const second = await db.progression.claimDaily(BOB);
        assert.equal(second.claimed, false);
        assert.ok(second.remainingMs > 0);
    });

    await t.test('blackjack settles exactly once', async () => {
        await setXP(BOB, 1000);
        await assert.rejects(db.games.startBlackjack(BOB, 5), { code: 'VALIDATION' });
        await assert.rejects(db.games.startBlackjack(BOB, -50), { code: 'VALIDATION' });
        await assert.rejects(db.games.startBlackjack(BOB, 251), { code: 'VALIDATION' });

        let started = await db.games.startBlackjack(BOB, 100);
        while (started.settlement) started = await db.games.startBlackjack(BOB, 100);
        assert.equal(started.view.dealerHand[1], null, 'hole card hidden');
        assert.equal(started.view.deck, undefined, 'deck never exposed');

        const resumed = await db.games.startBlackjack(BOB, 100);
        assert.equal(resumed.resumed, true);

        const [a, b] = await Promise.allSettled([db.games.blackjackAction(BOB, 'stand'), db.games.blackjackAction(BOB, 'stand')]);
        assert.equal([a, b].filter((r) => r.status === 'fulfilled').length, 1, 'second stand must fail');
        const [[{ n }]] = await pool.query(
            "SELECT COUNT(*) AS n FROM xp_transactions WHERE discord_id = ? AND reference_id = ? AND source <> 'blackjack_bet'",
            [BOB, started.sessionId]
        );
        assert.ok(Number(n) <= 1, 'at most one payout transaction');
    });

    await t.test('expired blackjack sessions refund the bet', async () => {
        await setXP(BOB, 1000);
        let s = await db.games.startBlackjack(BOB, 50);
        while (s.settlement) s = await db.games.startBlackjack(BOB, 50);
        const before = Number((await db.users.getUser(BOB)).player_xp);
        await pool.query('UPDATE game_sessions SET created_at = created_at - INTERVAL 2 HOUR WHERE id = ?', [s.sessionId]);
        assert.equal(await db.games.expireStaleSessions(), 1);
        const after = Number((await db.users.getUser(BOB)).player_xp);
        assert.equal(after - before, 50);
    });

    // Replace the active hand with a fixed one so the outcome is known.
    async function rigHand(id, sessionId, player, dealer, extra = {}) {
        const card = (r) => ({ rank: r, suit: '♠' });
        const [[row]] = await pool.query('SELECT game_data FROM game_sessions WHERE id = ?', [sessionId]);
        const data = typeof row.game_data === 'string' ? JSON.parse(row.game_data) : row.game_data;
        const state = { ...data, deck: [], playerHand: player.map(card), dealerHand: dealer.map(card), finished: false, outcome: null, ...extra };
        await pool.query('UPDATE game_sessions SET game_data = ? WHERE id = ?', [JSON.stringify(state), sessionId]);
    }

    await t.test('blackjack pays a flat 1:1 whatever the class or skills', async () => {
        await setXP(BOB, 1000);
        await pool.query("UPDATE users SET player_class = 'HERO', owns_hero = 1 WHERE discord_id = ?", [BOB]);
        let s = await db.games.startBlackjack(BOB, 100);
        while (s.settlement) s = await db.games.startBlackjack(BOB, 100);
        const before = Number((await db.users.getUser(BOB)).player_xp);
        await rigHand(BOB, s.sessionId, ['10', 'K'], ['10', '7']);
        const done = await db.games.blackjackAction(BOB, 'stand');
        assert.equal(done.settlement.credited, 200, 'bet back plus exactly the bet, no Hero +25');
        assert.equal(done.settlement.bonusInfo, null);
        assert.equal(Number((await db.users.getUser(BOB)).player_xp) - before, 200);
        await pool.query("UPDATE users SET player_class = 'DEFAULT' WHERE discord_id = ?", [BOB]);
    });

    await t.test('an expired hand the player already acted on is settled, not refunded', async () => {
        await setXP(BOB, 1000);
        let s = await db.games.startBlackjack(BOB, 100);
        while (s.settlement) s = await db.games.startBlackjack(BOB, 100);
        const before = Number((await db.users.getUser(BOB)).player_xp);
        await rigHand(BOB, s.sessionId, ['5', '5', 'K'], ['10', '8']); // 20 vs 18 after a hit: would win on stand
        await pool.query('UPDATE game_sessions SET created_at = created_at - INTERVAL 2 HOUR WHERE id = ?', [s.sessionId]);
        assert.equal(await db.games.expireStaleSessions(), 1);
        assert.equal(Number((await db.users.getUser(BOB)).player_xp) - before, 200);
        const [[row]] = await pool.query('SELECT state FROM game_sessions WHERE id = ?', [s.sessionId]);
        assert.equal(row.state, 'won');

        let t2 = await db.games.startBlackjack(BOB, 100);
        while (t2.settlement) t2 = await db.games.startBlackjack(BOB, 100);
        const mid = Number((await db.users.getUser(BOB)).player_xp);
        await rigHand(BOB, t2.sessionId, ['10', '6', '9'], ['10', '8']); // would bust: the bet is lost, not refunded
        await pool.query('UPDATE game_sessions SET created_at = created_at - INTERVAL 2 HOUR WHERE id = ?', [t2.sessionId]);
        await db.games.expireStaleSessions();
        assert.equal(Number((await db.users.getUser(BOB)).player_xp), mid);
    });

    await t.test('games refuse to settle while XP is off', async () => {
        await setXP(BOB, 1000);
        let s = await db.games.startBlackjack(BOB, 50);
        while (s.settlement) s = await db.games.startBlackjack(BOB, 50);
        await pool.query('UPDATE users SET gamification_enabled = 0 WHERE discord_id = ?', [BOB]);
        await assert.rejects(db.games.blackjackAction(BOB, 'stand'), { code: 'GAMIFICATION_DISABLED' });
        await assert.rejects(db.games.hangmanGuess(BOB, 'E'), { code: 'GAMIFICATION_DISABLED' });
        await pool.query('UPDATE users SET gamification_enabled = 1 WHERE discord_id = ?', [BOB]);
        await pool.query('UPDATE game_sessions SET state = ? WHERE id = ?', ['cancelled', s.sessionId]);
    });

    await t.test('free games: cooldown, daily cap, hangman hides the word', async () => {
        await pool.query('UPDATE users SET last_game_at = NULL WHERE discord_id = ?', [BOB]);
        const round = await db.games.playRps(BOB, 'rock');
        assert.ok(['won', 'lost', 'push'].includes(round.outcome));
        await assert.rejects(db.games.playRps(BOB, 'rock'), { code: 'COOLDOWN' });
        await assert.rejects(db.games.playRps(BOB, 'lizard'), { code: 'VALIDATION' });

        await pool.query('UPDATE users SET last_game_at = NULL WHERE discord_id = ?', [BOB]);
        const h = await db.games.startHangman(BOB);
        assert.equal(h.view.word, null);
        assert.ok(h.view.masked.every((c) => c === null));

        // Exhaust the daily free-game allowance, then a win pays nothing.
        await pool.query(
            "INSERT INTO xp_transactions (discord_id, amount, source, balance_before, balance_after) VALUES (?, 500, 'game_reward', 0, 0)",
            [BOB]
        );
        const letters = 'ETAOINSHRDLUCMFWYPVBGKQJXZ'.split('');
        let res;
        for (const l of letters) {
            res = await db.games.hangmanGuess(BOB, l);
            if (res.view.finished) break;
        }
        assert.equal(res.xpGained, 0);
    });

    await t.test('free-game allowance reflects what was earned today', async () => {
        const open = await db.games.getFreeGameAllowance(BOB);
        assert.equal(open.cap, 500);
        assert.ok(open.remainingXP < 500, 'the hangman test above already used the whole allowance');
        assert.equal(open.remainingXP + open.usedXP, 500);
        assert.ok(new Date(open.resetsAt) > new Date());
        const fresh = await db.games.getFreeGameAllowance('100000000000000099');
        assert.deepEqual([fresh.remainingXP, fresh.usedXP], [500, 0]);
    });

    await t.test('arcade scores must be plausible', async () => {
        await pool.query('UPDATE users SET last_game_at = NULL WHERE discord_id = ?', [BOB]);
        const run = await db.games.startArcade(BOB, 'snake');
        await assert.rejects(db.games.startArcade(BOB, 'snake'), { code: 'COOLDOWN' });
        await assert.rejects(db.games.finishArcade(BOB, run.sessionId, 10_000), { code: 'VALIDATION' });
        const [[{ state }]] = await pool.query('SELECT state FROM game_sessions WHERE id = ?', [run.sessionId]);
        assert.equal(state, 'cancelled', 'an implausible score cancels the run for good');
        await assert.rejects(db.games.finishArcade(BOB, run.sessionId, 0), { code: 'NOT_FOUND' });
        await assert.rejects(db.games.finishArcade(ALICE, run.sessionId, 0), { code: 'NOT_FOUND' });
        await pool.query('UPDATE users SET last_game_at = NULL WHERE discord_id = ?', [BOB]);
        const run2 = await db.games.startArcade(BOB, 'dino');
        const done = await db.games.finishArcade(BOB, run2.sessionId, 0);
        assert.equal(done.xpGained, 0);
        const [[zero]] = await pool.query('SELECT state FROM game_sessions WHERE id = ?', [run2.sessionId]);
        assert.equal(zero.state, 'lost', 'a zero-score run is not a win');
        await assert.rejects(db.games.finishArcade(BOB, run2.sessionId, 0), { code: 'NOT_FOUND' });
    });

    await t.test('leaderboard, history, cleanup and reset', async () => {
        const lifetime = await db.users.getLeaderboard(10, { by: 'lifetime' });
        assert.ok(lifetime.every((r, i) => i === 0 || lifetime[i - 1].score >= r.score));
        assert.equal(lifetime[0].score, Number(lifetime[0].lifetime_xp));
        const weekly = await db.users.getLeaderboard(10, { by: 'weekly' });
        assert.ok(weekly.length >= 1 && weekly.every((r) => r.score > 0), 'weekly only lists players who earned XP');
        const heroes = await db.users.getLeaderboard(10, { by: 'lifetime', playerClass: 'hero' });
        assert.ok(heroes.every((r) => r.player_class === 'HERO'));
        const top = lifetime[0];
        assert.equal(await db.users.getRank(top.discord_id, 'lifetime'), 1);
        assert.equal(await db.users.getRank('999999999999999999', 'lifetime'), null);
        const board = await db.users.getLeaderboard(10);
        assert.ok(board.length >= 2);
        assert.ok(board[0].lifetime_xp >= board[1].lifetime_xp, "default board ranks by lifetime XP");
        const history = await db.games.getGameHistory(BOB, 5);
        assert.ok(history.length > 0);

        const { list: unfinished } = await db.tasks.createList(BOB, { name: 'Overdue forever', deadline: '2020-01-01' });
        await db.tasks.addItem(BOB, unfinished.id, { name: 'never done' });
        const { list } = await db.tasks.createList(BOB, { name: 'Old' });
        const { item: doneItem } = await db.tasks.addItem(BOB, list.id, { name: 'finished long ago' });
        await db.tasks.setItemCompleted(BOB, doneItem.id, true);
        await db.getPool().query('UPDATE items SET updated_at = updated_at - INTERVAL 10 DAY WHERE id = ?', [doneItem.id]);
        const removed = await db.tasks.cleanupOldLists();
        assert.ok(removed.some((l) => l.id === list.id && l.discord_id === BOB), 'reports which lists were deleted');
        assert.equal(await db.tasks.getList(BOB, list.id), null);
        assert.ok(await db.tasks.getList(BOB, unfinished.id), 'unfinished lists survive, even when overdue');

        await db.users.resetProgress(BOB);
        const bob = await db.users.getUser(BOB);
        assert.equal(Number(bob.player_xp), 0);
        assert.equal(Number(bob.lifetime_xp), 0);
    });

    await t.test('quests cannot be farmed by re-checking, importing, priority edits or recurring copies', async () => {
        const QID = '100000000000000011';
        await db.users.ensureUser(QID);
        const progress = async (key) => (await db.quests.getQuests(QID)).find((q) => q.key === key).progress;
        const { list } = await db.tasks.createList(QID, { name: 'Quest list' });
        const { item: a } = await db.tasks.addItem(QID, list.id, { name: 'a' });

        // re-checking after the completion moved to an earlier period must not re-count it
        await db.tasks.setItemCompleted(QID, a.id, true);
        assert.equal(await progress('DAILY_COMPLETE_3'), 1);
        await db.getPool().query("UPDATE items SET first_completed_at = first_completed_at - INTERVAL 3 DAY, completed_at = completed_at - INTERVAL 3 DAY WHERE id = ?", [a.id]);
        assert.equal(await progress('DAILY_COMPLETE_3'), 0);
        await db.tasks.setItemCompleted(QID, a.id, false);
        await db.tasks.setItemCompleted(QID, a.id, true);
        assert.equal(await progress('DAILY_COMPLETE_3'), 0, 'uncheck/recheck does not move the first completion');

        // priority raised after completing does not qualify for the high-priority quest
        const { item: b } = await db.tasks.addItem(QID, list.id, { name: 'b', priority: 'low' });
        await db.tasks.setItemCompleted(QID, b.id, true);
        await db.tasks.updateItem(QID, b.id, { priority: 'high' });
        assert.equal(await progress('DAILY_HIGH_1'), 0);
        const { item: c } = await db.tasks.addItem(QID, list.id, { name: 'c', priority: 'high' });
        await db.tasks.setItemCompleted(QID, c.id, true);
        assert.equal(await progress('DAILY_HIGH_1'), 1);

        // imported tasks (even completed ones) satisfy no quest
        const before = { done: await progress('DAILY_COMPLETE_3'), adds: await progress('DAILY_ADD_3') };
        await db.transfer.importAll(QID, { lists: [{ name: 'Imp', items: [1, 2, 3, 4].map((n) => ({ name: `i${n}`, completed: true })) }] });
        assert.equal(await progress('DAILY_COMPLETE_3'), before.done);
        assert.equal(await progress('DAILY_ADD_3'), before.adds);

        // a spawned recurring copy is not an add, and completing it does not count either
        const { item: r } = await db.tasks.addItem(QID, list.id, { name: 'r', recurrence: 'daily' });
        const addsBefore = await progress('DAILY_ADD_3');
        const res = await db.tasks.setItemCompleted(QID, r.id, true);
        assert.ok(res.nextItem);
        assert.equal(Number((await db.getPool().query('SELECT counts_for_quests AS n FROM items WHERE id = ?', [res.nextItem.id]))[0][0].n), 0);
        assert.equal(await progress('DAILY_ADD_3'), addsBefore);
    });

    await t.test('cleanup re-checks a list under lock: a task added after the select saves it', async () => {
        const CID = '100000000000000012';
        await db.users.ensureUser(CID);
        await db.query('UPDATE users SET auto_delete_old_lists = 1 WHERE discord_id = ?', [CID]);
        const make = async (name) => {
            const { list } = await db.tasks.createList(CID, { name });
            const { item } = await db.tasks.addItem(CID, list.id, { name: 'done' });
            await db.tasks.setItemCompleted(CID, item.id, true);
            await db.getPool().query('UPDATE items SET updated_at = updated_at - INTERVAL 10 DAY WHERE id = ?', [item.id]);
            return list;
        };
        const raced = await make('raced');
        const plain = await make('plain');
        const removed = await db.tasks.cleanupOldLists(5, {
            onCandidates: async (rows) => {
                assert.ok(rows.some((r) => r.id === raced.id), 'was a candidate when selected');
                await db.tasks.addItem(CID, raced.id, { name: 'new unfinished task' });
            }
        });
        assert.ok(await db.tasks.getList(CID, raced.id), 'the list that got a new task survives');
        assert.equal(await db.tasks.getList(CID, plain.id), null);
        assert.deepEqual(removed.filter((r) => r.discord_id === CID).map((r) => r.id), [plain.id]);
    });

    await t.test('import enforces the per-user quota and one level of subtasks', async () => {
        const IMP = '100000000000000013';
        await db.users.ensureUser(IMP);
        const { LIMITS } = require('../src/constants');
        const many = (n) => Array.from({ length: n }, (_, i) => ({ name: `L${i}` }));
        await assert.rejects(db.transfer.importAll(IMP, { lists: many(LIMITS.MAX_LISTS_PER_USER + 1) }), { code: 'VALIDATION' });
        assert.equal((await db.tasks.getLists(IMP)).length, 0);
        await db.transfer.importAll(IMP, { lists: many(3) });
        await assert.rejects(db.transfer.importAll(IMP, { lists: many(LIMITS.MAX_LISTS_PER_USER - 2) }), { code: 'VALIDATION' }, 'existing lists count');
        await assert.rejects(
            db.transfer.importAll(IMP, { lists: [{ name: 'deep', items: [{ id: 1, name: 'a' }, { id: 2, name: 'b', parent_id: 1 }, { id: 3, name: 'c', parent_id: 2 }] }] }),
            { code: 'VALIDATION' }
        );
        assert.equal((await db.tasks.getLists(IMP)).length, 3, 'rejected import writes nothing');
        await db.transfer.importAll(IMP, { lists: [{ name: 'flat', items: [{ id: 1, name: 'a' }, { id: 2, name: 'b', parent_id: 1 }] }] });
    });

    await t.test('profile and stats never carry the calendar token; reset clears quest claims', async () => {
        const CT = '100000000000000014';
        await db.users.ensureUser(CT);
        const token = await db.transfer.regenerateCalendarToken(CT);
        const stats = await db.users.getUserStats(CT);
        assert.equal(stats.user.calendar_token, undefined);
        assert.equal(stats.user.has_calendar_token, true);
        assert.ok(!JSON.stringify(stats).includes(token));
        assert.equal(await db.transfer.findUserByCalendarToken(token), CT, 'the feed still works');

        await db.query("INSERT INTO quest_claims (discord_id, quest_key, period_start, reward_xp) VALUES (?, 'DAILY_ADD_3', CURDATE(), 15)", [CT]);
        await db.users.resetProgress(CT);
        const [claims] = await db.getPool().query('SELECT COUNT(*) AS n FROM quest_claims WHERE discord_id = ?', [CT]);
        assert.equal(Number(claims[0].n), 0, 'a reset lets the same quest be claimed again');
    });

    await t.test('streak board ignores dead streaks; rank respects the class filter', async () => {
        const S1 = '100000000000000015';
        const S2 = '100000000000000016';
        const S3 = '100000000000000017';
        for (const id of [S1, S2, S3]) await db.users.ensureUser(id);
        await db.query("UPDATE users SET streak_count = 30, last_daily_claim = NOW() - INTERVAL 10 DAY, player_class = 'HERO', lifetime_xp = 900 WHERE discord_id = ?", [S1]);
        await db.query("UPDATE users SET streak_count = 4, last_daily_claim = NOW() - INTERVAL 1 HOUR, player_class = 'HERO', lifetime_xp = 800 WHERE discord_id = ?", [S2]);
        await db.query("UPDATE users SET streak_count = 2, last_daily_claim = NOW() - INTERVAL 1 HOUR, player_class = 'WIZARD', lifetime_xp = 700 WHERE discord_id = ?", [S3]);
        const board = await db.users.getLeaderboard(100, { by: 'streak' });
        assert.ok(!board.some((r) => r.discord_id === S1), 'a 10-day-old streak is not shown');
        assert.ok(board.some((r) => r.discord_id === S2));
        assert.equal(await db.users.getRank(S1, 'streak'), null);

        // rank is within the class when a class is given
        const heroBoard = await db.users.getLeaderboard(100, { by: 'lifetime', playerClass: 'hero' });
        const wizBoard = await db.users.getLeaderboard(100, { by: 'lifetime', playerClass: 'wizard' });
        const heroRank = heroBoard.findIndex((r) => r.discord_id === S2) + 1;
        const wizRank = wizBoard.findIndex((r) => r.discord_id === S3) + 1;
        assert.equal(await db.users.getRank(S2, 'lifetime', { playerClass: 'hero' }), heroRank);
        assert.equal(await db.users.getRank(S3, 'lifetime', { playerClass: 'WIZARD' }), wizRank);
        assert.equal(await db.users.getRank(S3, 'lifetime', { playerClass: 'hero' }), null, 'not on that class board');
        assert.ok((await db.users.getRank(S3, 'lifetime')) >= wizRank, 'the all-class rank is never better than the class rank');
    });

    await t.test('Assassin streak decays in the database after a long gap, and every action stamps assassin_last_at', async () => {
        const A = '100000000000000201';
        await db.users.ensureUser(A);
        await db.query(
            "UPDATE users SET player_class = 'ASSASSIN', assassin_streak = 6, assassin_stacks = 7, assassin_last_at = NOW() - INTERVAL 40 HOUR WHERE discord_id = ?",
            [A]
        );
        const { list } = await db.tasks.createList(A, { name: 'Decay' });
        const row = async () => (await db.query('SELECT assassin_streak, assassin_stacks, assassin_last_at FROM users WHERE discord_id = ?', [A]))[0];
        const after = await row();
        assert.equal(after.assassin_streak, 1, 'the 40h-old streak restarted with this action');
        assert.equal(after.assassin_stacks, 0);
        assert.ok(Date.now() - new Date(after.assassin_last_at).getTime() < 60_000);
        await db.tasks.addItem(A, list.id, { name: 'Another' });
        assert.equal((await row()).assassin_streak, 2, 'inside the window it keeps building');
    });

    await t.test('Freeze Cache: 5 freezes at 120 XP, chain-gated, and class counters reset on a class switch', async () => {
        const F = '100000000000000203';
        await db.users.ensureUser(F);
        await setXP(F, 5000);
        // the chain default_xp_boost -> daily_boost -> streak_shield -> freeze_cache must be bought in order
        await assert.rejects(db.progression.unlockSkill(F, 'default_freeze_cache'), { code: 'FORBIDDEN' });
        for (const id of ['default_xp_boost', 'default_daily_boost', 'default_daily_boost', 'default_streak_shield']) await db.progression.unlockSkill(F, id);
        for (let i = 0; i < 3; i += 1) await db.progression.buyStreakFreeze(F);
        await assert.rejects(db.progression.buyStreakFreeze(F), { code: 'CONFLICT' }, 'the default cap is 3');
        await db.progression.unlockSkill(F, 'default_freeze_cache');
        const before = (await db.users.getUser(F)).player_xp;
        const bought = await db.progression.buyStreakFreeze(F);
        assert.equal(bought.freezes, 4);
        assert.equal(bought.max, 5);
        assert.equal(bought.cost, 120);
        assert.equal(Number(before) - bought.balance, 120);
        await db.progression.buyStreakFreeze(F);
        await assert.rejects(db.progression.buyStreakFreeze(F), { code: 'CONFLICT' }, 'the cache cap is 5');

        // gambler_streak resets when switching class; assassin_bleed survives (it belongs to the skill, not the class)
        await db.query("UPDATE users SET owns_gambler = 1, owns_hero = 1, player_class = 'GAMBLER', gambler_streak = 4, assassin_bleed = 2 WHERE discord_id = ?", [F]);
        await db.progression.equipClass(F, 'HERO');
        const after = await db.users.getUser(F);
        assert.equal(after.gambler_streak, 0);
        assert.equal(after.assassin_bleed, 2);
        await db.users.resetProgress(F);
        const wiped = await db.users.getUser(F);
        assert.equal(wiped.assassin_bleed, 0);
        assert.equal(wiped.assassin_last_at, null);
    });

    await t.test('buying the Monk: atomic, sets owns_monk, counters reset on a class switch, resetProgress clears them', async () => {
        const M = '100000000000000204';
        await db.users.ensureUser(M);
        await setXP(M, 549);
        await assert.rejects(db.progression.buyClass(M, 'monk'), { code: 'INSUFFICIENT_XP' });
        let u = await db.users.getUser(M);
        assert.equal(Number(u.owns_monk), 0, 'nothing is granted when the purchase fails');
        assert.equal(Number(u.player_xp), 549);
        await setXP(M, 600);
        const bought = await db.progression.buyClass(M, 'MONK');
        assert.equal(bought.classKey, 'MONK');
        u = await db.users.getUser(M);
        assert.equal(u.player_class, 'MONK');
        assert.equal(Number(u.owns_monk), 1);
        assert.equal(Number(u.player_xp), 50);
        await assert.rejects(db.progression.buyClass(M, 'MONK'), { code: 'CONFLICT' });

        // a rewarded action builds rhythm and stamps the UTC day
        await db.tasks.createList(M, { name: 'Rhythm' });
        u = await db.users.getUser(M);
        assert.equal(Number(u.monk_rhythm), 1);
        assert.equal(u.monk_day, new Date().toISOString().slice(0, 10));

        // a class switch resets the counters; switching back does not restore them
        await db.progression.equipClass(M, 'DEFAULT');
        u = await db.users.getUser(M);
        assert.equal(Number(u.monk_rhythm), 0);
        assert.equal(u.monk_day, null);
        await db.progression.equipClass(M, 'MONK');
        await db.query('UPDATE users SET monk_rhythm = 9, monk_day = ? WHERE discord_id = ?', ['2000-01-01', M]);
        await db.users.resetProgress(M);
        u = await db.users.getUser(M);
        assert.equal(Number(u.owns_monk), 0);
        assert.equal(Number(u.monk_rhythm), 0);
        assert.equal(u.monk_day, null);
        assert.equal(u.player_class, 'DEFAULT');
    });

    await t.test('the Monk tree can be learned only by Monk owners, in chain order', async () => {
        const M = '100000000000000205';
        await db.users.ensureUser(M);
        await setXP(M, 5000);
        await assert.rejects(db.progression.unlockSkill(M, 'monk_breath'), { code: 'FORBIDDEN' });
        await db.progression.buyClass(M, 'MONK');
        await assert.rejects(db.progression.unlockSkill(M, 'monk_focus'), { code: 'FORBIDDEN' });
        await db.progression.unlockSkill(M, 'monk_breath');
        const focus = await db.progression.unlockSkill(M, 'monk_focus');
        assert.equal(focus.treeKey, 'MONK');
    });

    await t.test('ALL_CLASSES needs every class, however many exist, and is never revoked', async () => {
        const shared = require('../src');
        const all = {};
        for (const k of shared.PURCHASABLE_CLASS_KEYS) all[shared.classOwnershipColumn(k)] = 1;
        const has = (stats) => shared.evaluateAchievements(stats, []).some((a) => a.key === 'ALL_CLASSES');
        assert.equal(has(all), true);
        for (const k of shared.PURCHASABLE_CLASS_KEYS) {
            assert.equal(has({ ...all, [shared.classOwnershipColumn(k)]: 0 }), false, `missing ${k}`);
        }
        const M = '100000000000000206';
        await db.users.ensureUser(M);
        await db.query("INSERT INTO achievements (discord_id, achievement_key) VALUES (?, 'ALL_CLASSES')", [M]);
        await db.progression.checkAchievements(M);
        const [[row]] = await db.getPool().query("SELECT COUNT(*) AS n FROM achievements WHERE discord_id = ? AND achievement_key = 'ALL_CLASSES'", [M]);
        assert.equal(Number(row.n), 1, 'still unlocked after re-evaluation without all classes');
        assert.equal(shared.ACHIEVEMENTS.ALL_CLASSES.description, 'Own every class');
    });

    await db.closePool();
});
