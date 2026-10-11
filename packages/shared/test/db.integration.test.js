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

/** XP paid for achievements so far (+25 each), so balance assertions can separate it from the thing under test. */
const rewardSum = async (id) => Number((await db.query("SELECT COALESCE(SUM(amount), 0) AS n FROM xp_transactions WHERE discord_id = ? AND source = 'achievement_reward'", [id]))[0].n);

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

    await t.test('migrations 007-012 are idempotent and add the new columns', async () => {
        await pool.query("DELETE FROM schema_migrations WHERE id >= '007'"); // pretend they were interrupted
        const again = await db.runMigrations({ log: () => {} });
        assert.deepEqual(again.filter((id) => id >= '007'), ['007_item_fields', '008_user_prefs', '009_quest_claims', '010_quest_integrity', '011_class_rework', '012_xp_sources']);
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
        assert.ok((await cols('lists')).includes('cleared_at'));
        assert.ok(users.includes('last_chest_streak'));
        assert.ok(items.includes('habit_streak'));
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
        const rewards0 = await rewardSum(ALICE);
        const results = await Promise.allSettled([db.progression.buyClass(ALICE, 'hero'), db.progression.buyClass(ALICE, 'HERO')]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        const user = await db.users.getUser(ALICE);
        assert.equal(Number(user.player_xp), 100 + ((await rewardSum(ALICE)) - rewards0), 'the class price, plus any achievement it unlocked');
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
        const rewards0 = await rewardSum(BOB);
        await rigHand(BOB, s.sessionId, ['10', 'K'], ['10', '7']);
        const done = await db.games.blackjackAction(BOB, 'stand');
        assert.equal(done.settlement.credited, 200, 'bet back plus exactly the bet, no Hero +25');
        assert.equal(done.settlement.bonusInfo, null);
        assert.equal(Number((await db.users.getUser(BOB)).player_xp) - before - ((await rewardSum(BOB)) - rewards0), 200);
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
        const rewards0 = await rewardSum(M);
        const bought = await db.progression.buyClass(M, 'MONK');
        assert.equal(bought.classKey, 'MONK');
        u = await db.users.getUser(M);
        assert.equal(u.player_class, 'MONK');
        assert.equal(Number(u.owns_monk), 1);
        assert.equal(Number(u.player_xp), 50 + ((await rewardSum(M)) - rewards0));
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

    await t.test('buying the Artisan; finishing a list of 3+ tasks completes the project (completion context from tasks.js)', async () => {
        const R = '100000000000000207';
        await db.users.ensureUser(R);
        await setXP(R, 700);
        await db.progression.buyClass(R, 'artisan');
        let u = await db.users.getUser(R);
        assert.equal(Number(u.owns_artisan), 1);
        assert.equal(u.player_class, 'ARTISAN');

        const { list } = await db.tasks.createList(R, { name: 'Shed' });
        const ids = [];
        for (const name of ['saw', 'sand', 'paint']) ids.push((await db.tasks.addItem(R, list.id, { name })).item.id);
        const first = await db.tasks.setItemCompleted(R, ids[0]);
        assert.equal(first.xp.bonusInfo.type, 'ARTISAN', 'not the last open task');
        await db.tasks.setItemCompleted(R, ids[1]);
        const last = await db.tasks.setItemCompleted(R, ids[2]);
        assert.equal(last.xp.bonusInfo.type, 'ARTISAN_CLEAR');
        // list create + 3 adds + 3 completions = 7 progress: 7 * 2 + 7 * 5
        assert.equal(last.xp.bonusInfo.classBonus, 14 + 35);
        u = await db.users.getUser(R);
        assert.equal(Number(u.artisan_progress), 0, 'a finished project resets');

        // lists with fewer than 3 tasks, and recurring tasks, never count as a cleared list
        const { list: small } = await db.tasks.createList(R, { name: 'Tiny' });
        const a = (await db.tasks.addItem(R, small.id, { name: 'one' })).item.id;
        const b = (await db.tasks.addItem(R, small.id, { name: 'two' })).item.id;
        await db.tasks.setItemCompleted(R, a);
        assert.equal((await db.tasks.setItemCompleted(R, b)).xp.bonusInfo.type, 'ARTISAN');

        const { list: rec } = await db.tasks.createList(R, { name: 'Chores' });
        const r1 = (await db.tasks.addItem(R, rec.id, { name: 'dishes', recurrence: 'daily' })).item.id;
        const r2 = (await db.tasks.addItem(R, rec.id, { name: 'trash' })).item.id;
        const r3 = (await db.tasks.addItem(R, rec.id, { name: 'mail' })).item.id;
        await db.tasks.setItemCompleted(R, r2);
        await db.tasks.setItemCompleted(R, r3);
        assert.equal((await db.tasks.setItemCompleted(R, r1)).xp.bonusInfo.type, 'ARTISAN', 'a repeating task respawns, so the list is not cleared');

        await db.progression.equipClass(R, 'DEFAULT');
        assert.equal(Number((await db.users.getUser(R)).artisan_progress), 0);
        await db.users.resetProgress(R);
        u = await db.users.getUser(R);
        assert.equal(Number(u.owns_artisan), 0);
    });

    await t.test('buying the Ranger; completion passes the due date so early, on-time and overdue tasks pay differently', async () => {
        const G = '100000000000000208';
        await db.users.ensureUser(G);
        await setXP(G, 650);
        await db.progression.buyClass(G, 'RANGER');
        const u = await db.users.getUser(G);
        assert.equal(Number(u.owns_ranger), 1);
        assert.equal(u.player_class, 'RANGER');

        const shared = require('../src');
        const day = (offset) => {
            const d = new Date(`${shared.todayInZone()}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() + offset);
            return d.toISOString().slice(0, 10);
        };
        const { list } = await db.tasks.createList(G, { name: 'Trail' });
        const make = async (name, due_date) => (await db.tasks.addItem(G, list.id, { name, due_date })).item.id;
        const early = await db.tasks.setItemCompleted(G, await make('early', day(3)));
        assert.equal(early.xp.bonusInfo.type, 'RANGER_EARLY');
        assert.equal(early.xp.bonusInfo.classBonus, 3 + 6, '3 days early on a 10 XP task');
        const today = await db.tasks.setItemCompleted(G, await make('today', day(0)));
        assert.equal(today.xp.bonusInfo.type, 'RANGER_DUE');
        assert.equal(today.xp.bonusInfo.classBonus, 2);
        const late = await db.tasks.setItemCompleted(G, await make('late', day(-2)));
        assert.equal(late.xp.bonusInfo.type, 'RANGER_LATE');
        assert.equal(late.xp.bonusInfo.classBonus, 0);
        const none = await db.tasks.setItemCompleted(G, await make('whenever', undefined));
        assert.equal(none.xp.bonusInfo.type, 'RANGER');
        await db.users.resetProgress(G);
        assert.equal(Number((await db.users.getUser(G)).owns_ranger), 0);
    });

    await t.test('buying the Necromancer; reviving an overdue task binds a soul; the counter resets on a class switch', async () => {
        const N = '100000000000000209';
        await db.users.ensureUser(N);
        await setXP(N, 650);
        await db.progression.buyClass(N, 'necromancer');
        let u = await db.users.getUser(N);
        assert.equal(Number(u.owns_necromancer), 1);
        assert.equal(u.player_class, 'NECROMANCER');

        const shared = require('../src');
        const day = (offset) => {
            const d = new Date(`${shared.todayInZone()}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() + offset);
            return d.toISOString().slice(0, 10);
        };
        const { list } = await db.tasks.createList(N, { name: 'Crypt' });
        const add = async (name, due_date) => (await db.tasks.addItem(N, list.id, { name, due_date })).item.id;
        const first = await db.tasks.setItemCompleted(N, await add('stale', day(-3)));
        assert.equal(first.xp.bonusInfo.type, 'NECROMANCER_REVIVE');
        assert.equal(first.xp.bonusInfo.classBonus, 15 + 9 + 0, '3 days overdue on a 10 XP task, first soul');
        assert.equal(Number((await db.users.getUser(N)).necro_souls), 1);
        const fresh = await db.tasks.setItemCompleted(N, await add('fresh', day(1)));
        assert.equal(fresh.xp.bonusInfo.type, 'NECROMANCER', 'a task that is not overdue is not a revive');
        assert.equal(Number((await db.users.getUser(N)).necro_souls), 1);
        const dueToday = await db.tasks.setItemCompleted(N, await add('today', day(0)));
        assert.equal(dueToday.xp.bonusInfo.type, 'NECROMANCER', 'due today is not overdue');

        await db.progression.equipClass(N, 'DEFAULT');
        u = await db.users.getUser(N);
        assert.equal(Number(u.necro_souls), 0);
        await db.query('UPDATE users SET necro_souls = 4 WHERE discord_id = ?', [N]);
        await db.users.resetProgress(N);
        u = await db.users.getUser(N);
        assert.equal(Number(u.necro_souls), 0);
        assert.equal(Number(u.owns_necromancer), 0);
    });

    await t.test('buying the Paladin; HIGH priority tasks pay the Vow; the streak board honours the Paladin window', async () => {
        const P = '100000000000000210';
        await db.users.ensureUser(P);
        await setXP(P, 800);
        await db.progression.buyClass(P, 'Paladin');
        let u = await db.users.getUser(P);
        assert.equal(Number(u.owns_paladin), 1);
        assert.equal(u.player_class, 'PALADIN');

        const { list } = await db.tasks.createList(P, { name: 'Oaths' });
        const hard = (await db.tasks.addItem(P, list.id, { name: 'hard', priority: 'high' })).item.id;
        const easy = (await db.tasks.addItem(P, list.id, { name: 'easy', priority: 'low' })).item.id;
        const vow = await db.tasks.setItemCompleted(P, hard);
        assert.equal(vow.xp.bonusInfo.type, 'PALADIN_VOW');
        assert.equal(vow.xp.bonusInfo.classBonus, 20);
        assert.equal((await db.tasks.setItemCompleted(P, easy)).xp.bonusInfo.classBonus, 5);

        // streak board: a Paladin 60h after the last claim still has a live streak, a Default player does not
        const P2 = '100000000000000211';
        await db.users.ensureUser(P2);
        await db.query("UPDATE users SET streak_count = 6, last_daily_claim = NOW() - INTERVAL 60 HOUR, player_class = 'PALADIN' WHERE discord_id = ?", [P2]);
        const D = '100000000000000212';
        await db.users.ensureUser(D);
        await db.query("UPDATE users SET streak_count = 6, last_daily_claim = NOW() - INTERVAL 60 HOUR WHERE discord_id = ?", [D]);
        const board = await db.users.getLeaderboard(100, { by: 'streak' });
        assert.ok(board.some((r) => r.discord_id === P2), 'a Paladin streak survives 60h');
        assert.ok(!board.some((r) => r.discord_id === D), 'the same streak is dead for a Default player');
        await db.query("UPDATE users SET last_daily_claim = NOW() - INTERVAL 80 HOUR WHERE discord_id = ?", [P2]);
        assert.ok(!(await db.users.getLeaderboard(100, { by: 'streak' })).some((r) => r.discord_id === P2), 'beyond 72h without Sanctuary');
        await db.query("INSERT INTO user_skills (discord_id, skill_id, skill_level) VALUES (?, 'paladin_sanctuary', 1)", [P2]);
        assert.ok((await db.users.getLeaderboard(100, { by: 'streak' })).some((r) => r.discord_id === P2), 'Sanctuary stretches it to 96h');

        await db.users.resetProgress(P);
        assert.equal(Number((await db.users.getUser(P)).owns_paladin), 0);
    });

    await t.test('every class can be bought, equipped, filtered on the leaderboard and reset', async () => {
        const shared = require('../src');
        const Z = '100000000000000213';
        await db.users.ensureUser(Z);
        const total = shared.PURCHASABLE_CLASS_KEYS.reduce((sum, k) => sum + shared.CLASSES[k].cost, 0);
        await setXP(Z, total);
        const rewards0 = await rewardSum(Z);
        for (const key of shared.PURCHASABLE_CLASS_KEYS) {
            const bought = await db.progression.buyClass(Z, key.toLowerCase());
            assert.equal(bought.classKey, key);
            assert.equal(Number((await db.users.getUser(Z))[shared.classOwnershipColumn(key)]), 1, key);
        }
        const user = await db.users.getUser(Z);
        assert.equal(Number(user.player_xp), (await rewardSum(Z)) - rewards0, 'exactly the class prices were spent, plus achievement rewards');
        const [[ach]] = await db.getPool().query("SELECT COUNT(*) AS n FROM achievements WHERE discord_id = ? AND achievement_key = 'ALL_CLASSES'", [Z]);
        assert.equal(Number(ach.n), 1, 'owning every class unlocks Collector');
        for (const key of ['DEFAULT', ...shared.PURCHASABLE_CLASS_KEYS]) {
            await db.progression.equipClass(Z, key);
            assert.equal((await db.users.getUser(Z)).player_class, key);
            const board = await db.users.getLeaderboard(100, { playerClass: key });
            assert.ok(board.some((r) => r.discord_id === Z), `${key} leaderboard filter`);
            assert.equal(await db.users.getRank(Z, 'lifetime', { playerClass: key }) > 0, true);
        }
        await db.users.resetProgress(Z);
        const wiped = await db.users.getUser(Z);
        for (const key of shared.PURCHASABLE_CLASS_KEYS) assert.equal(Number(wiped[shared.classOwnershipColumn(key)]), 0, `${key} cleared`);
        for (const col of ['assassin_streak', 'assassin_stacks', 'assassin_bleed', 'gambler_streak', 'wizard_counter', 'archer_streak', 'tank_stacks', 'monk_rhythm', 'artisan_progress', 'necro_souls']) {
            assert.equal(Number(wiped[col]), 0, `${col} cleared`);
        }
        assert.equal(wiped.monk_day, null);
        assert.equal(wiped.assassin_last_at, null);
        assert.equal(wiped.player_class, 'DEFAULT');
    });


    // ─── Bonus XP sources ────────────────────────────────────────────────────────

    const dayOffset = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
    /** Move everything a user earned back by `days`, so "today" is empty again. */
    const ageXP = (id, days = 1) => db.query('UPDATE xp_transactions SET created_at = created_at - INTERVAL ? DAY WHERE discord_id = ?', [days, id]);
    const sumSource = async (id, source) => Number((await db.query('SELECT COALESCE(SUM(amount), 0) AS n FROM xp_transactions WHERE discord_id = ? AND source = ?', [id, source]))[0].n);
    const bonusKeys = (r) => r.bonuses.map((b) => b.key);

    await t.test('bonuses: first task of the day pays once per UTC day, never on re-check', async () => {
        const U = '100000000000000101';
        await db.users.ensureUser(U);
        const { list } = await db.tasks.createList(U, { name: 'Bonus' });
        const ids = [];
        for (const n of ['a', 'b', 'c']) ids.push((await db.tasks.addItem(U, list.id, { name: n })).item.id);
        const first = await db.tasks.setItemCompleted(U, ids[0]);
        assert.deepEqual(first.bonuses, [{ key: 'first_of_day', label: 'First task of the day', xp: 10 }]);
        assert.deepEqual((await db.tasks.setItemCompleted(U, ids[1])).bonuses, [], 'second task the same day pays nothing extra');
        await db.tasks.setItemCompleted(U, ids[0], false);
        const again = await db.tasks.setItemCompleted(U, ids[0], true);
        assert.deepEqual(again.bonuses, [], 'a re-check is not a first completion');
        assert.equal(await sumSource(U, 'first_of_day'), 10);
        await ageXP(U);
        assert.ok(bonusKeys(await db.tasks.setItemCompleted(U, ids[2])).includes('first_of_day'), 'a new day pays again');
    });

    await t.test('bonuses: a list pays LIST_CLEARED once, at most 5 lists a day', async () => {
        const U = '100000000000000102';
        await db.users.ensureUser(U);
        const clear = async (name) => {
            const { list } = await db.tasks.createList(U, { name });
            const items = [];
            for (const n of ['1', '2', '3']) items.push((await db.tasks.addItem(U, list.id, { name: n })).item);
            let last;
            for (const i of items) last = await db.tasks.setItemCompleted(U, i.id);
            return { list, last };
        };
        const { list, last } = await clear('L0');
        assert.ok(bonusKeys(last).includes('list_cleared'));
        assert.equal(last.bonuses.find((b) => b.key === 'list_cleared').xp, 25);
        // Farming attempt: add a task to the cleared list and finish it again.
        const { item } = await db.tasks.addItem(U, list.id, { name: 'again' });
        assert.ok(!bonusKeys(await db.tasks.setItemCompleted(U, item.id)).includes('list_cleared'));
        for (let n = 1; n < 5; n++) assert.ok(bonusKeys((await clear(`L${n}`)).last).includes('list_cleared'));
        assert.ok(!bonusKeys((await clear('L5')).last).includes('list_cleared'), 'the sixth list today pays nothing');
        assert.equal(await sumSource(U, 'list_cleared'), 125);
    });

    await t.test('bonuses: early finish, overdue clear and their shared daily cap', async () => {
        const U = '100000000000000103';
        await db.users.ensureUser(U);
        const { list } = await db.tasks.createList(U, { name: 'Deadlines' });
        let n = 0;
        const add = async (due) => (await db.tasks.addItem(U, list.id, { name: `t${n++}`, due_date: due })).item.id;
        const complete = (id) => db.tasks.setItemCompleted(U, id);

        const soon = await complete(await add(dayOffset(2)));
        assert.equal(soon.bonuses.find((b) => b.key === 'early_finish').xp, 10, '5 XP per day early');
        const far = await complete(await add(dayOffset(30)));
        assert.equal(far.bonuses.find((b) => b.key === 'early_finish').xp, 20, 'capped at 20 per task');
        assert.ok(!bonusKeys(await complete(await add(dayOffset(0)))).some((k) => k === 'early_finish' || k === 'overdue_clear'), 'due today is neither early nor overdue');
        const late = await complete(await add(dayOffset(-3)));
        assert.equal(late.bonuses.find((b) => b.key === 'overdue_clear').xp, 10);

        // Farming attempt: backdated and far-future due dates; the combined cap stops it at 100 XP a day.
        for (let k = 0; k < 8; k++) await complete(await add(k % 2 ? dayOffset(30) : dayOffset(-5)));
        const total = (await sumSource(U, 'early_finish')) + (await sumSource(U, 'overdue_clear'));
        assert.equal(total, 100);
        assert.deepEqual(bonusKeys(await complete(await add(dayOffset(30)))), []);
        await ageXP(U);
        assert.ok(bonusKeys(await complete(await add(dayOffset(30)))).includes('early_finish'), 'the cap resets the next day');
    });

    await t.test('bonuses: finishing the last subtask pays once per parent, 10 XP a day', async () => {
        const U = '100000000000000104';
        await db.users.ensureUser(U);
        const { list } = await db.tasks.createList(U, { name: 'Subs' });
        const family = async (name) => {
            const { item: parent } = await db.tasks.addItem(U, list.id, { name });
            const a = (await db.tasks.addItem(U, list.id, { name: `${name}a`, parent_id: parent.id })).item;
            const b = (await db.tasks.addItem(U, list.id, { name: `${name}b`, parent_id: parent.id })).item;
            return { parent, a, b };
        };
        const one = await family('P1');
        assert.ok(!bonusKeys(await db.tasks.setItemCompleted(U, one.a.id)).includes('subtasks_done'), 'one subtask is still open');
        const done = await db.tasks.setItemCompleted(U, one.b.id);
        assert.equal(done.bonuses.find((b) => b.key === 'subtasks_done').xp, 10);
        await db.tasks.setItemCompleted(U, one.b.id, false);
        assert.ok(!bonusKeys(await db.tasks.setItemCompleted(U, one.b.id, true)).includes('subtasks_done'), 'once per parent');
        const two = await family('P2');
        await db.tasks.setItemCompleted(U, two.a.id);
        assert.ok(!bonusKeys(await db.tasks.setItemCompleted(U, two.b.id)).includes('subtasks_done'), 'the daily 10 XP is used up');
        assert.equal(await sumSource(U, 'subtasks_done'), 10);
        await ageXP(U);
        const three = await family('P3');
        await db.tasks.setItemCompleted(U, three.a.id);
        assert.ok(bonusKeys(await db.tasks.setItemCompleted(U, three.b.id)).includes('subtasks_done'));
    });

    await t.test('bonuses: imported tasks, recurring copies and a capped completion earn none', async () => {
        const U = '100000000000000105';
        await db.users.ensureUser(U);
        await db.transfer.importAll(U, { lists: [{ name: 'Imp', items: [1, 2, 3].map((n) => ({ name: `i${n}`, due_date: dayOffset(20) })) }] });
        const [imp] = await db.tasks.getLists(U);
        for (const i of await db.tasks.getItems(U, imp.id)) {
            assert.deepEqual((await db.tasks.setItemCompleted(U, i.id)).bonuses, []);
        }
        const { list } = await db.tasks.createList(U, { name: 'Rec' });
        const { item } = await db.tasks.addItem(U, list.id, { name: 'daily', recurrence: 'daily', due_date: dayOffset(0) });
        const spawned = (await db.tasks.setItemCompleted(U, item.id)).nextItem;
        assert.ok(spawned);
        await ageXP(U);
        assert.deepEqual((await db.tasks.setItemCompleted(U, spawned.id)).bonuses, [], 'a spawned copy has counts_for_quests = 0');
        // A completion that hit the daily completion cap pays no bonus either.
        const C = '100000000000000106';
        await db.users.ensureUser(C);
        const { list: cl } = await db.tasks.createList(C, { name: 'Cap' });
        const { item: ci } = await db.tasks.addItem(C, cl.id, { name: 'x' });
        await db.query(
            `INSERT INTO xp_transactions (discord_id, amount, source, balance_before, balance_after)
             SELECT ?, 10, 'item_complete', 0, 0 FROM information_schema.COLUMNS LIMIT ${require('../src/constants').LIMITS.ITEM_COMPLETE_REWARDS_PER_DAY}`,
            [C]
        );
        const capped = await db.tasks.setItemCompleted(C, ci.id);
        assert.equal(capped.xp.capped, true);
        assert.deepEqual(capped.bonuses, []);
    });


    await t.test('streak chests: 7, 14 and 30 pay once per streak run, and a reset streak can earn them again', async () => {
        const U = '100000000000000111';
        await db.users.ensureUser(U);
        const setStreak = (streak, hoursAgo = 25) =>
            db.query('UPDATE users SET streak_count = ?, last_daily_claim = UTC_TIMESTAMP() - INTERVAL ? HOUR WHERE discord_id = ?', [streak, hoursAgo, U]);

        await setStreak(5);
        const six = await db.progression.claimDaily(U);
        assert.equal(six.streak, 6);
        assert.equal(six.chest, null);
        assert.equal(six.surpriseBonus, 0);

        await setStreak(6);
        const seven = await db.progression.claimDaily(U);
        assert.deepEqual(seven.chest, { streak: 7, xp: 100 });
        assert.equal(await sumSource(U, 'streak_chest'), 100);
        assert.equal(seven.balance, Number((await db.users.getUser(U)).player_xp), 'the returned balance includes the chest');

        // Farming attempt: rewind the streak by hand and claim again without ever breaking it.
        await setStreak(6);
        assert.equal((await db.progression.claimDaily(U)).chest, null, 'the same milestone does not pay twice in one run');
        assert.equal(await sumSource(U, 'streak_chest'), 100);

        await setStreak(13);
        assert.deepEqual((await db.progression.claimDaily(U)).chest, { streak: 14, xp: 250 });
        await setStreak(29);
        assert.deepEqual((await db.progression.claimDaily(U)).chest, { streak: 30, xp: 600 });
        assert.equal(await sumSource(U, 'streak_chest'), 950);

        // Break the streak (no freeze), then climb to 7 again: a new run, a new chest.
        await setStreak(30, 100);
        const broken = await db.progression.claimDaily(U);
        assert.equal(broken.streak, 1);
        assert.equal(Number((await db.users.getUser(U)).last_chest_streak), 0);
        await setStreak(6);
        assert.deepEqual((await db.progression.claimDaily(U)).chest, { streak: 7, xp: 100 });
        assert.equal(await sumSource(U, 'streak_chest'), 1050);
    });



    await t.test('achievement rewards: +25 XP each, cascading into XP achievements exactly once', async () => {
        const U = '100000000000000121';
        await db.users.ensureUser(U);
        await db.query('UPDATE users SET player_xp = 70, lifetime_xp = 70 WHERE discord_id = ?', [U]);
        // 70 + 10 (list) = 80, FIRST_LIST pays 25 = 105, which crosses 100 lifetime XP: XP_100 pays 25 more.
        const { achievements, list } = await db.tasks.createList(U, { name: 'Cascade' });
        assert.ok(list);
        assert.deepEqual(achievements.map((a) => a.key).sort(), ['FIRST_LIST', 'XP_100']);
        assert.ok(achievements.every((a) => a.xp === 25));
        assert.equal(await sumSource(U, 'achievement_reward'), 50);
        assert.equal(Number((await db.users.getUser(U)).player_xp), 70 + 10 + 50);
        // Nothing unlocks twice, whatever re-checks run.
        assert.deepEqual(await db.progression.checkAchievements(U), []);
        assert.deepEqual(await db.progression.checkAchievements(U), []);
        assert.equal(await sumSource(U, 'achievement_reward'), 50);

        // XP off: the achievement still unlocks but pays nothing.
        const OFF = '100000000000000122';
        await db.users.ensureUser(OFF);
        await db.users.updateSettings(OFF, { gamification_enabled: false });
        const off = await db.tasks.createList(OFF, { name: 'Quiet' });
        assert.deepEqual(off.achievements.map((a) => [a.key, a.xp]), [['FIRST_LIST', 0]]);
        assert.equal(await sumSource(OFF, 'achievement_reward'), 0);
    });

    await t.test('achievement rewards: the total any user can ever earn is bounded by the achievement list', async () => {
        const shared = require('../src');
        const U = '100000000000000123';
        await db.users.ensureUser(U);
        await db.query('UPDATE users SET total_lists_created = 500, total_items_added = 500, total_items_completed = 500, streak_count = 100, lifetime_xp = 100000, player_xp = 100000, player_level = 60 WHERE discord_id = ?', [U]);
        const first = await db.progression.checkAchievements(U);
        assert.ok(first.length > 15);
        assert.equal(await db.progression.checkAchievements(U).then((r) => r.length), 0);
        assert.ok((await sumSource(U, 'achievement_reward')) <= Object.keys(shared.ACHIEVEMENTS).length * shared.REWARDS.ACHIEVEMENT);
    });


    await t.test('habit streaks: on-time completions of a repeating task grow a streak that pays from the third', async () => {
        const U = '100000000000000131';
        await db.users.ensureUser(U);
        const { list } = await db.tasks.createList(U, { name: 'Habits' });
        const { item } = await db.tasks.addItem(U, list.id, { name: 'stretch', recurrence: 'daily', due_date: dayOffset(0) });
        const streakOf = async (id) => Number((await db.query('SELECT habit_streak AS n FROM items WHERE id = ?', [id]))[0].n);
        const dueToday = (id) => db.query('UPDATE items SET due_date = ? WHERE id = ?', [dayOffset(0), id]);

        let r = await db.tasks.setItemCompleted(U, item.id);
        assert.equal(await streakOf(r.nextItem.id), 1, 'the copy carries streak 1');
        assert.ok(!bonusKeys(r).includes('habit_bonus'));
        // Farming attempt: finishing the copy the moment it spawns (a day early) neither grows nor pays.
        const early = await db.tasks.setItemCompleted(U, r.nextItem.id);
        assert.equal(await streakOf(early.nextItem.id), 1, 'carried, not incremented');
        assert.ok(!bonusKeys(early).includes('habit_bonus'));

        // Next day: the copy is due today.
        await dueToday(early.nextItem.id);
        r = await db.tasks.setItemCompleted(U, early.nextItem.id);
        assert.equal(await streakOf(r.nextItem.id), 2);
        assert.ok(!bonusKeys(r).includes('habit_bonus'), 'streak 1 at completion does not pay yet');
        await dueToday(r.nextItem.id);
        r = await db.tasks.setItemCompleted(U, r.nextItem.id);
        assert.equal(r.bonuses.find((b) => b.key === 'habit_bonus').xp, 4, '2 XP x the streak of 2');
        assert.equal(await streakOf(r.nextItem.id), 3);

        // Late completion resets the streak and pays nothing.
        await db.query('UPDATE items SET due_date = ? WHERE id = ?', [dayOffset(-1), r.nextItem.id]);
        const late = await db.tasks.setItemCompleted(U, r.nextItem.id);
        assert.ok(!bonusKeys(late).includes('habit_bonus'));
        assert.equal(await streakOf(late.nextItem.id), 0);
    });

    await t.test('habit streaks: max 20 XP per completion and 60 XP a day', async () => {
        const U = '100000000000000132';
        await db.users.ensureUser(U);
        const { list } = await db.tasks.createList(U, { name: 'Long habits' });
        const results = [];
        for (let n = 0; n < 5; n++) {
            const { item } = await db.tasks.addItem(U, list.id, { name: `h${n}`, recurrence: 'daily', due_date: dayOffset(0) });
            await db.query('UPDATE items SET habit_streak = 40 WHERE id = ?', [item.id]);
            results.push(await db.tasks.setItemCompleted(U, item.id));
        }
        assert.deepEqual(results.map((r) => r.bonuses.find((b) => b.key === 'habit_bonus')?.xp ?? 0), [20, 20, 20, 0, 0]);
        assert.equal(await sumSource(U, 'habit_bonus'), 60);
        await ageXP(U);
        const { item } = await db.tasks.addItem(U, list.id, { name: 'tomorrow', recurrence: 'daily', due_date: dayOffset(0) });
        await db.query('UPDATE items SET habit_streak = 3 WHERE id = ?', [item.id]);
        assert.equal((await db.tasks.setItemCompleted(U, item.id)).bonuses.find((b) => b.key === 'habit_bonus').xp, 6, 'the cap resets the next day');
    });

    await db.closePool();
});
