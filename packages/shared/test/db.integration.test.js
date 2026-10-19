/**
 * Database integration tests. Skipped unless TEST_DB_NAME is set, e.g.
 *
 *   TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=5432 TEST_DB_NAME=tq_test npm test -w @taskquest/shared
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
    process.env.DB_PORT = process.env.TEST_DB_PORT || '5432';
    process.env.DB_USER = process.env.TEST_DB_USER || 'postgres';
    process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || '';
    process.env.DB_NAME = process.env.TEST_DB_NAME;
    process.env.XP_WEEKLY_MODIFIER = 'off'; // the real week would double one bonus source and change the expected amounts
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

/** Pretend a task's due date was set two days ago, so the 24-hour rule for early/overdue effects is met. Returns the id. */
async function ageDue(id) {
    await db.query('UPDATE items SET due_date_set_at = (CURRENT_TIMESTAMP - make_interval(days => 2)) WHERE id = ? AND due_date IS NOT NULL', [id]);
    return id;
}

test('database services', { skip: !enabled && 'set TEST_DB_NAME to run' }, async (t) => {
    const pool = db.getPool();
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
    await db.runMigrations({ log: () => {} });
    await db.assertSchemaCurrent();
    await db.users.ensureUser(ALICE, { username: 'alice', handle: 'alice', avatar: null });
    await db.users.ensureUser(BOB);

    await t.test('the baseline is idempotent and creates every table and column', async () => {
        await pool.query('DELETE FROM schema_migrations'); // pretend it was interrupted
        const fs = require('fs');
        const path = require('path');
        const expected = fs
            .readdirSync(path.join(__dirname, '../src/db/migrations'))
            .filter((f) => /^\d{3}_.+\.js$/.test(f))
            .map((f) => f.replace(/\.js$/, ''))
            .sort();
        assert.ok(expected.includes('001_baseline'), 'found the migration files');
        assert.deepEqual(await db.runMigrations({ log: () => {} }), expected, 'every migration runs again without error');
        const cols = async (table) =>
            (await pool.query('SELECT column_name AS c FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?', [table]))[0].map((r) => r.c);
        const tableExists = async (table) =>
            Number((await pool.query('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?', [table]))[0][0].n) === 1;
        const items = await cols('items');
        for (const c of ['due_date', 'priority', 'tags', 'parent_id', 'recurrence', 'first_completed_at', 'counts_for_quests', 'first_completed_high', 'repeat_anchor_day', 'habit_streak', 'first_completed_early', 'first_completed_overdue', 'due_date_set_at']) {
            assert.ok(items.includes(c), `items.${c}`);
        }
        const users = await cols('users');
        for (const c of ['timezone', 'reminder_hour', 'weekly_digest', 'last_digest_at', 'calendar_token', 'streak_freezes', 'xp_spent', 'owns_bard', 'owns_warden', 'bard_recent', 'alchemist_mix', 'assassin_last_at', 'last_chest_streak', 'prestige', 'lifetime_xp_total']) {
            assert.ok(users.includes(c), `users.${c}`);
        }
        assert.ok(!users.includes('skill_points'), 'users.skill_points was dropped by 002');
        const lists = await cols('lists');
        for (const c of ['remind_at', 'cleared_at']) assert.ok(lists.includes(c), `lists.${c}`);
        for (const table of ['quest_claims', 'focus_sessions', 'xp_transactions_archive', 'game_sessions_archive', 'ai_embeddings']) assert.ok(await tableExists(table), table);
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
        await assert.rejects(db.users.updateSettings(FRANK, { timezone: null }), { code: 'VALIDATION', message: /24 hours/ }, 'a zone change is throttled');
        await db.query('UPDATE users SET timezone_changed_at = NULL WHERE discord_id = ?', [FRANK]);
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

        // Changing the deadline re-arms everything (saving the same date again does not: see the re-arm limits test).
        await db.tasks.updateList(FRANK, today.id, { deadline: '2030-06-09' });
        await db.tasks.updateList(FRANK, today.id, { deadline: '2030-06-10' });
        assert.ok((await ids()).includes(today.id));
    });

    await t.test('task reminders: candidates, list-day overlap, completion, snooze, re-arm', async () => {
        const FRANK = '100000000000000094';
        await db.users.ensureUser(FRANK);
        await db.users.updateSettings(FRANK, { reminder_hour: 7 });
        const now = new Date('2030-07-10T12:00:00Z');
        const { list } = await db.tasks.createList(FRANK, { name: 'task reminders', deadline: '2030-07-10' });
        const add = async (name, extra) => (await db.tasks.addItem(FRANK, list.id, { name, ...extra })).item;
        const dueToday = await add('due today', { due_date: '2030-07-10' });
        const sameAsList = await add('same day as list', { due_date: '2030-07-10' });
        const early = await add('earlier than list', { due_date: '2030-07-09' });
        const noDate = await add('no date');
        const far = await add('far away', { due_date: '2030-08-30' });
        await db.tasks.updateList(FRANK, list.id, { deadline: '2030-07-12' });
        const ids = async (at = now) => (await db.tasks.getTaskReminderCandidates(at)).map((r) => r.id);
        let found = await ids();
        assert.ok(found.includes(dueToday.id) && found.includes(early.id));
        assert.ok(!found.includes(noDate.id) && !found.includes(far.id));
        assert.equal((await db.tasks.getTaskReminderCandidates(now)).find((r) => r.id === dueToday.id).reminder_hour, 7);

        // A task due on its list's deadline day is covered by the list reminder.
        await db.tasks.updateList(FRANK, list.id, { deadline: '2030-07-10' });
        found = await ids();
        assert.ok(!found.includes(dueToday.id) && !found.includes(sameAsList.id) && found.includes(early.id));
        await db.tasks.updateList(FRANK, list.id, { deadline: null });

        await db.tasks.markTaskReminderSent(dueToday.id, now);
        assert.ok(!(await ids()).includes(dueToday.id), 'sent once');

        await db.tasks.setItemCompleted(FRANK, early.id, true);
        assert.ok(!(await ids()).includes(early.id), 'completed tasks are skipped');

        // Snooze is owner-scoped, hides the task until it ends, then fires again.
        await assert.rejects(db.tasks.snoozeTask(BOB, dueToday.id, new Date('2030-07-11T09:00:00Z')), { code: 'NOT_FOUND' });
        await db.tasks.snoozeTask(FRANK, dueToday.id, new Date('2030-07-11T09:00:00Z'));
        assert.ok(!(await ids()).includes(dueToday.id));
        const later = new Date('2030-07-11T10:00:00Z');
        assert.ok((await ids(later)).includes(dueToday.id));
        await db.tasks.markTaskReminderSent(dueToday.id, later);
        assert.ok(!(await ids(later)).includes(dueToday.id));

        // Moving the due date re-arms the reminder.
        await db.tasks.updateItem(FRANK, dueToday.id, { due_date: '2030-07-11' });
        assert.ok((await ids()).includes(dueToday.id));

        // Automation off: nothing is a candidate.
        await db.users.updateSettings(FRANK, { automation_enabled: false });
        assert.deepEqual(await ids(), []);
        await db.users.updateSettings(FRANK, { automation_enabled: true });
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
        await db.query('UPDATE users SET timezone_changed_at = NULL WHERE discord_id = ?', [IVY]);
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

    // Replace the active hand with a fixed one so the outcome is known.
    async function rigHand(id, sessionId, player, dealer, extra = {}) {
        const card = (r) => ({ rank: r, suit: '♠' });
        const [[row]] = await pool.query('SELECT game_data FROM game_sessions WHERE id = ?', [sessionId]);
        const data = typeof row.game_data === 'string' ? JSON.parse(row.game_data) : row.game_data;
        const state = { ...data, deck: [], playerHand: player.map(card), dealerHand: dealer.map(card), finished: false, outcome: null, ...extra };
        await pool.query('UPDATE game_sessions SET game_data = ? WHERE id = ?', [JSON.stringify(state), sessionId]);
    }

    await t.test('an expired untouched blackjack hand is auto-stood and settled, never refunded (no peek-and-abandon)', async () => {
        await setXP(BOB, 1000);
        const fresh = async (bet) => {
            let s = await db.games.startBlackjack(BOB, bet);
            while (s.settlement) s = await db.games.startBlackjack(BOB, bet);
            return s;
        };
        const expire = (id) => pool.query('UPDATE game_sessions SET created_at = created_at - make_interval(hours => 2) WHERE id = ?', [id]);
        // A bad hand that was only looked at at: the player stands on 12 against 18 and loses the bet.
        let s = await fresh(50);
        let before = Number((await db.users.getUser(BOB)).player_xp);
        await rigHand(BOB, s.sessionId, ['10', '2'], ['10', '8']);
        await expire(s.sessionId);
        assert.equal(await db.games.expireStaleSessions(), 1);
        assert.equal(Number((await db.users.getUser(BOB)).player_xp), before, 'no refund');
        assert.equal((await pool.query('SELECT state FROM game_sessions WHERE id = ?', [s.sessionId]))[0][0].state, 'lost');
        assert.equal((await pool.query("SELECT COUNT(*) AS n FROM xp_transactions WHERE reference_id = ? AND source = 'blackjack_refund'", [s.sessionId]))[0][0].n, 0);
        // A good hand pays normally.
        s = await fresh(50);
        before = Number((await db.users.getUser(BOB)).player_xp);
        await rigHand(BOB, s.sessionId, ['10', 'K'], ['10', '7']);
        await expire(s.sessionId);
        await db.games.expireStaleSessions();
        assert.equal(Number((await db.users.getUser(BOB)).player_xp) - before, 100);
    });

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
        await pool.query('UPDATE game_sessions SET created_at = created_at - make_interval(hours => 2) WHERE id = ?', [s.sessionId]);
        assert.equal(await db.games.expireStaleSessions(), 1);
        assert.equal(Number((await db.users.getUser(BOB)).player_xp) - before, 200);
        const [[row]] = await pool.query('SELECT state FROM game_sessions WHERE id = ?', [s.sessionId]);
        assert.equal(row.state, 'won');

        let t2 = await db.games.startBlackjack(BOB, 100);
        while (t2.settlement) t2 = await db.games.startBlackjack(BOB, 100);
        const mid = Number((await db.users.getUser(BOB)).player_xp);
        await rigHand(BOB, t2.sessionId, ['10', '6', '9'], ['10', '8']); // would bust: the bet is lost, not refunded
        await pool.query('UPDATE game_sessions SET created_at = created_at - make_interval(hours => 2) WHERE id = ?', [t2.sessionId]);
        await db.games.expireStaleSessions();
        assert.equal(Number((await db.users.getUser(BOB)).player_xp), mid);
    });

    await t.test('one broken stale session does not stop the others from expiring', async () => {
        const OTHER = '100000000000000603';
        await db.users.ensureUser(OTHER);
        await setXP(BOB, 1000);
        await setXP(OTHER, 1000);
        const fresh = async (who) => {
            let s = await db.games.startBlackjack(who, 50);
            while (s.settlement) s = await db.games.startBlackjack(who, 50);
            return s;
        };
        const broken = await fresh(BOB);
        const good = await fresh(OTHER);
        await pool.query("UPDATE game_sessions SET game_data = '{\"finished\":false}' WHERE id = ?", [broken.sessionId]);
        await pool.query('UPDATE game_sessions SET created_at = created_at - make_interval(hours => 2) WHERE id IN (?, ?)', [broken.sessionId, good.sessionId]);
        const original = console.error;
        console.error = () => {};
        try {
            await db.games.expireStaleSessions();
        } finally {
            console.error = original;
        }
        const state = async (id) => (await pool.query('SELECT state FROM game_sessions WHERE id = ?', [id]))[0][0].state;
        assert.equal(await state(broken.sessionId), 'active', 'the broken row is left alone');
        assert.notEqual(await state(good.sessionId), 'active', 'the healthy one after it still expired');
        await pool.query("UPDATE game_sessions SET state = 'cancelled' WHERE id = ?", [broken.sessionId]);
    });

    await t.test('a game run past the daily cap does not advance class counters', async () => {
        const W = '100000000000000701';
        await db.users.ensureUser(W);
        await pool.query("UPDATE users SET player_class = 'WIZARD', owns_wizard = 1 WHERE discord_id = ?", [W]);
        const user = await db.users.getUser(W);
        const capped = await db.withTransaction((conn) => db.progression.rewardAction(conn, user, 'game_reward', 10, { maxXP: 0, context: { action: 'game' } }));
        assert.equal(capped.capped, true);
        assert.equal(Number((await db.users.getUser(W)).wizard_counter), 0);
        const paid = await db.withTransaction((conn) => db.progression.rewardAction(conn, user, 'game_reward', 10, { maxXP: 100, context: { action: 'game' } }));
        assert.ok(paid.finalXP > 0);
        assert.equal(Number((await db.users.getUser(W)).wizard_counter), 1, 'a paid run still counts');
    });

    await t.test('completing an item that is already completed keeps its completion time', async () => {
        const U = '100000000000000702';
        await db.users.ensureUser(U);
        const { list } = await db.tasks.createList(U, { name: 'Idempotent' });
        const { item } = await db.tasks.addItem(U, list.id, { name: 'Once' });
        await db.tasks.setItemCompleted(U, item.id, true);
        await db.query("UPDATE items SET completed_at = '2020-01-01 00:00:00' WHERE id = ?", [item.id]);
        await db.tasks.setItemCompleted(U, item.id, true);
        const [[row]] = await pool.query('SELECT completed_at FROM items WHERE id = ?', [item.id]);
        assert.equal(new Date(row.completed_at).getUTCFullYear(), 2020, 'a repeat completion must not move the time');
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

    await t.test('arcade runs are verified by replaying the recorded inputs', async () => {
        const { playBot } = require('./helpers/arcadeBots');
        const STEP_MS = { snake: 100, dino: 1000 / 60, invaders: 1000 / 60 };
        const stateOf = async (id) => (await pool.query('SELECT state, game_data FROM game_sessions WHERE id = ?', [id]))[0][0];
        /** Start a run (clearing the cooldown first) and return it with the bot's recorded play for its seed. */
        const begin = async (id, type, target) => {
            await pool.query('UPDATE users SET last_game_at = NULL WHERE discord_id = ?', [id]);
            const run = await db.games.startArcade(id, type);
            return { ...run, play: playBot(type, run.seed, target) };
        };
        /** Pretend the run took as long as playing it takes, plus a little. */
        const age = (run, type, ticks) => pool.query('UPDATE game_sessions SET created_at = created_at - make_interval(secs => ? / 1000000.0) WHERE id = ?', [Math.ceil((ticks * STEP_MS[type] + 500) * 1000), run.sessionId]);
        const claim = (play, patch = {}) => ({ score: play.score, ticks: play.ticks, inputs: play.inputs, ...patch });

        await pool.query('UPDATE users SET last_game_at = NULL WHERE discord_id = ?', [BOB]);
        const first = await db.games.startArcade(BOB, 'snake');
        await assert.rejects(db.games.startArcade(BOB, 'snake'), { code: 'COOLDOWN' });
        assert.ok(Number.isInteger(first.seed) && first.seed > 0, 'the server issues a seed');
        assert.equal(((await stateOf(first.sessionId)).game_data || {}).seed, first.seed, 'and keeps it in game_data');

        // An old client sends only a score: told to refresh, and the run is cancelled.
        await assert.rejects(db.games.finishArcade(BOB, first.sessionId, 10_000), { code: 'VALIDATION', message: /refresh the page/ });
        assert.equal((await stateOf(first.sessionId)).state, 'cancelled');
        await assert.rejects(db.games.finishArcade(BOB, first.sessionId, claim({ score: 0, ticks: 10, inputs: [] })), { code: 'NOT_FOUND' });
        await assert.rejects(db.games.finishArcade(ALICE, first.sessionId, 0), { code: 'NOT_FOUND' });

        // A legitimate recorded run pays on the replayed score, once.
        // CAROL still has her whole daily free-game allowance (BOB's was spent by the cap tests above).
        const good = await begin(CAROL, 'snake', 8); // 8 pellets take at least 5.5 s of play whatever the seed, past the 5 s minimum that pays
        await age(good, 'snake', good.play.ticks);
        const paid = await db.games.finishArcade(CAROL, good.sessionId, claim(good.play));
        assert.equal(paid.score, 8);
        assert.equal(paid.tooShort, false);
        assert.ok(paid.xpGained > 0);
        const done = await stateOf(good.sessionId);
        assert.equal(done.state, 'won');
        assert.deepEqual(done.game_data, { type: 'snake', seed: good.seed, score: 8, ticks: good.play.ticks });
        await assert.rejects(db.games.finishArcade(CAROL, good.sessionId, claim(good.play)), { code: 'NOT_FOUND' }, 'double submit');

        // A valid run under 5 seconds of play is accepted, not cancelled, and pays nothing.
        const quick = await begin(CAROL, 'snake', 1); // one pellet: about 2 s at most, whatever the seed
        assert.ok(quick.play.ticks * STEP_MS.snake < 5000, 'the bot finishes in under 5 s');
        await age(quick, 'snake', quick.play.ticks);
        const brief = await db.games.finishArcade(CAROL, quick.sessionId, claim(quick.play));
        assert.equal(brief.score, 1);
        assert.equal(brief.tooShort, true);
        assert.equal(brief.xpGained, 0);
        assert.equal((await stateOf(quick.sessionId)).state, 'lost', 'not cancelled: it was a real run');

        // A zero-score run is not a win.
        const zero = await begin(BOB, 'dino', 0);
        await age(zero, 'dino', zero.play.ticks);
        const lost = await db.games.finishArcade(BOB, zero.sessionId, claim(zero.play));
        assert.equal(lost.xpGained, 0);
        assert.equal((await stateOf(zero.sessionId)).state, 'lost');

        // Every kind of cheating is rejected and cancels the run for good.
        const rejects = async (label, id, type, build, message) => {
            const run = await begin(id, type, 5);
            const play = run.play;
            if (label !== 'too fast') await age(run, type, play.ticks);
            await assert.rejects(db.games.finishArcade(id, run.sessionId, await build(play, run)), { code: 'VALIDATION', message }, label);
            assert.equal((await stateOf(run.sessionId)).state, 'cancelled', label + ': cancelled');
        };
        await rejects('score edited up', BOB, 'snake', (p) => claim(p, { score: p.score + 1 }), /does not match/);
        await rejects('truncated', BOB, 'dino', (p) => claim(p, { ticks: p.ticks - 1 }), /does not end/);
        await rejects('extended', BOB, 'invaders', (p) => claim(p, { ticks: p.ticks + 30 }), /does not end/);
        await rejects('input after the end', BOB, 'snake', (p) => claim(p, { inputs: [...p.inputs, p.ticks, 1] }), /Invalid input timeline/);
        await rejects('too fast', BOB, 'dino', (p) => claim(p), /faster than real time/);
        await rejects('too long a run', BOB, 'snake', (p) => claim(p, { ticks: 6_001 }), /too long/);
        await rejects('inputs per second', BOB, 'dino', (p) => ({ score: p.score, ticks: p.ticks, inputs: Array.from({ length: 12 }, (_, i) => [i, 1]).flat() }), /faster than a person/);
        await rejects('wrong seed', BOB, 'dino', (p, run) => claim(playBot('dino', run.seed + 7, 5)), /does not (match|end)/);

        // Someone else's recorded run cannot be replayed under a different seed.
        await pool.query('UPDATE users SET last_game_at = NULL WHERE discord_id = ?', [ALICE]);
        const theirs = await db.games.startArcade(ALICE, 'snake');
        const theirPlay = playBot('snake', theirs.seed, 6);
        const mine = await begin(BOB, 'snake', 0);
        await age(mine, 'snake', theirPlay.ticks);
        await assert.rejects(db.games.finishArcade(BOB, mine.sessionId, claim(theirPlay)), { code: 'VALIDATION' });
        await assert.rejects(db.games.finishArcade(BOB, theirs.sessionId, claim(theirPlay)), { code: 'NOT_FOUND' }, 'and not under their session id either');
        assert.equal((await stateOf(theirs.sessionId)).state, 'active', 'their run is untouched');
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
        await db.getPool().query('UPDATE items SET updated_at = updated_at - make_interval(days => 10) WHERE id = ?', [doneItem.id]);
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
        await db.getPool().query("UPDATE items SET first_completed_at = first_completed_at - make_interval(days => 3), completed_at = completed_at - make_interval(days => 3) WHERE id = ?", [a.id]);
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
            await db.getPool().query('UPDATE items SET updated_at = updated_at - make_interval(days => 10) WHERE id = ?', [item.id]);
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

        await db.query("INSERT INTO quest_claims (discord_id, quest_key, period_start, reward_xp) VALUES (?, 'DAILY_ADD_3', CURRENT_DATE, 15)", [CT]);
        await db.users.resetProgress(CT);
        const [claims] = await db.getPool().query('SELECT COUNT(*) AS n FROM quest_claims WHERE discord_id = ?', [CT]);
        assert.equal(Number(claims[0].n), 0, 'a reset lets the same quest be claimed again');
    });

    await t.test('streak board ignores dead streaks; rank respects the class filter', async () => {
        const S1 = '100000000000000015';
        const S2 = '100000000000000016';
        const S3 = '100000000000000017';
        for (const id of [S1, S2, S3]) await db.users.ensureUser(id);
        await db.query("UPDATE users SET streak_count = 30, last_daily_claim = NOW() - make_interval(days => 10), player_class = 'HERO', lifetime_xp = 900 WHERE discord_id = ?", [S1]);
        await db.query("UPDATE users SET streak_count = 4, last_daily_claim = NOW() - make_interval(hours => 1), player_class = 'HERO', lifetime_xp = 800 WHERE discord_id = ?", [S2]);
        await db.query("UPDATE users SET streak_count = 2, last_daily_claim = NOW() - make_interval(hours => 1), player_class = 'WIZARD', lifetime_xp = 700 WHERE discord_id = ?", [S3]);
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
            "UPDATE users SET player_class = 'ASSASSIN', assassin_streak = 6, assassin_stacks = 7, assassin_last_at = NOW() - make_interval(hours => 50) WHERE discord_id = ?",
            [A]
        );
        const { list } = await db.tasks.createList(A, { name: 'Decay' });
        const row = async () => (await db.query('SELECT assassin_streak, assassin_stacks, assassin_last_at FROM users WHERE discord_id = ?', [A]))[0];
        const after = await row();
        assert.equal(after.assassin_streak, 1, 'the 50h-old streak restarted with this action');
        assert.equal(after.assassin_stacks, 0);
        assert.ok(Date.now() - new Date(after.assassin_last_at).getTime() < 60_000);
        await db.tasks.addItem(A, list.id, { name: 'Another' });
        assert.equal((await row()).assassin_streak, 2, 'inside the window it keeps building');
    });

    await t.test('the five newer classes: buy, earn through the real task flow, and the counters reset', async () => {
        const mk = async (id, cls) => {
            await db.users.ensureUser(id);
            await setXP(id, 1000);
            await db.progression.buyClass(id, cls);
            return id;
        };
        const add = async (id, listId, extra = {}) => (await db.tasks.addItem(id, listId, { name: 'task', ...extra })).item.id;

        // Bard: tasks from different lists build a medley that is stored on the account
        const B = await mk('100000000000000301', 'Bard');
        assert.equal((await db.users.getUser(B)).player_class, 'BARD');
        const lists = [];
        for (const n of [1, 2, 3]) lists.push((await db.tasks.createList(B, { name: `Stage ${n}` })).list);
        for (const l of lists) await db.tasks.setItemCompleted(B, await add(B, l.id));
        assert.equal((await db.users.getUser(B)).bard_recent.split(',').length, 3);
        const fourth = await db.tasks.setItemCompleted(B, await add(B, lists[0].id));
        assert.equal(fourth.xp.bonusInfo.type, 'BARD_MEDLEY');
        assert.equal(fourth.xp.bonusInfo.classBonus, 6, 'three different lists: two steps of 3');
        await db.progression.equipClass(B, 'DEFAULT');
        assert.equal((await db.users.getUser(B)).bard_recent, '', 'switching class clears the medley');

        // Alchemist: LOW, MEDIUM and HIGH finish a brew
        const A = await mk('100000000000000302', 'Alchemist');
        const { list: lab } = await db.tasks.createList(A, { name: 'Lab' });
        const low = await db.tasks.setItemCompleted(A, await add(A, lab.id, { priority: 'low' }));
        assert.equal(low.xp.bonusInfo.classBonus, 2);
        const mid = await db.tasks.setItemCompleted(A, await add(A, lab.id, { priority: 'medium' }));
        assert.equal(mid.xp.bonusInfo.classBonus, 4);
        assert.equal(Number((await db.users.getUser(A)).alchemist_mix), 3);
        const brew = await db.tasks.setItemCompleted(A, await add(A, lab.id, { priority: 'high' }));
        assert.equal(brew.xp.bonusInfo.type, 'ALCHEMIST_BREW');
        assert.equal(brew.xp.bonusInfo.classBonus, 30);
        assert.equal(Number((await db.users.getUser(A)).alchemist_mix), 0, 'the brew starts over');

        // Druid: a repeating task is a habit, a plain task is not
        const D = await mk('100000000000000303', 'Druid');
        const { list: grove } = await db.tasks.createList(D, { name: 'Grove' });
        const habit = await db.tasks.setItemCompleted(D, await add(D, grove.id, { recurrence: 'daily' }));
        assert.equal(habit.xp.bonusInfo.type, 'DRUID_HABIT');
        const plain = await db.tasks.setItemCompleted(D, await add(D, grove.id));
        assert.equal(plain.xp.bonusInfo.type, 'DRUID');

        // Chronomancer: the first three tasks after a finished focus session are in the flow
        const C = await mk('100000000000000304', 'Chronomancer');
        await db.query("INSERT INTO focus_sessions (discord_id, started_at, minutes_planned, state, finished_at, minutes_credited, xp) VALUES (?, CURRENT_TIMESTAMP - make_interval(mins => 30), 25, 'finished', CURRENT_TIMESTAMP - make_interval(mins => 5), 25, 15)", [C]);
        const { list: clock } = await db.tasks.createList(C, { name: 'Clock' });
        const types = [];
        for (let i = 0; i < 4; i++) types.push((await db.tasks.setItemCompleted(C, await add(C, clock.id))).xp.bonusInfo.type);
        assert.deepEqual(types, ['CHRONOMANCER_FLOW', 'CHRONOMANCER_FLOW', 'CHRONOMANCER_FLOW', 'CHRONOMANCER'], 'the flow covers three tasks');

        // Warden: people on the list make the bonus
        const W = await mk('100000000000000305', 'Warden');
        const friends = ['100000000000000306', '100000000000000307'];
        for (const f of friends) await db.users.ensureUser(f);
        const { list: hall } = await db.tasks.createList(W, { name: 'Hall' });
        const solo = await db.tasks.setItemCompleted(W, await add(W, hall.id));
        assert.equal(solo.xp.bonusInfo.type, 'WARDEN', 'nobody else on the list');
        for (const f of friends) await db.query('INSERT INTO list_members (list_id, discord_id, role, public_id) VALUES (?, ?, ?, ?)', [hall.id, f, 'editor', require('crypto').randomBytes(6).toString('hex')]);
        const together = await db.tasks.setItemCompleted(W, await add(W, hall.id));
        assert.equal(together.xp.bonusInfo.type, 'WARDEN_SHARED');
        assert.equal(together.xp.bonusInfo.classBonus, 2 + 4, 'two people: 10% of 10 twice, and 2 each');

        // a full progress reset clears the new ownership flags and counters
        await db.query("UPDATE users SET bard_recent = '1,2', alchemist_mix = 5 WHERE discord_id IN (?, ?)", [B, A]);
        for (const id of [B, A, D, C, W]) await db.users.resetProgress(id);
        for (const [id, col] of [[B, 'owns_bard'], [A, 'owns_alchemist'], [D, 'owns_druid'], [C, 'owns_chronomancer'], [W, 'owns_warden']]) {
            const u = await db.users.getUser(id);
            assert.equal(Number(u[col]), 0, col);
            assert.equal(u.player_class, 'DEFAULT');
            assert.equal(u.bard_recent, '');
            assert.equal(Number(u.alchemist_mix), 0);
        }
    });

    await t.test('the weekly modifier doubles the source of the week and nothing else', async () => {
        const shared = require('../src');
        const season = shared.currentSeason(shared.SEASONS, new Date());
        const other = shared.SEASONS.find((s) => s.key !== season.key).doubles;
        const M = '100000000000000401';
        await db.users.ensureUser(M);
        const pay = (source) =>
            db.withTransaction(async (conn) => {
                const user = await db.users.lockUser(conn, M);
                return (await db.progression.awardFlat(conn, user, source, 10)).xp;
            });
        process.env.XP_WEEKLY_MODIFIER = 'on';
        try {
            assert.equal(await pay(season.doubles), 20, `${season.name} doubles ${season.doubles}`);
            assert.equal(await pay(other), 10, 'another source is untouched');
            process.env.XP_WEEKLY_MODIFIER = 'off';
            assert.equal(await pay(season.doubles), 10, 'the operator switch turns it off');
        } finally {
            process.env.XP_WEEKLY_MODIFIER = 'off';
        }
    });

    await t.test('engagement bonuses: perfect day, inbox zero, boss defeated, welcome back and party assist', async () => {
        const shared = require('../src');
        const day = (offset) => {
            const d = new Date(`${shared.todayInZone()}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() + offset);
            return d.toISOString().slice(0, 10);
        };
        const keys = (r) => r.bonuses.map((b) => b.key);
        const add = async (id, listId, extra = {}) => (await db.tasks.addItem(id, listId, { name: 'task', ...extra })).item.id;

        // Perfect day: three tasks due today, all done
        const E = '100000000000000501';
        await db.users.ensureUser(E);
        const { list: plan } = await db.tasks.createList(E, { name: 'Plan' });
        const due = [];
        for (let n = 0; n < 3; n++) due.push(await add(E, plan.id, { due_date: day(0) }));
        assert.ok(!keys(await db.tasks.setItemCompleted(E, due[0])).includes('perfect_day'));
        assert.ok(!keys(await db.tasks.setItemCompleted(E, due[1])).includes('perfect_day'));
        const perfect = await db.tasks.setItemCompleted(E, due[2]);
        assert.equal(perfect.bonuses.find((b) => b.key === 'perfect_day').xp, 30);
        const extra = await add(E, plan.id, { due_date: day(0) });
        assert.ok(!keys(await db.tasks.setItemCompleted(E, extra)).includes('perfect_day'), 'once a day');

        // Inbox zero: three overdue tasks cleared, none left
        const I = '100000000000000502';
        await db.users.ensureUser(I);
        const { list: inbox } = await db.tasks.createList(I, { name: 'Inbox' });
        const stale = [];
        for (let n = 0; n < 3; n++) stale.push(await ageDue(await add(I, inbox.id, { due_date: day(-3) })));
        assert.ok(!keys(await db.tasks.setItemCompleted(I, stale[0])).includes('inbox_zero'));
        assert.ok(!keys(await db.tasks.setItemCompleted(I, stale[1])).includes('inbox_zero'));
        assert.equal((await db.tasks.setItemCompleted(I, stale[2])).bonuses.find((b) => b.key === 'inbox_zero').xp, 40);
        const again = await ageDue(await add(I, inbox.id, { due_date: day(-2) }));
        assert.ok(!keys(await db.tasks.setItemCompleted(I, again)).includes('inbox_zero'), 'once a week');

        // Boss defeated: a task with 4 subtasks, all done; 3 subtasks is no boss
        const B = '100000000000000503';
        await db.users.ensureUser(B);
        const { list: dungeon } = await db.tasks.createList(B, { name: 'Dungeon' });
        const boss = await add(B, dungeon.id, { name: 'Boss' });
        const minions = [];
        for (let n = 0; n < 4; n++) minions.push(await add(B, dungeon.id, { parent_id: boss }));
        for (const m of minions.slice(0, 3)) assert.ok(!keys(await db.tasks.setItemCompleted(B, m)).includes('boss_defeated'));
        const slain = await db.tasks.setItemCompleted(B, minions[3]);
        assert.equal(slain.bonuses.find((b) => b.key === 'boss_defeated').xp, 30);
        const small = await add(B, dungeon.id, { name: 'Imp' });
        const imps = [];
        for (let n = 0; n < 3; n++) imps.push(await add(B, dungeon.id, { parent_id: small }));
        let last;
        for (const m of imps) last = await db.tasks.setItemCompleted(B, m);
        assert.ok(!keys(last).includes('boss_defeated'), 'three subtasks is not a boss');

        // Welcome back: the first completion after three idle days
        const W = '100000000000000504';
        await db.users.ensureUser(W);
        const { list: home } = await db.tasks.createList(W, { name: 'Home' });
        assert.ok(!keys(await db.tasks.setItemCompleted(W, await add(W, home.id))).includes('comeback'));
        await db.query("UPDATE xp_transactions SET created_at = (created_at - make_interval(days => 5)) WHERE discord_id = ? AND source = 'item_complete'", [W]);
        assert.equal((await db.tasks.setItemCompleted(W, await add(W, home.id))).bonuses.find((b) => b.key === 'comeback').xp, 25);
        assert.ok(!keys(await db.tasks.setItemCompleted(W, await add(W, home.id))).includes('comeback'), 'only after a break');

        // Party assist: in a party of two or more
        const P = '100000000000000505';
        const Q = '100000000000000506';
        await db.users.ensureUser(P);
        await db.users.ensureUser(Q);
        const { list: camp } = await db.tasks.createList(P, { name: 'Camp' });
        assert.ok(!keys(await db.tasks.setItemCompleted(P, await add(P, camp.id))).includes('party_assist'), 'no party');
        await db.query("INSERT INTO parties (name, owner_id) VALUES ('Crew', ?)", [P]);
        const crew = (await db.query("SELECT id FROM parties WHERE owner_id = ? AND name = 'Crew'", [P]))[0];
        await db.query('INSERT INTO party_members (party_id, discord_id) VALUES (?, ?), (?, ?)', [crew.id, P, crew.id, Q]);
        assert.equal((await db.tasks.setItemCompleted(P, await add(P, camp.id))).bonuses.find((b) => b.key === 'party_assist').xp, 3);
    });

    await t.test('daily reflection and weekly goal: pay once, flat, and cannot be gamed', async () => {
        const R = '100000000000000801';
        await db.users.ensureUser(R);

        // reflection: once a day, validated, and paid flat
        assert.equal((await db.goals.getReflection(R)).reflection, null);
        await assert.rejects(db.goals.writeReflection(R, '   '), { code: 'VALIDATION' });
        await assert.rejects(db.goals.writeReflection(R, 'x'.repeat(201)), { code: 'VALIDATION' });
        const first = await db.goals.writeReflection(R, 'Finished the hard thing first.');
        assert.equal(first.xp, 10);
        assert.equal((await db.goals.getReflection(R)).reflection.note, 'Finished the hard thing first.');
        await assert.rejects(db.goals.writeReflection(R, 'again'), { code: 'CONFLICT' });
        assert.equal((await db.query("SELECT COALESCE(SUM(amount), 0) AS n FROM xp_transactions WHERE discord_id = ? AND source = 'reflection'", [R]))[0].n, 10);
        // with XP off the note is kept and nothing is paid
        const Z = '100000000000000802';
        await db.users.ensureUser(Z);
        await db.query('UPDATE users SET gamification_enabled = 0 WHERE discord_id = ?', [Z]);
        assert.equal((await db.goals.writeReflection(Z, 'quiet day')).xp, 0);

        // weekly goal: set above your progress, finish, claim once
        const empty = await db.goals.getGoal(R);
        assert.deepEqual([empty.target, empty.progress, empty.claimed, empty.claimable, empty.min, empty.max], [null, 0, false, false, 3, 60]);
        await assert.rejects(db.goals.setGoal(R, 2), { code: 'VALIDATION' });
        await assert.rejects(db.goals.setGoal(R, 61), { code: 'VALIDATION' });
        await assert.rejects(db.goals.setGoal(R, 3.5), { code: 'VALIDATION' });
        await assert.rejects(db.goals.claimGoal(R), { code: 'VALIDATION' }, 'no goal yet');
        const set = await db.goals.setGoal(R, 3);
        assert.deepEqual([set.target, set.reward], [3, 16]);
        assert.equal((await db.goals.setGoal(R, 4)).target, 4, 'the target can change while it is open');
        await db.goals.setGoal(R, 3);
        await assert.rejects(db.goals.claimGoal(R), { code: 'VALIDATION' }, 'not there yet');
        const { list } = await db.tasks.createList(R, { name: 'Week' });
        for (let n = 0; n < 3; n++) await db.tasks.setItemCompleted(R, (await db.tasks.addItem(R, list.id, { name: `t${n}` })).item.id);
        const done = await db.goals.getGoal(R);
        assert.deepEqual([done.progress, done.claimable], [3, true]);
        await assert.rejects(db.goals.setGoal(R, 3), { code: 'VALIDATION' }, 'a goal at or below your progress is refused');
        const claimed = await db.goals.claimGoal(R);
        assert.equal(claimed.xp, 16);
        await assert.rejects(db.goals.claimGoal(R), { code: 'CONFLICT' });
        await assert.rejects(db.goals.setGoal(R, 10), { code: 'CONFLICT' }, 'a claimed goal is closed');
        assert.equal(db.goals.goalReward(60), 80, 'the reward is capped at 80');
        assert.equal(db.goals.goalReward(5), 20);
    });

    await t.test('estimates: validated, exported, and a good guess after a focus session pays a bonus', async () => {
        const U = '100000000000000901';
        await db.users.ensureUser(U);
        const { list } = await db.tasks.createList(U, { name: 'Estimates' });
        await assert.rejects(db.tasks.addItem(U, list.id, { name: 'bad', estimate_minutes: 0 }), { code: 'VALIDATION' });
        await assert.rejects(db.tasks.addItem(U, list.id, { name: 'bad', estimate_minutes: 601 }), { code: 'VALIDATION' });
        await assert.rejects(db.tasks.addItem(U, list.id, { name: 'bad', estimate_minutes: 2.5 }), { code: 'VALIDATION' });
        const guess = (await db.tasks.addItem(U, list.id, { name: 'exact', estimate_minutes: 25 })).item;
        assert.equal(guess.estimate_minutes, 25);
        const off = (await db.tasks.addItem(U, list.id, { name: 'way off', estimate_minutes: 60 })).item.id;
        const close = (await db.tasks.addItem(U, list.id, { name: 'close', estimate_minutes: 20 })).item.id;
        const none = (await db.tasks.addItem(U, list.id, { name: 'no estimate' })).item.id;
        assert.equal((await db.tasks.updateItem(U, close, { estimate_minutes: 20 })).estimate_minutes, 20);
        const exported = await db.transfer.exportAll(U);
        assert.deepEqual(exported.lists[0].items.map((i) => i.estimate_minutes), [25, 60, 20, null]);

        const keys = (r) => r.bonuses.map((b) => b.key);
        // no focus session yet
        assert.ok(!keys(await db.tasks.setItemCompleted(U, none)).includes('estimate_accuracy'));
        await db.query("INSERT INTO focus_sessions (discord_id, started_at, minutes_planned, state, finished_at, minutes_credited, xp) VALUES (?, CURRENT_TIMESTAMP - make_interval(mins => 30), 25, 'finished', CURRENT_TIMESTAMP - make_interval(mins => 3), 25, 15)", [U]);
        assert.ok(!keys(await db.tasks.setItemCompleted(U, off)).includes('estimate_accuracy'), '60 minutes against a 25 minute session');
        assert.equal((await db.tasks.setItemCompleted(U, guess.id)).bonuses.find((b) => b.key === 'estimate_accuracy').xp, 10);
        assert.equal((await db.tasks.setItemCompleted(U, close)).bonuses.find((b) => b.key === 'estimate_accuracy').xp, 10, '25% off is still inside the tolerance');
    });

    await t.test('skill respec: 75% of a tree comes back as a refund, once a day, never lifetime XP', async () => {
        const R = '100000000000000902';
        await db.users.ensureUser(R);
        await setXP(R, 3000);
        await db.progression.buyClass(R, 'Hero');
        await assert.rejects(db.progression.respecSkills(R, 'hero'), { code: 'CONFLICT' }, 'no skills yet');
        await assert.rejects(db.progression.respecSkills(R, 'nope'), { code: 'NOT_FOUND' });
        await db.progression.unlockSkill(R, 'hero_valor');
        await db.progression.unlockSkill(R, 'hero_valor');
        await db.progression.unlockSkill(R, 'hero_inspire');
        const before = await db.users.getUser(R);
        const spent = 100 + 100 + 150;
        const r = await db.progression.respecSkills(R, 'HERO');
        assert.deepEqual([r.spent, r.refund, r.percent], [spent, Math.floor(spent * 0.75), 75]);
        assert.deepEqual(r.removed.sort(), ['hero_inspire', 'hero_valor']);
        const after = await db.users.getUser(R);
        assert.equal(Number(after.player_xp), Number(before.player_xp) + r.refund);
        assert.equal(Number(after.lifetime_xp), Number(before.lifetime_xp), 'a refund is not lifetime XP');
        assert.equal(Number(after.xp_spent), Number(before.xp_spent), 'the spending total is unchanged');
        assert.equal((await db.users.getUserSkills(R)).length, 0);
        // once a day
        await db.progression.unlockSkill(R, 'hero_valor');
        await assert.rejects(db.progression.respecSkills(R, 'HERO'), { code: 'COOLDOWN' });
        await db.query("UPDATE xp_transactions SET created_at = (created_at - make_interval(days => 2)) WHERE discord_id = ? AND source = 'skill_refund'", [R]);
        assert.equal((await db.progression.respecSkills(R, 'HERO')).refund, 75);

        // Freeze Cache cannot be dropped while more than 3 freezes are held
        await db.progression.unlockSkill(R, 'default_xp_boost');
        await db.progression.unlockSkill(R, 'default_daily_boost');
        await db.progression.unlockSkill(R, 'default_streak_shield');
        await db.progression.unlockSkill(R, 'default_freeze_cache');
        await db.query('UPDATE users SET streak_freezes = 5 WHERE discord_id = ?', [R]);
        await db.query("UPDATE xp_transactions SET created_at = (created_at - make_interval(days => 2)) WHERE discord_id = ? AND source = 'skill_refund'", [R]);
        await assert.rejects(db.progression.respecSkills(R, 'DEFAULT'), { code: 'VALIDATION' });
        await db.query('UPDATE users SET streak_freezes = 3 WHERE discord_id = ?', [R]);
        assert.ok((await db.progression.respecSkills(R, 'DEFAULT')).refund > 0);
    });

    await t.test('the Today read: what needs doing, counts, the weekly modifier and the streak', async () => {
        const shared = require('../src');
        const day = (offset) => {
            const d = new Date(`${shared.todayInZone()}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() + offset);
            return d.toISOString().slice(0, 10);
        };
        const Y = '100000000000000903';
        await db.users.ensureUser(Y);
        const empty = await db.today.getToday(Y);
        assert.deepEqual([empty.tasks.length, empty.counts.dueToday, empty.counts.overdue, empty.counts.doneToday], [0, 0, 0, 0]);
        assert.equal(empty.day, shared.todayInZone());
        assert.deepEqual(Object.keys(empty.season).sort(), ['blurb', 'doubles', 'enabled', 'key', 'name']);
        assert.equal(empty.streak.atRisk, false);
        assert.equal(empty.goal.target, null);
        assert.equal(empty.reflection.reflection, null);

        const { list } = await db.tasks.createList(Y, { name: 'Today' });
        const add = async (extra) => (await db.tasks.addItem(Y, list.id, { name: 'task', ...extra })).item.id;
        const late = await add({ name: 'late', due_date: day(-2) });
        const now = await add({ name: 'now', due_date: day(0) });
        const urgent = await add({ name: 'urgent', priority: 'high' });
        await add({ name: 'later', due_date: day(5) });
        await add({ name: 'whenever' });
        const done = await add({ name: 'done', due_date: day(0) });
        await db.tasks.setItemCompleted(Y, done);
        const sub = await add({ name: 'sub', due_date: day(0), parent_id: now });
        assert.ok(sub);

        const r = await db.today.getToday(Y);
        assert.deepEqual(r.tasks.map((x) => x.name), ['late', 'now', 'urgent'], 'overdue first, then today, then HIGH without a date');
        assert.deepEqual(r.tasks.map((x) => x.overdueDays), [2, 0, 0]);
        assert.deepEqual([r.counts.dueToday, r.counts.overdue, r.counts.doneToday], [1, 1, 1], 'subtasks and finished tasks are not counted');
        assert.equal(r.tasks[0].id, late);
        assert.equal(r.tasks[2].id, urgent);

        // the streak: claimed today is safe; a streak last claimed yesterday has until the end of today
        await db.query('UPDATE users SET streak_count = 5, last_daily_claim = CURRENT_TIMESTAMP WHERE discord_id = ?', [Y]);
        const safe = (await db.today.getToday(Y)).streak;
        assert.deepEqual([safe.live, safe.claimedToday, safe.atRisk], [5, true, false]);
        await db.query('UPDATE users SET last_daily_claim = CURRENT_TIMESTAMP - make_interval(days => 1) WHERE discord_id = ?', [Y]);
        const risky = (await db.today.getToday(Y)).streak;
        assert.deepEqual([risky.live, risky.claimedToday, risky.daysLeft, risky.atRisk], [5, false, 0, true]);
        await db.query('UPDATE users SET last_daily_claim = CURRENT_TIMESTAMP - make_interval(days => 3) WHERE discord_id = ?', [Y]);
        assert.equal((await db.today.getToday(Y)).streak.live, 0, 'a lapsed streak reads 0');
    });

    await t.test('ownership transfer: the list moves, the old owner stays as a manager, and limits hold', async () => {
        const O = '100000000000000911';
        const N = '100000000000000912';
        const X = '100000000000000913';
        for (const id of [O, N, X]) await db.users.ensureUser(id);
        const member = (listId, userId, role = 'editor') =>
            db.query('INSERT INTO list_members (list_id, discord_id, role, public_id) VALUES (?, ?, ?, ?)', [listId, userId, role, require('crypto').randomBytes(6).toString('hex')]);
        const keyOf = async (listId, who) => (await db.sharing.listMembers(O, listId)).members.find((m) => m.name === who);
        await db.query('UPDATE users SET discord_username = ? WHERE discord_id = ?', ['newbie', N]);
        await db.query('UPDATE users SET discord_username = ? WHERE discord_id = ?', ['ownerboss', O]);

        const { list } = await db.tasks.createList(O, { name: 'Handover' });
        await db.tasks.addItem(O, list.id, { name: 'a task' });
        await member(list.id, N);
        const row = await keyOf(list.id, 'newbie');

        // only the owner, and only to a member
        await assert.rejects(db.sharing.transferOwnership(N, list.id, row.memberKey), { code: 'FORBIDDEN' });
        await assert.rejects(db.sharing.transferOwnership(O, list.id, 'abcdefabcdef'), { code: 'NOT_FOUND' });
        await assert.rejects(db.sharing.transferOwnership(O, list.id, 'owner'), { code: 'NOT_FOUND' });

        // a clashing name blocks it
        await db.tasks.createList(N, { name: 'Handover' });
        await assert.rejects(db.sharing.transferOwnership(O, list.id, row.memberKey), { code: 'CONFLICT' });
        await db.query("UPDATE lists SET name = 'Mine' WHERE discord_id = ? AND name = 'Handover'", [N]);

        const done = await db.sharing.transferOwnership(O, list.id, row.memberKey);
        assert.equal(done.role, 'manager');
        const owner = (await db.query('SELECT discord_id FROM lists WHERE id = ?', [list.id]))[0];
        assert.equal(owner.discord_id, N, 'the list now belongs to the member');
        const after = await db.sharing.listMembers(N, list.id);
        assert.equal(after.isOwner, true);
        assert.deepEqual(after.members.map((m) => [m.name, m.role, m.isOwner]), [['newbie', 'manager', true], ['ownerboss', 'manager', false]]);
        // the old owner can still open it, as a manager, but can no longer hand it over or delete it
        assert.equal((await db.sharing.listMembers(O, list.id)).role, 'manager');
        await assert.rejects(db.sharing.transferOwnership(O, list.id, (await db.sharing.listMembers(N, list.id)).members[1].memberKey), { code: 'FORBIDDEN' });
        assert.equal((await db.query('SELECT COUNT(*) AS n FROM list_members WHERE list_id = ? AND discord_id = ?', [list.id, N]))[0].n, 0, 'the new owner is not also a member');

        // it can go back
        const back = (await db.sharing.listMembers(N, list.id)).members.find((m) => m.name === 'ownerboss');
        await db.sharing.transferOwnership(N, list.id, back.memberKey);
        assert.equal((await db.query('SELECT discord_id FROM lists WHERE id = ?', [list.id]))[0].discord_id, O);
        void X;
    });

    await t.test('a hand-over and the new owner adding tasks at the same moment both finish', async () => {
        const A = '100000000000000931';
        const B = '100000000000000932';
        for (const id of [A, B]) await db.users.ensureUser(id);
        await db.query('UPDATE users SET discord_username = ? WHERE discord_id = ?', ['handoverb', B]);
        const { list } = await db.tasks.createList(A, { name: 'Race' });
        const { list: mine } = await db.tasks.createList(B, { name: 'Race mine' });
        await db.query('INSERT INTO list_members (list_id, discord_id, role, public_id) VALUES (?, ?, ?, ?)', [list.id, B, 'editor', require('crypto').randomBytes(6).toString('hex')]);
        const key = (await db.sharing.listMembers(A, list.id)).members.find((m) => m.name === 'handoverb').memberKey;

        // The new owner is adding to their own quest and to the shared one while the owner hands it over. The hand-over locks
        // the new owner's account before the list (the order everything else uses), so nothing deadlocks or fails.
        const work = [db.sharing.transferOwnership(A, list.id, key)];
        for (let i = 0; i < 6; i++) work.push(db.tasks.addItem(B, i % 2 ? mine.id : list.id, { name: `race ${i}` }));
        const settled = await Promise.allSettled(work);
        assert.deepEqual(settled.filter((r) => r.status === 'rejected').map((r) => r.reason.message), [], 'every call finished');
        assert.equal((await db.query('SELECT discord_id FROM lists WHERE id = ?', [list.id]))[0].discord_id, B, 'the list moved');
        assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM items WHERE list_id IN (?, ?)', [list.id, mine.id]))[0].n), 6, 'all six tasks exist');
    });

    await t.test('party board and the focus quest: minutes together, a board, one claim a week each', async () => {
        const P = '100000000000000921';
        const Q = '100000000000000922';
        for (const id of [P, Q]) await db.users.ensureUser(id);
        await db.query("UPDATE users SET discord_username = 'pia' WHERE discord_id = ?", [P]);
        await db.query("UPDATE users SET discord_username = 'quinn' WHERE discord_id = ?", [Q]);
        await db.query("INSERT INTO parties (name, owner_id) VALUES ('Deep Work', ?)", [P]);
        const party = (await db.query("SELECT id FROM parties WHERE owner_id = ? AND name = 'Deep Work'", [P]))[0];
        await db.query('INSERT INTO party_members (party_id, discord_id) VALUES (?, ?), (?, ?)', [party.id, P, party.id, Q]);
        const focus = (id, minutes) =>
            db.query("INSERT INTO focus_sessions (discord_id, started_at, minutes_planned, state, finished_at, minutes_credited, xp) VALUES (?, CURRENT_TIMESTAMP, ?, 'finished', CURRENT_TIMESTAMP, ?, 0)", [id, minutes, minutes]);

        const none = (await db.parties.status(P)).focusQuest;
        assert.deepEqual([none.progress, none.target, none.reached, none.claimable], [0, 60, false, false]);
        await focus(P, 60);
        await focus(Q, 30);
        const some = await db.parties.status(P);
        assert.deepEqual([some.focusQuest.progress, some.focusQuest.target, some.focusQuest.yourMinutes], [90, 120, 60], 'two members focused, so the target is 2 x 60');
        await assert.rejects(db.parties.claimFocus(P), { code: 'VALIDATION' }, 'not there yet');

        // a task finished by Q puts Q on top of the board on tasks, then minutes break ties
        const { list } = await db.tasks.createList(Q, { name: 'Board' });
        await db.tasks.setItemCompleted(Q, (await db.tasks.addItem(Q, list.id, { name: 'one' })).item.id);
        const board = (await db.parties.status(P)).board;
        assert.deepEqual(board.map((r) => [r.rank, r.name, r.count, r.focusMinutes, r.isYou]), [[1, 'quinn', 1, 30, false], [2, 'pia', 0, 60, true]]);

        await focus(Q, 30);
        const done = (await db.parties.status(Q)).focusQuest;
        assert.deepEqual([done.progress, done.reached, done.claimable, done.reward, done.minToClaim], [120, true, true, 40, 20]);
        assert.equal((await db.parties.claimFocus(P)).xp, 40);
        await assert.rejects(db.parties.claimFocus(P), { code: 'CONFLICT' });
        assert.equal((await db.parties.status(P)).focusQuest.claimed, true);
        assert.equal((await db.parties.claimFocus(Q)).xp, 40);
        assert.equal((await db.parties.status(Q)).claimed, false, 'the task quest is separate and still open');

        // someone with under 20 minutes of their own cannot claim
        const S = '100000000000000923';
        await db.users.ensureUser(S);
        await db.query('INSERT INTO party_members (party_id, discord_id) VALUES (?, ?)', [party.id, S]);
        await focus(S, 5);
        await focus(P, 60);
        await assert.rejects(db.parties.claimFocus(S), { code: 'VALIDATION' });
    });

    await t.test('streak warnings: only a live streak whose last day it is, in the evening, once a day', async () => {
        const W = '100000000000000931';
        await db.users.ensureUser(W);
        await db.query("UPDATE users SET streak_count = 6, last_daily_claim = CURRENT_TIMESTAMP - make_interval(days => 1), automation_enabled = 1, gamification_enabled = 1, timezone = NULL WHERE discord_id = ?", [W]);
        const at = (hour) => new Date(`${require('../src').todayInZone()}T${String(hour).padStart(2, '0')}:30:00Z`);
        const ids = async (hour) => (await db.today.getStreakWarnings(at(hour))).map((w) => w.discord_id);

        assert.ok(!(await ids(10)).includes(W), 'not in the morning');
        assert.ok((await ids(19)).includes(W), 'in the evening of the last day');
        const w = (await db.today.getStreakWarnings(at(19))).find((x) => x.discord_id === W);
        assert.deepEqual([w.streak, w.day], [6, require('../src').todayInZone()]);

        // claimed once: the same day is closed to a second run
        assert.equal(await db.today.claimStreakWarning(W, w.day), true);
        assert.equal(await db.today.claimStreakWarning(W, w.day), false);
        assert.ok(!(await ids(20)).includes(W), 'warned already today');
        await db.today.releaseStreakWarning(W, w.day);
        assert.ok((await ids(20)).includes(W), 'a released warning can be sent again');

        // not at risk: claimed today, a short streak, reminders off, XP off, or a streak that has lapsed
        await db.query('UPDATE users SET last_daily_claim = CURRENT_TIMESTAMP WHERE discord_id = ?', [W]);
        assert.ok(!(await ids(20)).includes(W), 'already claimed today');
        await db.query('UPDATE users SET last_daily_claim = CURRENT_TIMESTAMP - make_interval(days => 1), streak_count = 2 WHERE discord_id = ?', [W]);
        assert.ok(!(await ids(20)).includes(W), 'under 3 days');
        await db.query('UPDATE users SET streak_count = 6, automation_enabled = 0 WHERE discord_id = ?', [W]);
        assert.ok(!(await ids(20)).includes(W), 'reminders off');
        await db.query('UPDATE users SET automation_enabled = 1, gamification_enabled = 0 WHERE discord_id = ?', [W]);
        assert.ok(!(await ids(20)).includes(W), 'XP off');
        await db.query('UPDATE users SET gamification_enabled = 1, last_daily_claim = CURRENT_TIMESTAMP - make_interval(days => 3) WHERE discord_id = ?', [W]);
        assert.ok(!(await ids(20)).includes(W), 'the streak already lapsed');
    });

    await t.test('maintenance: the XP log records the class, old rows move to the archive, and the class report reads real XP', async () => {
        const A = '100000000000000941';
        await db.users.ensureUser(A);
        await setXP(A, 700);
        await db.progression.buyClass(A, 'Hero');
        const { list } = await db.tasks.createList(A, { name: 'Report' });
        for (let n = 0; n < 3; n++) await db.tasks.setItemCompleted(A, (await db.tasks.addItem(A, list.id, { name: `t${n}` })).item.id);
        const classes = (await db.query("SELECT DISTINCT player_class FROM xp_transactions WHERE discord_id = ? AND source = 'item_complete'", [A])).map((r) => r.player_class);
        assert.deepEqual(classes, ['HERO'], 'the class at the time is stored with the XP');

        const report = await db.maintenance.xpByClass({ days: 1 });
        const hero = report.find((r) => r.playerClass === 'HERO' && r.source === 'item_complete');
        assert.ok(hero && hero.rewards >= 3 && hero.average >= 35, 'a Hero task pays at least 35');
        assert.ok(report.every((r) => db.maintenance.MODIFIED_SOURCES.includes(r.source)), 'only the sources a class reshapes are reported');

        // archive: old rows move, recent ones stay, a dry run changes nothing, and the move can be repeated
        await db.query("UPDATE xp_transactions SET created_at = (created_at - make_interval(days => 400)) WHERE discord_id = ? AND source = 'item_add'", [A]);
        const old = Number((await db.query("SELECT COUNT(*) AS n FROM xp_transactions WHERE discord_id = ? AND created_at < (CURRENT_TIMESTAMP - make_interval(days => 365))", [A]))[0].n);
        assert.ok(old >= 3);
        const dry = await db.maintenance.archiveOld({ days: 365, dryRun: true });
        assert.ok(dry.dryRun && dry.xpTransactions >= old && dry.gameSessions === null);
        assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM xp_transactions_archive WHERE discord_id = ?', [A]))[0].n), 0, 'a dry run moves nothing');
        const moved = await db.maintenance.archiveOld({ days: 365, batch: 2 });
        assert.ok(moved.xpTransactions >= old, 'rows are moved in batches of 2 until none are left');
        assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM xp_transactions_archive WHERE discord_id = ?', [A]))[0].n), old);
        assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM xp_transactions WHERE discord_id = ? AND source = 'item_add'", [A]))[0].n), 0);
        assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM xp_transactions WHERE discord_id = ? AND source = 'item_complete'", [A]))[0].n), 3, 'recent rows stay');
        assert.equal((await db.maintenance.archiveOld({ days: 365 })).xpTransactions, 0, 'nothing is left to move');
        assert.equal((await db.query("SELECT player_class FROM xp_transactions_archive WHERE discord_id = ? LIMIT 1", [A]))[0].player_class, 'HERO');
        await assert.rejects(db.maintenance.archiveOld({ days: 0 }), /days/);
        await assert.rejects(db.maintenance.archiveOld({ batch: 0 }), /batch/);

        // game sessions only on request, and never an active one
        await db.query("INSERT INTO game_sessions (discord_id, game_type, bet_amount, state, payout, created_at) VALUES (?, 'rps', 0, 'won', 0, (CURRENT_TIMESTAMP - make_interval(days => 500))), (?, 'rps', 0, 'active', 0, (CURRENT_TIMESTAMP - make_interval(days => 500)))", [A, A]);
        assert.equal((await db.maintenance.archiveOld({ days: 365 })).gameSessions, null, 'not touched without the option');
        const games = await db.maintenance.archiveOld({ days: 365, games: true });
        assert.equal(games.gameSessions, 1, 'the finished session moves, the active one stays');
        assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM game_sessions WHERE discord_id = ? AND state = 'active'", [A]))[0].n), 1);
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
        // list create + 3 adds + 3 completions = 7 progress: 7 * 2 + 7 * 6
        assert.equal(last.xp.bonusInfo.classBonus, 14 + 42);
        u = await db.users.getUser(R);
        assert.equal(Number(u.artisan_progress), 3, 'a finished project keeps half of its progress');

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
        const make = async (name, due_date) => ageDue((await db.tasks.addItem(G, list.id, { name, due_date })).item.id);
        const early = await db.tasks.setItemCompleted(G, await make('early', day(3)));
        assert.equal(early.xp.bonusInfo.type, 'RANGER_EARLY');
        assert.equal(early.xp.bonusInfo.classBonus, 3 + 9, '3 days early on a 10 XP task');
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
        const add = async (name, due_date) => ageDue((await db.tasks.addItem(N, list.id, { name, due_date })).item.id);
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
        assert.equal((await db.tasks.setItemCompleted(P, easy)).xp.bonusInfo.classBonus, 8);

        // only the first 3 HIGH completions of the day count as HIGH: the 4th pays like any other task
        const more = [];
        for (const name of ['h2', 'h3', 'h4']) more.push((await db.tasks.addItem(P, list.id, { name, priority: 'high' })).item.id);
        assert.equal((await db.tasks.setItemCompleted(P, more[0])).xp.bonusInfo.type, 'PALADIN_VOW');
        assert.equal((await db.tasks.setItemCompleted(P, more[1])).xp.bonusInfo.type, 'PALADIN_VOW');
        assert.equal((await db.tasks.setItemCompleted(P, more[2])).xp.bonusInfo.type, 'PALADIN', 'the 4th HIGH of the day is not a Vow');

        // streak board: a Paladin 60h after the last claim still has a live streak, a Default player does not
        const P2 = '100000000000000211';
        await db.users.ensureUser(P2);
        await db.query("UPDATE users SET streak_count = 6, last_daily_claim = NOW() - make_interval(hours => 60), player_class = 'PALADIN' WHERE discord_id = ?", [P2]);
        const D = '100000000000000212';
        await db.users.ensureUser(D);
        await db.query("UPDATE users SET streak_count = 6, last_daily_claim = NOW() - make_interval(hours => 60) WHERE discord_id = ?", [D]);
        const board = await db.users.getLeaderboard(100, { by: 'streak' });
        assert.ok(board.some((r) => r.discord_id === P2), 'a Paladin streak survives 60h');
        assert.ok(!board.some((r) => r.discord_id === D), 'the same streak is dead for a Default player');
        await db.query("UPDATE users SET last_daily_claim = NOW() - make_interval(hours => 80) WHERE discord_id = ?", [P2]);
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
    const ageXP = (id, days = 1) => db.query('UPDATE xp_transactions SET created_at = created_at - make_interval(days => ?) WHERE discord_id = ?', [days, id]);
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
        const add = async (due) => ageDue((await db.tasks.addItem(U, list.id, { name: `t${n++}`, due_date: due })).item.id);
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
        // The streak counts calendar days, so rewind by whole days (a fixed number of hours would depend on the time of day).
        const setStreak = (streak, daysAgo = 1) =>
            db.query('UPDATE users SET streak_count = ?, last_daily_claim = CURRENT_TIMESTAMP - make_interval(days => ?) WHERE discord_id = ?', [streak, daysAgo, U]);

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
        await setStreak(30, 5);
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


    await t.test('focus sessions: server-measured minutes, 0.6 XP each, one active session', async () => {
        const U = '100000000000000141';
        const V = '100000000000000142';
        await db.users.ensureUser(U);
        await db.users.ensureUser(V);
        const age = (id, minutes) => db.query('UPDATE focus_sessions SET started_at = started_at - make_interval(mins => ?) WHERE id = ?', [minutes, id]);
        for (const bad of [9, 91, 10.5, null, 0, NaN]) await assert.rejects(db.focus.startFocus(U, bad), { code: 'VALIDATION' }, `minutes ${bad}`);

        // Finishing at once credits nothing and closes the session (no XP for a start/finish loop).
        const quick = await db.focus.startFocus(U, 25);
        const none = await db.focus.finishFocus(U, quick.sessionId);
        assert.deepEqual([none.state, none.minutesCredited, none.xp], ['cancelled', 0, 0]);
        await assert.rejects(db.focus.finishFocus(U, quick.sessionId), { code: 'CONFLICT' });

        // A full session pays floor(25 * 0.6) = 15; the credit never exceeds the plan.
        const full = await db.focus.startFocus(U, 25);
        await age(full.sessionId, 40);
        const done = await db.focus.finishFocus(U, full.sessionId);
        assert.deepEqual([done.state, done.minutesCredited, done.xp], ['finished', 25, 15]);
        assert.equal(await sumSource(U, 'focus_session'), 15);
        assert.equal(done.balance, Number((await db.users.getUser(U)).player_xp));
        await assert.rejects(db.focus.finishFocus(U, full.sessionId), { code: 'CONFLICT' }, 'a session settles once');
        assert.equal(await sumSource(U, 'focus_session'), 15);

        // Finishing early credits the time that really passed.
        const part = await db.focus.startFocus(U, 60);
        await age(part.sessionId, 20);
        const partial = await db.focus.finishFocus(U, part.sessionId);
        assert.deepEqual([partial.minutesCredited, partial.xp], [20, 12]);

        // Nobody else can finish it; starting a new session cancels the old one.
        const mine = await db.focus.startFocus(U, 30);
        await assert.rejects(db.focus.finishFocus(V, mine.sessionId), { code: 'NOT_FOUND' });
        const replacement = await db.focus.startFocus(U, 30);
        await assert.rejects(db.focus.finishFocus(U, mine.sessionId), { code: 'CONFLICT' });
        assert.equal((await db.focus.getFocusStatus(U)).active.sessionId, replacement.sessionId);

        // Sessions left running past 3 hours expire without credit.
        await age(replacement.sessionId, 4 * 60);
        const expired = await db.focus.finishFocus(U, replacement.sessionId);
        assert.deepEqual([expired.state, expired.minutesCredited, expired.xp], ['expired', 0, 0]);
        assert.equal((await db.focus.getFocusStatus(U)).active, null);
    });

    await t.test('focus sessions: 100 XP and 8 sessions a day', async () => {
        const U = '100000000000000143';
        await db.users.ensureUser(U);
        const session = async (minutes) => {
            const s = await db.focus.startFocus(U, minutes);
            await db.query('UPDATE focus_sessions SET started_at = started_at - make_interval(mins => ?) WHERE id = ?', [minutes, s.sessionId]);
            return db.focus.finishFocus(U, s.sessionId);
        };
        const a = await session(90);
        const b = await session(90);
        const c = await session(90);
        assert.deepEqual([a.xp, b.xp, c.xp], [54, 46, 0], 'the daily 100 XP cap trims the second and empties the third');
        assert.equal(b.capped, true);
        assert.equal(await sumSource(U, 'focus_session'), 100);
        assert.equal((await db.focus.getFocusStatus(U)).today.remainingXP, 0);

        const W = '100000000000000144';
        await db.users.ensureUser(W);
        for (let n = 0; n < 8; n++) {
            const s = await db.focus.startFocus(W, 10);
            await db.query('UPDATE focus_sessions SET started_at = started_at - make_interval(mins => 10) WHERE id = ?', [s.sessionId]);
            assert.equal((await db.focus.finishFocus(W, s.sessionId)).xp, 6);
        }
        await assert.rejects(db.focus.startFocus(W, 10), { code: 'CONFLICT' }, 'the ninth session of the day is refused');
        await db.query("UPDATE focus_sessions SET finished_at = finished_at - make_interval(days => 1) WHERE discord_id = ?", [W]);
        await db.query('UPDATE xp_transactions SET created_at = created_at - make_interval(days => 1) WHERE discord_id = ?', [W]);
        assert.ok((await db.focus.startFocus(W, 10)).sessionId, 'a new day opens the cap again');
    });


    await t.test('weekly review: needs a finished task, pays 40 XP once per week', async () => {
        const U = '100000000000000151';
        await db.users.ensureUser(U);
        const empty = await db.review.getReview(U);
        assert.deepEqual([empty.completed, empty.claimable, empty.claimed], [0, false, false]);
        assert.match(empty.weekStart, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(new Date(`${empty.weekStart}T00:00:00Z`).getUTCDay(), 1, 'weeks start on Monday');
        await assert.rejects(db.review.claimReview(U), { code: 'VALIDATION' });

        const { list } = await db.tasks.createList(U, { name: 'Review' });
        const { item } = await db.tasks.addItem(U, list.id, { name: 'ship it' });
        await db.tasks.setItemCompleted(U, item.id);
        const ready = await db.review.getReview(U);
        assert.deepEqual([ready.completed, ready.claimable, ready.claimed], [1, true, false]);
        assert.ok(ready.xpEarned > 0);

        // Two simultaneous claims pay once.
        const before = Number((await db.users.getUser(U)).player_xp);
        const rewards0 = await rewardSum(U);
        const results = await Promise.allSettled([db.review.claimReview(U), db.review.claimReview(U)]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(await sumSource(U, 'weekly_review'), 40);
        assert.equal(Number((await db.users.getUser(U)).player_xp) - before - ((await rewardSum(U)) - rewards0), 40);
        const after = await db.review.getReview(U);
        assert.deepEqual([after.claimed, after.claimable], [true, false]);
        await assert.rejects(db.review.claimReview(U), { code: 'CONFLICT' });
        const [[row]] = await db.getPool().query("SELECT COUNT(*) AS n FROM quest_claims WHERE discord_id = ? AND quest_key = 'WEEKLY_REVIEW'", [U]);
        assert.equal(Number(row.n), 1);

        // Next week it opens again, but only for work done in that week.
        const nextWeek = new Date(Date.now() + 7 * 86400e3);
        assert.equal((await db.review.getReview(U, nextWeek)).completed, 0);
        await assert.rejects(db.review.claimReview(U, nextWeek), { code: 'VALIDATION' }, 'last week\'s task does not count twice');
        await db.query('UPDATE items SET first_completed_at = first_completed_at + make_interval(days => 7) WHERE id = ?', [item.id]);
        assert.equal((await db.review.claimReview(U, nextWeek)).xp, 40);
        // ...and unchecking and re-checking a task never moves its first completion into a new week.
        await db.tasks.setItemCompleted(U, item.id, false);
        await db.tasks.setItemCompleted(U, item.id, true);
        assert.equal((await db.review.getReview(U)).completed, 0, 'the first completion was moved into next week above');
    });

    await t.test('weekly review: imported and spawned tasks do not count, and XP off cannot claim', async () => {
        const U = '100000000000000152';
        await db.users.ensureUser(U);
        await db.transfer.importAll(U, { lists: [{ name: 'Imp', items: [{ name: 'done already', completed: true }] }] });
        assert.equal((await db.review.getReview(U)).completed, 0);
        await db.users.updateSettings(U, { gamification_enabled: false });
        const off = await db.review.getReview(U);
        assert.equal(off.claimable, false);
        await assert.rejects(db.review.claimReview(U), { code: 'GAMIFICATION_DISABLED' });
    });


    await t.test('quests: the monthly boss and exactly one rotating weekly quest', async () => {
        const U = '100000000000000161';
        await db.users.ensureUser(U);
        const shared = require('../src');
        const now = new Date();
        const quests = await db.quests.getQuests(U, now);
        const rotating = quests.filter((q) => q.rotating);
        assert.equal(rotating.length, 1, 'one rotating quest is live');
        assert.equal(rotating[0].key, shared.activeRotatingQuest(shared.ROTATING_QUESTS, now));
        const boss = quests.find((q) => q.key === 'BOSS_COMPLETE_50');
        assert.deepEqual([boss.period, boss.target, boss.reward, boss.claimable], ['monthly', 50, 400, false]);
        assert.equal(boss.periodStart, shared.questPeriod('monthly', now).start);
        assert.equal(new Date(boss.resetsAt).getTime(), shared.questPeriod('monthly', now).endsAt.getTime());

        // The other three rotating quests cannot be listed or claimed this week.
        for (const key of shared.ROTATING_QUESTS.filter((k) => k !== rotating[0].key)) {
            assert.ok(!quests.some((q) => q.key === key));
            await assert.rejects(db.quests.claimQuest(U, key, now), { code: 'NOT_FOUND' });
        }
        // ...but each is live in its own week.
        const seen = new Set();
        for (let w = 0; w < 4; w++) {
            const at = new Date(now.getTime() + w * 7 * 86400e3);
            const live = (await db.quests.getQuests(U, at)).filter((q) => q.rotating);
            assert.equal(live.length, 1);
            seen.add(live[0].key);
        }
        assert.equal(seen.size, 4);
    });

    await t.test('quests: early, overdue and dated-add facts count only real first completions', async () => {
        const U = '100000000000000162';
        await db.users.ensureUser(U);
        const shared = require('../src');
        const { list } = await db.tasks.createList(U, { name: 'Facts' });
        let n = 0;
        const add = async (due) => ageDue((await db.tasks.addItem(U, list.id, { name: `f${n++}`, due_date: due })).item.id);
        const early = await add(dayOffset(5));
        const late = await add(dayOffset(-2));
        const today = await add(dayOffset(0));
        for (const id of [early, late, today]) await db.tasks.setItemCompleted(U, id);
        // Un-check, change the due date and re-check: the recorded facts do not move.
        await db.tasks.setItemCompleted(U, early, false);
        await db.tasks.updateItem(U, early, { due_date: dayOffset(-9) });
        await db.tasks.setItemCompleted(U, early, true);

        // Each rotating quest is only listed in its own week: move the data into that week and look.
        let shifted = 0;
        const progressIn = async (key) => {
            let k = 0;
            while (shared.activeRotatingQuest(shared.ROTATING_QUESTS, new Date(Date.now() + k * 7 * 86400e3)) !== key) k++;
            const delta = k * 7 - shifted;
            await db.query(
                'UPDATE items i SET first_completed_at = i.first_completed_at + make_interval(days => ?), created_at = i.created_at + make_interval(days => ?) FROM lists l WHERE l.id = i.list_id AND l.discord_id = ?',
                [delta, delta, U]
            );
            shifted = k * 7;
            return (await db.quests.getQuests(U, new Date(Date.now() + k * 7 * 86400e3))).find((q) => q.key === key).progress;
        };
        assert.equal(await progressIn('WEEKLY_ROT_A'), 1, 'one task was finished early; the later due-date edit changed nothing');
        assert.equal(await progressIn('WEEKLY_ROT_C'), 1, 'one task was finished overdue');
        assert.equal(await progressIn('WEEKLY_ROT_D'), 3, 'three tasks were added with due dates');
    });

    await t.test('quests: clearing a list counts once and the monthly boss counts first completions', async () => {
        const U = '100000000000000163';
        await db.users.ensureUser(U);
        const shared = require('../src');
        const { list } = await db.tasks.createList(U, { name: 'Clear me' });
        const ids = [];
        for (const n of ['1', '2', '3']) ids.push((await db.tasks.addItem(U, list.id, { name: n })).item.id);
        for (const id of ids) await db.tasks.setItemCompleted(U, id);
        const [[cleared]] = await db.getPool().query('SELECT cleared_at FROM lists WHERE id = ?', [list.id]);
        assert.ok(cleared.cleared_at, 'the list was marked cleared once');
        const { item } = await db.tasks.addItem(U, list.id, { name: 'again' });
        const marked = (await db.getPool().query('SELECT cleared_at FROM lists WHERE id = ?', [list.id]))[0][0].cleared_at;
        await db.tasks.setItemCompleted(U, item.id);
        assert.equal((await db.getPool().query('SELECT cleared_at FROM lists WHERE id = ?', [list.id]))[0][0].cleared_at.getTime(), marked.getTime(), 're-clearing does not re-mark it');
        let at = new Date();
        while (shared.activeRotatingQuest(shared.ROTATING_QUESTS, at) !== 'WEEKLY_ROT_B') at = new Date(at.getTime() + 7 * 86400e3);
        const days = Math.round((at.getTime() - Date.now()) / 86400e3);
        await db.query('UPDATE lists SET cleared_at = cleared_at + make_interval(days => ?) WHERE id = ?', [days, list.id]);
        assert.equal((await db.quests.getQuests(U, at)).find((q) => q.key === 'WEEKLY_ROT_B').progress, 1);

        // Monthly boss: 4 first completions so far this month; re-checking adds none.
        const boss = async () => (await db.quests.getQuests(U)).find((q) => q.key === 'BOSS_COMPLETE_50').progress;
        assert.equal(await boss(), 4);
        await db.tasks.setItemCompleted(U, item.id, false);
        await db.tasks.setItemCompleted(U, item.id, true);
        assert.equal(await boss(), 4);
        await assert.rejects(db.quests.claimQuest(U, 'BOSS_COMPLETE_50'), { code: 'VALIDATION' });
        // Fill the boss quest with real completions (imported rows would not count), then claim it once.
        const { list: big } = await db.tasks.createList(U, { name: 'Boss fight' });
        await db.query(
            `INSERT INTO items (list_id, name, position, completed, xp_awarded, first_completed_at, counts_for_quests)
             SELECT ?, 'x', 0, 1, 1, CURRENT_TIMESTAMP, 1 FROM generate_series(1, 46)`,
            [big.id]
        );
        assert.equal(await boss(), 50);
        const before = Number((await db.users.getUser(U)).player_xp);
        const rewards0 = await rewardSum(U);
        const claimed = await db.quests.claimQuest(U, 'BOSS_COMPLETE_50');
        assert.equal(claimed.reward, 400);
        assert.equal(Number((await db.users.getUser(U)).player_xp) - before - ((await rewardSum(U)) - rewards0), 400);
        await assert.rejects(db.quests.claimQuest(U, 'BOSS_COMPLETE_50'), { code: 'CONFLICT', message: /this month/ });
        assert.equal((await db.quests.getQuests(U)).find((q) => q.key === 'BOSS_COMPLETE_50').claimed, true);
    });


    await t.test('prestige: level 30 gate, what resets and what is kept', async () => {
        const U = '100000000000000171';
        await db.users.ensureUser(U);
        await assert.rejects(db.progression.prestige(U), { code: 'VALIDATION' }, 'level 1 cannot prestige');
        assert.equal((await db.progression.getPrestige(U)).eligible, false);

        // A veteran: 2900+ lifetime XP (level 30), a class, skills, freezes, a quest claim and an achievement.
        await db.query(
            `UPDATE users SET player_xp = 700, lifetime_xp = 2950, lifetime_xp_total = 2950, player_level = 30, player_class = 'HERO', owns_hero = 1,
                    streak_freezes = 2, streak_count = 9, xp_spent = 600 WHERE discord_id = ?`,
            [U]
        );
        await db.query("INSERT INTO user_skills (discord_id, skill_id, skill_level) VALUES (?, 'hero_valor', 1)", [U]);
        await db.query("INSERT INTO quest_claims (discord_id, quest_key, period_start, reward_xp) VALUES (?, 'DAILY_ADD_3', CURRENT_DATE, 15)", [U]);
        const { list } = await db.tasks.createList(U, { name: 'Survives prestige' });
        await db.progression.checkAchievements(U);
        const achievementsBefore = Number((await db.query('SELECT COUNT(*) AS n FROM achievements WHERE discord_id = ?', [U]))[0].n);
        assert.ok(achievementsBefore >= 3);
        assert.equal((await db.progression.getPrestige(U)).eligible, true);
        const balanceBefore = Number((await db.users.getUser(U)).player_xp);
        const totalBefore = Number((await db.users.getUser(U)).lifetime_xp_total);

        const r = await db.progression.prestige(U);
        assert.deepEqual([r.prestige, r.title, r.bonusPercent], [1, 'Veteran', 2]);
        const u = await db.users.getUser(U);
        assert.deepEqual([Number(u.player_xp), Number(u.lifetime_xp), Number(u.player_level), u.player_class], [0, 0, 1, 'DEFAULT']);
        assert.equal(Number(u.owns_hero), 0);
        assert.equal(Number(u.streak_freezes), 0);
        assert.equal(Number(u.prestige), 1);
        assert.equal(Number(u.streak_count), 9, 'the daily streak is kept');
        assert.equal(Number(u.xp_spent), 600);
        assert.equal(Number(u.lifetime_xp_total), totalBefore, 'the total is never reset');
        assert.equal((await db.query('SELECT COUNT(*) AS n FROM user_skills WHERE discord_id = ?', [U]))[0].n, 0);
        assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM quest_claims WHERE discord_id = ?', [U]))[0].n), 1, 'quest claims are kept');
        assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM achievements WHERE discord_id = ?', [U]))[0].n), achievementsBefore, 'achievements are kept');
        assert.ok(await db.tasks.getList(U, list.id), 'tasks are kept');
        assert.equal(await sumSource(U, 'prestige'), -balanceBefore, 'the balance left through the ledger');
        assert.equal((await db.users.getUserStats(U)).user.prestige_title, 'Veteran');
        await assert.rejects(db.progression.prestige(U), { code: 'VALIDATION' }, 'level is derived from lifetime XP, so level 30 must be earned again');
    });

    await t.test('prestige: XP achievements and the lifetime board read the never-reset total', async () => {
        const U = '100000000000000172';
        const V = '100000000000000173';
        await db.users.ensureUser(U);
        await db.users.ensureUser(V);
        await db.query('UPDATE users SET player_xp = 100, lifetime_xp = 3000, lifetime_xp_total = 4995, player_level = 31 WHERE discord_id = ?', [U]);
        await db.progression.prestige(U);
        await db.tasks.createList(U, { name: 'Post prestige' }); // +10 XP: total 5005, lifetime_xp 10
        const u = await db.users.getUser(U);
        assert.ok(Number(u.lifetime_xp) < 500 && Number(u.lifetime_xp_total) >= 5000, 'only post-prestige XP counts towards the level');
        const keys = (await db.query('SELECT achievement_key FROM achievements WHERE discord_id = ?', [U])).map((r) => r.achievement_key);
        for (const k of ['XP_100', 'XP_500', 'XP_1000', 'XP_5000']) assert.ok(keys.includes(k), `${k} from the total`);
        assert.ok(!keys.includes('XP_10000'));
        assert.ok(Number(u.player_level) < 10, 'the level restarted');

        await db.query('UPDATE users SET lifetime_xp = 4000, lifetime_xp_total = 4000, player_xp = 0 WHERE discord_id = ?', [V]);
        const board = await db.users.getLeaderboard(100, { by: 'lifetime' });
        const rankOf = (id) => board.findIndex((r) => r.discord_id === id);
        assert.ok(rankOf(U) >= 0 && rankOf(U) < rankOf(V), 'the prestiged player (5005 total) outranks 4000 lifetime XP');
        const row = board[rankOf(U)];
        assert.equal(Number(row.lifetime_xp_total), Number(u.lifetime_xp_total));
        assert.equal(Number(row.prestige), 1);
        assert.equal(await db.users.getRank(U, 'lifetime') < (await db.users.getRank(V, 'lifetime')), true);
    });

    await t.test('prestige: capped at 10, needs XP on and a confirmation upstream, and a full reset clears it', async () => {
        const U = '100000000000000174';
        await db.users.ensureUser(U);
        await db.query('UPDATE users SET player_xp = 0, lifetime_xp = 2900, lifetime_xp_total = 2900, player_level = 30, prestige = 10 WHERE discord_id = ?', [U]);
        await assert.rejects(db.progression.prestige(U), { code: 'CONFLICT' });
        assert.equal((await db.progression.getPrestige(U)).eligible, false);
        await db.query('UPDATE users SET prestige = 3 WHERE discord_id = ?', [U]);
        await db.users.updateSettings(U, { gamification_enabled: false });
        await assert.rejects(db.progression.prestige(U), { code: 'GAMIFICATION_DISABLED' });
        await db.users.updateSettings(U, { gamification_enabled: true });
        assert.equal((await db.progression.prestige(U)).title, 'Elite');
        await db.users.resetProgress(U);
        const wiped = await db.users.getUser(U);
        assert.deepEqual([Number(wiped.prestige), Number(wiped.lifetime_xp_total), Number(wiped.lifetime_xp)], [0, 0, 0]);
    });

    await t.test('stats: per-day history fills gaps, only earning XP counts, other users never leak', async () => {
        const U = '100000000000000181';
        const O = '100000000000000182';
        await db.users.ensureUser(U);
        await db.users.ensureUser(O);
        const empty = await db.stats.getXPHistory(U, 7);
        assert.equal(empty.length, 7);
        assert.ok(empty.every((d) => d.xp === 0 && d.tasksCompleted === 0 && /^\d{4}-\d{2}-\d{2}$/.test(d.date)));
        assert.equal(empty[6].date, new Date().toISOString().slice(0, 10), 'the last day is today (UTC)');
        await assert.rejects(db.stats.getXPHistory(U, 8), RangeError);
        await assert.rejects(db.stats.getXPHistory(U, '1; DROP TABLE users'), RangeError);

        const { list } = await db.tasks.createList(U, { name: 'Stats' });
        const { item } = await db.tasks.addItem(U, list.id, { name: 'one' });
        await db.tasks.setItemCompleted(U, item.id);
        const { list: otherList } = await db.tasks.createList(O, { name: 'Other' });
        const { item: otherItem } = await db.tasks.addItem(O, otherList.id, { name: 'theirs' });
        await db.tasks.setItemCompleted(O, otherItem.id);
        // A spend must not lower the day; an old completion lands on its own day.
        await db.query("INSERT INTO xp_transactions (discord_id, amount, source, balance_before, balance_after) VALUES (?, -50, 'class_purchase', 100, 50)", [U]);
        const old = await db.tasks.addItem(U, list.id, { name: 'old' });
        await db.tasks.setItemCompleted(U, old.item.id);
        await db.query('UPDATE items SET first_completed_at = first_completed_at - make_interval(days => 3) WHERE id = ?', [old.item.id]);

        const hist = await db.stats.getXPHistory(U, 7);
        assert.equal(hist[6].tasksCompleted, 1);
        assert.equal(hist[3].tasksCompleted, 1, 'three days ago');
        assert.ok(hist[6].xp > 0);
        const total = hist.reduce((n, d) => n + d.xp, 0);
        const [[earned]] = await db.getPool().query('SELECT COALESCE(SUM(amount), 0) AS n FROM xp_transactions WHERE discord_id = ? AND amount > 0', [U]);
        assert.equal(total, Number(earned.n), 'spending is not counted and nothing is lost');
        assert.equal((await db.stats.getXPHistory(U, 90)).length, 90);

        const summary = await db.stats.getStatsSummary(U);
        assert.equal(summary.tasksCompleted7d, 2);
        assert.ok(summary.xpBySource30d.length >= 1 && summary.xpBySource30d.every((r) => r.xp > 0 && r.label));
        assert.ok(summary.xpBySource30d.every((r, i, a) => i === 0 || a[i - 1].xp >= r.xp), 'largest first');
        assert.ok(!summary.xpBySource30d.some((r) => r.source === 'class_purchase'));
        assert.ok(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].includes(summary.busiestWeekday.name));
        const none = await db.stats.getStatsSummary('100000000000000199');
        assert.deepEqual([none.streak, none.tasksCompleted7d, none.xpBySource30d.length, none.busiestWeekday], [0, 0, 0, null]);
    });

    await t.test('CSV export round-trips through csvToImport and importAll without rewards', async () => {
        const { csvToImport } = require('../src/csv');
        const A = '100000000000000301';
        const B = '100000000000000302';
        await db.users.ensureUser(A);
        await db.users.ensureUser(B);
        const { list } = await db.tasks.createList(A, { name: 'Round, "trip"', category: 'Work', deadline: '2030-05-01' });
        const { item: parent } = await db.tasks.addItem(A, list.id, { name: 'Parent', tags: 'a,b', recurrence: 'weekly', due_date: '2030-04-01' });
        await db.tasks.addItem(A, list.id, { name: '-5 degrees\nsecond line', parent_id: parent.id, priority: 'LOW' });
        await db.tasks.setItemCompleted(A, parent.id, true);
        const parsed = csvToImport(db.transfer.toCsv(await db.transfer.exportAll(A)));
        assert.deepEqual(parsed.errors, []);
        const before = await db.users.getUser(B);
        assert.deepEqual(await db.transfer.importAll(B, parsed.data), { lists: 1, items: 3 }, 'completing the weekly task spawned its next copy');
        const after = await db.users.getUser(B);
        assert.equal(Number(after.player_xp), Number(before.player_xp));
        const [copy] = await db.tasks.getLists(B);
        assert.deepEqual([copy.name, copy.category], ['Round, "trip"', 'Work']);
        const items = await db.tasks.getItems(B, copy.id);
        const kid = items.find((i) => i.parent_id);
        assert.equal(kid.name, '-5 degrees\nsecond line', 'formula guard and newlines survive');
        assert.equal(items.find((i) => i.name === 'Parent').tags, 'a,b');
        assert.equal(Boolean(items.find((i) => i.name === 'Parent' && i.completed)), true);
    });

    await t.test('search: scopes, literal wildcards, ownership and bounds', async () => {
        const S = '100000000000000311';
        const T = '100000000000000312';
        await db.users.ensureUser(S);
        await db.users.ensureUser(T);
        const { list: groceries } = await db.tasks.createList(S, { name: 'Groceries', category: 'Home' });
        const { list: plans } = await db.tasks.createList(S, { name: 'Plans', description: 'weekend 100% fun' });
        await db.tasks.addItem(S, groceries.id, { name: 'Buy milk', description: 'the oat kind_please' });
        await db.tasks.addItem(S, groceries.id, { name: 'Pay rent' });
        await db.tasks.addItem(S, plans.id, { name: 'Call mum', description: 'about milk bills' });
        const { list: theirs } = await db.tasks.createList(T, { name: 'Milk run' });
        await db.tasks.addItem(T, theirs.id, { name: 'milk for them', description: 'milk' });

        const names = (rows) => rows.map((r) => r.name);
        assert.deepEqual(await db.tasks.search(S, 'milk'), { lists: [], tasks: [] }, 'default scope is quests only');
        const tasks = await db.tasks.search(S, 'MILK', { scope: 'tasks' });
        assert.deepEqual(names(tasks.tasks), ['Buy milk', 'Call mum'], 'name or description, never someone else\'s');
        assert.deepEqual(tasks.tasks.map((r) => r.list_name), ['Groceries', 'Plans']);
        assert.equal(tasks.tasks[0].list_id, groceries.id);
        assert.deepEqual(tasks.lists, []);
        const all = await db.tasks.search(S, 'home', { scope: 'all' });
        assert.deepEqual(names(all.lists), ['Groceries']);
        assert.deepEqual(all.tasks, []);
        assert.deepEqual(names((await db.tasks.search(S, '100%', { scope: 'all' })).lists), ['Plans'], 'a literal percent');
        assert.equal((await db.tasks.search(S, '%', { scope: 'tasks' })).tasks.length, 0, '% is not a wildcard');
        assert.deepEqual(names((await db.tasks.search(S, 'kind_please', { scope: 'tasks' })).tasks), ['Buy milk']);
        assert.equal((await db.tasks.search(S, 'kind_pleas_', { scope: 'tasks' })).tasks.length, 0, '_ is not a wildcard');
        await assert.rejects(db.tasks.search(S, 'x', { scope: 'everything' }), { code: 'VALIDATION' });
        await assert.rejects(db.tasks.search(S, '   ', { scope: 'tasks' }), { code: 'VALIDATION' });

        const B = '100000000000000313';
        await db.users.ensureUser(B);
        const { list: big } = await db.tasks.createList(B, { name: 'Big' });
        await db.query("INSERT INTO items (list_id, name, position) SELECT ?, 'needle ' || seq, seq FROM generate_series(1, 80) AS seq", [big.id]);
        assert.equal((await db.tasks.search(B, 'needle', { scope: 'tasks' })).tasks.length, db.tasks.SEARCH_LIMIT, 'results are bounded');
    });

    await t.test('templates: create, limits, ownership, apply (new quest, name clash, existing quest) and the XP caps', async () => {
        const { LIMITS: L } = require('../src/constants');
        const U = '100000000000000321';
        const V = '100000000000000322';
        await db.users.ensureUser(U);
        await db.users.ensureUser(V);

        const tpl = await db.templates.createTemplate(U, {
            name: 'Weekly reset',
            description: 'Sunday routine',
            items: [{ name: 'Laundry', priority: 'high', tags: '#home, chores', recurrence: 'weekly' }, { name: 'Plan meals', description: 'for the week' }, { name: 'Water plants' }]
        });
        assert.deepEqual([tpl.name, tpl.itemCount, tpl.items[0].priority, tpl.items[0].tags], ['Weekly reset', 3, 'HIGH', 'home,chores']);
        assert.deepEqual(Object.keys(tpl.items[2]), ['name'], 'empty fields are not stored');
        await assert.rejects(db.templates.createTemplate(U, { name: 'Weekly reset', items: [{ name: 'x' }] }), { code: 'CONFLICT' });
        await assert.rejects(db.templates.createTemplate(U, { name: 'Empty', items: [] }), { code: 'VALIDATION' });
        await assert.rejects(db.templates.createTemplate(U, { name: 'Big', items: Array.from({ length: L.MAX_TEMPLATE_ITEMS + 1 }, (_, i) => ({ name: `t${i}` })) }), { code: 'VALIDATION' });
        await assert.rejects(db.templates.createTemplate(U, { name: 'Bad', items: [{ name: 'ok' }, { name: 'x', priority: 'URGENT' }] }), { code: 'VALIDATION' });
        await assert.rejects(db.templates.createTemplate(U, { name: 'Bad', items: ['nope'] }), { code: 'VALIDATION' });
        const max = await db.templates.createTemplate(V, { name: 'Max', items: Array.from({ length: L.MAX_TEMPLATE_ITEMS }, (_, i) => ({ name: `t${i}` })) });
        assert.equal(max.itemCount, L.MAX_TEMPLATE_ITEMS);

        // Ownership: V cannot see, apply or delete U's template.
        assert.deepEqual((await db.templates.listTemplates(V)).map((x) => x.name), ['Max']);
        await assert.rejects(db.templates.getTemplate(V, tpl.id), { code: 'NOT_FOUND' });
        await assert.rejects(db.templates.applyTemplate(V, tpl.id), { code: 'NOT_FOUND' });
        await assert.rejects(db.templates.deleteTemplate(V, tpl.id), { code: 'NOT_FOUND' });
        assert.equal((await db.templates.listTemplates(U)).length, 1, 'still there');

        // Apply: a new quest with the tasks, rewarded like hand-made ones.
        const before = await db.users.getUser(U);
        const a = await db.templates.applyTemplate(U, tpl.id);
        assert.equal(a.created, true);
        assert.deepEqual([a.list.name, a.list.description], ['Weekly reset', 'Sunday routine']);
        assert.equal(a.items.length, 3);
        assert.deepEqual([a.items[0].name, a.items[0].priority, a.items[0].tags, a.items[0].recurrence, a.items[0].position], ['Laundry', 'HIGH', 'home,chores', 'weekly', 0]);
        assert.ok(a.xp.finalXP > 0, 'the quest and its tasks pay XP');
        const after = await db.users.getUser(U);
        assert.equal(Number(after.total_items_added), Number(before.total_items_added) + 3);
        assert.equal(Number(after.total_lists_created), Number(before.total_lists_created) + 1);

        // The name is taken, so the second quest gets the date; an explicit name that clashes is a conflict.
        const b = await db.templates.applyTemplate(U, tpl.id);
        assert.match(b.list.name, /^Weekly reset \(\d{4}-\d{2}-\d{2}\)$/);
        const c = await db.templates.applyTemplate(U, tpl.id);
        assert.match(c.list.name, /^Weekly reset \(\d{4}-\d{2}-\d{2} 2\)$/);
        await assert.rejects(db.templates.applyTemplate(U, tpl.id, { listName: 'Weekly reset' }), { code: 'CONFLICT' });
        const named = await db.templates.applyTemplate(U, tpl.id, { listName: 'Sunday' });
        assert.equal(named.list.name, 'Sunday');
        await assert.rejects(db.templates.applyTemplate(U, tpl.id, { listName: 'a', listId: named.list.id }), { code: 'VALIDATION' });

        // Into an existing quest, and only the caller's own.
        const into = await db.templates.applyTemplate(U, tpl.id, { listId: named.list.id });
        assert.deepEqual([into.created, into.list.id, (await db.tasks.getItems(U, named.list.id)).length], [false, named.list.id, 6]);
        assert.deepEqual((await db.tasks.getItems(U, named.list.id)).map((i) => i.position), [0, 1, 2, 3, 4, 5]);
        await assert.rejects(db.templates.applyTemplate(V, max.id, { listId: named.list.id }), { code: 'NOT_FOUND' });
        const lists = (await db.tasks.getLists(V)).length;
        await assert.rejects(db.templates.applyTemplate(V, max.id, { listId: 999999 }), { code: 'NOT_FOUND' });
        assert.equal((await db.tasks.getLists(V)).length, lists);

        // Daily caps still apply: with the item cap nearly used up, only the remaining tasks pay.
        const W = '100000000000000323';
        await db.users.ensureUser(W);
        const seed = L.ITEM_ADD_REWARDS_PER_DAY - 2;
        await pool.query(
            `INSERT INTO xp_transactions (discord_id, amount, source, balance_before, balance_after)
             SELECT ?, 1, 'item_add', 0, 0 FROM information_schema.COLUMNS LIMIT ${seed}`,
            [W]
        );
        const wt = await db.templates.createTemplate(W, { name: 'Five', items: [1, 2, 3, 4, 5].map((n) => ({ name: `task ${n}` })) });
        const applied = await db.templates.applyTemplate(W, wt.id);
        assert.equal(applied.items.length, 5, 'every task is created');
        const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM xp_transactions WHERE discord_id = ? AND source = 'item_add' AND amount > 1", [W]);
        assert.equal(Number(n), 2, 'but only the two inside the cap paid');

        // Saving a quest as a template, then deleting; the 20 template cap; reset clears them.
        const saved = await db.templates.saveFromList(U, named.list.id, { name: 'From quest' });
        assert.equal(saved.itemCount, 6);
        await assert.rejects(db.templates.saveFromList(U, named.list.id, { name: 'From quest' }), { code: 'CONFLICT' });
        await assert.rejects(db.templates.saveFromList(V, named.list.id), { code: 'NOT_FOUND' });
        const { list: bare } = await db.tasks.createList(U, { name: 'No tasks' });
        await assert.rejects(db.templates.saveFromList(U, bare.id), { code: 'VALIDATION' });
        assert.equal(await db.templates.deleteTemplate(U, saved.id), true);
        for (let i = 0; i < L.MAX_TEMPLATES_PER_USER - 1; i++) await db.templates.createTemplate(U, { name: `fill ${i}`, items: [{ name: 'x' }] });
        await assert.rejects(db.templates.createTemplate(U, { name: 'one too many', items: [{ name: 'x' }] }), { code: 'VALIDATION' });
        await db.users.resetProgress(U);
        assert.equal((await db.templates.listTemplates(U)).length, 0, 'a progress reset removes templates with the quests');
    });

    await t.test('cosmetics: buy, requirements, equip, double click, prestige keeps and reset clears', async () => {
        const K = '100000000000000401';
        await db.users.ensureUser(K);
        const { COSMETICS, SPEND_SOURCES } = require('../src/constants');
        assert.ok(SPEND_SOURCES.includes('cosmetic_purchase'));
        await assert.rejects(db.cosmetics.buyCosmetic(K, 'title_nope'), { code: 'NOT_FOUND' });
        await assert.rejects(db.cosmetics.buyCosmetic(K, '__proto__'), { code: 'NOT_FOUND' });
        await assert.rejects(db.cosmetics.buyCosmetic(K, 'title_diligent'), { code: 'INSUFFICIENT_XP' });
        await setXP(K, 5000);
        await assert.rejects(db.cosmetics.buyCosmetic(K, 'title_relentless'), { code: 'FORBIDDEN' }, 'level 20 needed');
        await assert.rejects(db.cosmetics.buyCosmetic(K, 'frame_prestige'), { code: 'FORBIDDEN' });
        await assert.rejects(db.cosmetics.buyCosmetic(K, 'title_taskbreaker'), { code: 'FORBIDDEN' }, 'achievement needed');

        const spentBefore = Number((await db.users.getUser(K)).xp_spent);
        const results = await Promise.allSettled([db.cosmetics.buyCosmetic(K, 'title_diligent'), db.cosmetics.buyCosmetic(K, 'title_diligent')]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'a double click buys once');
        assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'CONFLICT');
        const after = await db.users.getUser(K);
        const cost = COSMETICS.title_diligent.cost;
        assert.equal(Number(after.xp_spent) - spentBefore, cost, 'cosmetics count as spending');
        const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM xp_transactions WHERE discord_id = ? AND source = 'cosmetic_purchase'", [K]);
        assert.equal(Number(n), 1);

        // Equip: only owned, only the right kind; null unequips.
        await assert.rejects(db.cosmetics.equipCosmetic(K, 'title', 'title_night_owl'), { code: 'FORBIDDEN' });
        await assert.rejects(db.cosmetics.equipCosmetic(K, 'frame', 'title_diligent'), { code: 'NOT_FOUND' });
        await assert.rejects(db.cosmetics.equipCosmetic(K, 'hat', null), { code: 'VALIDATION' });
        const eq = await db.cosmetics.equipCosmetic(K, 'title', 'title_diligent');
        assert.equal(eq.equipped.title, 'the Diligent');
        await db.cosmetics.buyCosmetic(K, 'accent_ocean');
        await db.cosmetics.equipCosmetic(K, 'accent', 'accent_ocean');
        let shop = await db.cosmetics.listCosmetics(K);
        const byId = Object.fromEntries(shop.items.map((i) => [i.id, i]));
        assert.ok(byId.title_diligent.owned && byId.title_diligent.equipped);
        assert.ok(byId.frame_prestige.locked && /prestige/i.test(byId.frame_prestige.lockedReason));
        assert.ok(byId.frame_bronze.affordable && !byId.frame_bronze.locked);
        assert.equal(shop.equipped.accent.id, 'accent_ocean');
        const board = await db.users.getLeaderboard(50);
        const row = board.find((r) => r.discord_id === K);
        assert.equal(row.equipped_title, 'title_diligent');

        // A prestige keeps what was bought (and what is equipped); a progress reset clears both.
        await db.query('UPDATE users SET player_level = 30, lifetime_xp = 100000, lifetime_xp_total = 100000 WHERE discord_id = ?', [K]);
        await db.progression.prestige(K);
        shop = await db.cosmetics.listCosmetics(K);
        assert.ok(shop.items.find((i) => i.id === 'title_diligent').owned, 'owned after prestige');
        assert.equal(shop.equipped.title, 'the Diligent');
        await db.cosmetics.equipCosmetic(K, 'title', null);
        assert.equal((await db.cosmetics.listCosmetics(K)).equipped.title, null);
        await db.cosmetics.equipCosmetic(K, 'title', 'title_diligent');
        await db.users.resetProgress(K);
        shop = await db.cosmetics.listCosmetics(K);
        assert.ok(shop.items.every((i) => !i.owned && !i.equipped));
        assert.deepEqual(shop.equipped, { title: null, frame: null, accent: null });
        // XP off: no purchases.
        await db.users.updateSettings(K, { gamification_enabled: false });
        await assert.rejects(db.cosmetics.buyCosmetic(K, 'accent_ocean'), { code: 'GAMIFICATION_DISABLED' });
    });

    await t.test('time zones: daily caps use each user\'s own day', async () => {
        const KIRI = '100000000000000501'; // UTC+14
        const PAGO = '100000000000000502'; // UTC-11
        const UTCU = '100000000000000503';
        for (const id of [KIRI, PAGO, UTCU]) await db.users.ensureUser(id);
        await db.query('UPDATE users SET timezone = ? WHERE discord_id = ?', ['Pacific/Kiritimati', KIRI]);
        await db.query('UPDATE users SET timezone = ? WHERE discord_id = ?', ['Pacific/Pago_Pago', PAGO]);
        const pool = db.getPool();
        const tx = (id, source, amount, at) => db.query('INSERT INTO xp_transactions (discord_id, amount, source, created_at) VALUES (?, ?, ?, ?)', [id, amount, source, new Date(at)]);
        const I = new Date('2030-06-01T11:30:00Z'); // Kiritimati: Jun 2 01:30 (day began 10:00Z), Pago Pago: Jun 1 00:30 (day began 11:00Z)
        for (const id of [KIRI, PAGO, UTCU]) {
            await tx(id, 'item_add', 3, '2030-06-01T10:30:00Z');
            await tx(id, 'game_reward', 200, '2030-06-01T10:30:00Z');
        }
        const { countToday, sumToday, remainingFreeGameXP } = db.progression;
        assert.equal(await countToday(pool, KIRI, 'item_add', I), 1, 'Kiritimati: 10:30Z is already its Jun 2');
        assert.equal(await countToday(pool, PAGO, 'item_add', I), 0, 'Pago Pago: 10:30Z was still its May 31');
        assert.equal(await countToday(pool, UTCU, 'item_add', I), 1, 'UTC: same UTC day');
        assert.equal(await sumToday(pool, KIRI, 'game_reward', I), 200);
        assert.equal(await sumToday(pool, PAGO, 'game_reward', I), 0);
        assert.equal(await remainingFreeGameXP(pool, KIRI, I), 300);
        assert.equal(await remainingFreeGameXP(pool, PAGO, I), 500);
        // A user row can be passed instead of an id (no lookup).
        assert.equal(await countToday(pool, { discord_id: KIRI, timezone: 'UTC' }, 'item_add', I), 1);

        // The cap resets at that user's local midnight, not at 00:00 UTC.
        assert.equal(await countToday(pool, KIRI, 'item_add', new Date('2030-06-02T09:59:59Z')), 1);
        assert.equal(await countToday(pool, KIRI, 'item_add', new Date('2030-06-02T10:00:00Z')), 0);
        await tx(PAGO, 'list_create', 1, '2030-06-01T12:00:00Z');
        assert.equal(await countToday(pool, PAGO, 'list_create', new Date('2030-06-02T10:59:59Z')), 1);
        assert.equal(await countToday(pool, PAGO, 'list_create', new Date('2030-06-02T11:00:00Z')), 0);

        // The allowance reports the user's own midnight.
        const kiri = await db.games.getFreeGameAllowance(KIRI, I);
        const pago = await db.games.getFreeGameAllowance(PAGO, I);
        assert.equal(kiri.resetsAt, '2030-06-02T10:00:00.000Z');
        assert.equal(pago.resetsAt, '2030-06-02T11:00:00.000Z');

        // Real flow: list creations are capped at 10 per local day. Ten earlier today (local) cap the 11th;
        // ten from just before local midnight do not.
        const zone = 'Pacific/Kiritimati';
        const start = require('../src/tz').dayStart(zone, new Date());
        const before = '100000000000000504';
        const today = '100000000000000505';
        for (const id of [before, today]) {
            await db.users.ensureUser(id);
            await db.query('UPDATE users SET timezone = ? WHERE discord_id = ?', [zone, id]);
        }
        for (let i = 0; i < 10; i++) {
            await tx(before, 'list_create', 1, start.getTime() - 60e3);
            await tx(today, 'list_create', 1, start.getTime() + 1000);
        }
        assert.ok((await db.tasks.createList(before, { name: 'fresh day' })).xp.finalXP > 0, 'yesterday\'s creations do not count');
        assert.equal((await db.tasks.createList(today, { name: 'capped' })).xp.capped, true, 'today\'s creations do');
    });

    await t.test('time zones: quests, weekly review, stats and the leaderboard follow each user\'s zone', async () => {
        const KIRI = '100000000000000511'; // UTC+14
        const PAGO = '100000000000000512'; // UTC-11
        const BOARD = '100000000000000513';
        const tzmod = require('../src/tz');
        const zones = { [KIRI]: 'Pacific/Kiritimati', [PAGO]: 'Pacific/Pago_Pago' };
        const itemTimes = ['2030-06-02T09:59:00Z', '2030-06-02T10:00:00Z']; // Kiritimati: Sun 23:59 / Mon 00:00; Pago Pago: Sat 22:59 / 23:00
        const when = (id, source, amount, at) => db.query('INSERT INTO xp_transactions (discord_id, amount, source, created_at) VALUES (?, ?, ?, ?)', [id, amount, source, new Date(at)]);
        for (const id of [KIRI, PAGO, BOARD]) await db.users.ensureUser(id);
        for (const [id, zone] of Object.entries(zones)) {
            await db.query('UPDATE users SET timezone = ? WHERE discord_id = ?', [zone, id]);
            const { list } = await db.tasks.createList(id, { name: 'Zones' });
            for (const [n, at] of itemTimes.entries()) {
                const { item } = await db.tasks.addItem(id, list.id, { name: `done ${n}` });
                await db.tasks.setItemCompleted(id, item.id);
                await db.query('UPDATE items SET first_completed_at = ? WHERE id = ?', [new Date(at), item.id]);
            }
            await when(id, 'item_add', 5, '2030-06-02T09:59:00Z');
            await when(id, 'item_add', 7, '2030-06-02T10:00:00Z');
        }
        const X = new Date('2030-06-02T13:00:00Z'); // Sunday 02:00 in Pago Pago, already Monday 03:00 in Kiritimati

        // Quests: different periods, progress and rotating quest at the same instant.
        const find = (qs, key) => qs.find((q) => q.key === key);
        const kq = await db.quests.getQuests(KIRI, X);
        const pq = await db.quests.getQuests(PAGO, X);
        assert.equal(find(kq, 'WEEKLY_COMPLETE_15').periodStart, '2030-06-03');
        assert.equal(find(pq, 'WEEKLY_COMPLETE_15').periodStart, '2030-05-27');
        assert.equal(find(kq, 'WEEKLY_COMPLETE_15').resetsAt, '2030-06-09T10:00:00.000Z');
        assert.equal(find(pq, 'WEEKLY_COMPLETE_15').resetsAt, '2030-06-03T11:00:00.000Z');
        assert.equal(find(kq, 'WEEKLY_COMPLETE_15').progress, 1, 'Kiritimati: only the Monday task is in the new week');
        assert.equal(find(pq, 'WEEKLY_COMPLETE_15').progress, 2, 'Pago Pago: still last week, both count');
        assert.equal(find(kq, 'DAILY_COMPLETE_3').progress, 1);
        assert.equal(find(pq, 'DAILY_COMPLETE_3').progress, 0, 'both tasks were done on Pago Pago\'s Saturday');
        assert.equal(find(kq, 'DAILY_COMPLETE_3').periodStart, '2030-06-03');
        assert.equal(find(pq, 'DAILY_COMPLETE_3').periodStart, '2030-06-02');
        assert.equal(find(kq, 'BOSS_COMPLETE_50').periodStart, '2030-06-01');
        assert.ok(find(kq, 'WEEKLY_ROT_D') && !find(kq, 'WEEKLY_ROT_C'), 'ISO week 23 locally in Kiritimati');
        assert.ok(find(pq, 'WEEKLY_ROT_C') && !find(pq, 'WEEKLY_ROT_D'), 'still ISO week 22 in Pago Pago');
        // Rolling over at local Monday: Pago Pago's week ends 06-03 11:00Z exactly.
        assert.equal(find(await db.quests.getQuests(PAGO, new Date('2030-06-03T10:59:59Z')), 'WEEKLY_COMPLETE_15').periodStart, '2030-05-27');
        const rolled = find(await db.quests.getQuests(PAGO, new Date('2030-06-03T11:00:00Z')), 'WEEKLY_COMPLETE_15');
        assert.deepEqual([rolled.periodStart, rolled.progress], ['2030-06-03', 0]);

        // A claim is keyed by the user's local date, and reopens at their local midnight.
        const { list: hl } = await db.tasks.createList(KIRI, { name: 'High' });
        const { item: hi } = await db.tasks.addItem(KIRI, hl.id, { name: 'big', priority: 'HIGH' });
        await db.tasks.setItemCompleted(KIRI, hi.id);
        const now = new Date();
        const claim = await db.quests.claimQuest(KIRI, 'DAILY_HIGH_1', now);
        assert.equal(claim.reward, 25);
        const [[row]] = await db.getPool().query("SELECT to_char(period_start, 'YYYY-MM-DD') AS d FROM quest_claims WHERE discord_id = ? AND quest_key = 'DAILY_HIGH_1'", [KIRI]);
        assert.equal(row.d, tzmod.dayKey('Pacific/Kiritimati', now));
        await assert.rejects(db.quests.claimQuest(KIRI, 'DAILY_HIGH_1', now), { code: 'CONFLICT' });
        const tomorrow = tzmod.nextDayStart('Pacific/Kiritimati', now);
        assert.equal(find(await db.quests.getQuests(KIRI, new Date(tomorrow.getTime() - 1)), 'DAILY_HIGH_1').claimed, true);
        const reopened = find(await db.quests.getQuests(KIRI, tomorrow), 'DAILY_HIGH_1');
        assert.deepEqual([reopened.claimed, reopened.progress], [false, 0]);

        // Weekly review: same week keys and rollover.
        const rk = await db.review.getReview(KIRI, X);
        const rp = await db.review.getReview(PAGO, X);
        assert.deepEqual([rk.weekStart, rk.completed], ['2030-06-03', 1]);
        assert.deepEqual([rp.weekStart, rp.completed], ['2030-05-27', 2]);
        assert.equal((await db.review.claimReview(PAGO, X)).weekStart, '2030-05-27');
        await assert.rejects(db.review.claimReview(PAGO, new Date('2030-06-03T10:59:59Z')), { code: 'CONFLICT' });
        const nextWeek = await db.review.getReview(PAGO, new Date('2030-06-03T11:00:00Z'));
        assert.deepEqual([nextWeek.weekStart, nextWeek.claimed, nextWeek.completed], ['2030-06-03', false, 0]);

        // Stats: per-day buckets are the user's own days.
        const sNow = new Date('2030-06-03T05:00:00Z'); // Kiritimati Mon 19:00, Pago Pago Sun 18:00
        const hk = await db.stats.getXPHistory(KIRI, 7, sNow);
        const hp = await db.stats.getXPHistory(PAGO, 7, sNow);
        assert.deepEqual(hk.slice(-2).map((d) => [d.date, d.tasksCompleted]), [['2030-06-02', 1], ['2030-06-03', 1]]);
        assert.deepEqual(hp.slice(-3).map((d) => [d.date, d.tasksCompleted]), [['2030-05-31', 0], ['2030-06-01', 2], ['2030-06-02', 0]]);
        assert.equal(hk.at(-2).xp, 5);
        assert.equal(hk.at(-1).xp, 7);
        assert.equal(hp.at(-2).xp, 12, 'both rows fall on Pago Pago\'s Saturday');
        const sk = await db.stats.getStatsSummary(KIRI, sNow);
        const sp = await db.stats.getStatsSummary(PAGO, sNow);
        assert.deepEqual([sk.busiestWeekday.name, sk.busiestWeekday.count], ['Sunday', 1]);
        assert.deepEqual([sp.busiestWeekday.name, sp.busiestWeekday.count], ['Saturday', 2]);

        // The leaderboard's week is global (Monday 00:00 UTC), whatever the viewer's zone.
        await db.query('UPDATE users SET timezone = ? WHERE discord_id = ?', ['Pacific/Kiritimati', BOARD]);
        await when(BOARD, 'item_add', 4, '2030-06-02T23:00:00Z'); // Sunday in UTC
        await when(BOARD, 'item_add', 9, '2030-06-03T01:00:00Z'); // Monday in UTC
        await when(BOARD, 'game_reward', 400, '2030-06-03T02:00:00Z'); // arcade XP never counts for the public weekly board
        const board = await db.users.getLeaderboard(100, { by: 'weekly', now: new Date('2030-06-03T12:00:00Z') });
        assert.equal(Number(board.find((r) => r.discord_id === BOARD).score), 9, 'free-game XP stays off the weekly board');
    });

    await t.test('time zones: a zone change is throttled to once per 24 hours', async () => {
        const T = '100000000000000521';
        await db.users.ensureUser(T);
        assert.equal((await db.users.getUser(T)).timezone_changed_at, null, 'never set');
        await assert.rejects(db.users.updateSettings(T, { timezone: 'Mars/Base' }), { code: 'VALIDATION', message: /Unknown time zone/ });
        assert.equal((await db.users.updateSettings(T, { timezone: 'Asia/Manila' })).timezone, 'Asia/Manila', 'the first change is free');
        assert.ok((await db.users.getUser(T)).timezone_changed_at);

        // A second change within 24 hours is refused, and nothing else in the same save is applied.
        await assert.rejects(db.users.updateSettings(T, { timezone: 'Europe/Paris', weekly_digest: true }), { code: 'VALIDATION', message: /once every 24 hours.*Try again in 24h/ });
        await assert.rejects(db.users.updateSettings(T, { timezone: null }), { code: 'VALIDATION' }, 'going back to UTC is a change too');
        const kept = await db.users.getUser(T);
        assert.deepEqual([kept.timezone, Boolean(kept.weekly_digest)], ['Asia/Manila', false]);
        // The same value, and other settings, are never throttled.
        assert.equal((await db.users.updateSettings(T, { timezone: 'Asia/Manila', reminder_hour: 6 })).reminder_hour, 6);
        assert.equal((await db.users.updateSettings(T, { weekly_digest: true })).weekly_digest, 1);

        // After 24 hours it can change again (the clock is injectable).
        await assert.rejects(db.users.updateSettings(T, { timezone: 'Europe/Paris' }, new Date(Date.now() + 23 * 3600e3)), { code: 'VALIDATION' });
        const later = new Date(Date.now() + 25 * 3600e3);
        assert.equal((await db.users.updateSettings(T, { timezone: 'Europe/Paris' }, later)).timezone, 'Europe/Paris');
        await assert.rejects(db.users.updateSettings(T, { timezone: 'Asia/Manila' }, later), { code: 'VALIDATION' }, 'and the clock restarts');

        // Zone-hopping cannot reset a daily cap: the cap window follows the zone, but only once a day.
        const H = '100000000000000522';
        await db.users.ensureUser(H);
        await db.users.updateSettings(H, { timezone: 'Pacific/Kiritimati' });
        await assert.rejects(db.users.updateSettings(H, { timezone: 'Pacific/Pago_Pago' }), { code: 'VALIDATION' });
    });

    await t.test('web push subscriptions: validated, one row per endpoint, capped, moved, pruned and cascaded', async () => {
        const P = '100000000000000501';
        const Q = '100000000000000502';
        await db.users.ensureUser(P);
        await db.users.ensureUser(Q);
        const keys = { p256dh: Buffer.alloc(65, 5).toString('base64url'), auth: Buffer.alloc(16, 6).toString('base64url') };
        const sub = (n) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys });
        assert.equal((await db.users.getUser(P)).web_push, 1, 'on by default');
        await assert.rejects(db.push.addSubscription(P, { endpoint: 'http://push.example.com/x', keys }), { code: 'VALIDATION' });
        assert.equal((await db.push.addSubscription(P, sub(1))).count, 1);
        assert.equal((await db.push.addSubscription(P, sub(1))).count, 1, 'the same endpoint is the same row');
        const refreshed = { endpoint: sub(1).endpoint, keys: { p256dh: Buffer.alloc(65, 8).toString('base64url'), auth: keys.auth } };
        await db.push.addSubscription(P, refreshed);
        assert.equal((await db.push.listSubscriptions(P))[0].p256dh, refreshed.keys.p256dh, 'a re-subscribe refreshes the keys');
        const long = { endpoint: `https://fcm.googleapis.com/${'a'.repeat(2000)}`, keys };
        await db.push.addSubscription(P, long); // a long endpoint fits (TEXT) and is indexed by hash
        for (let n = 2; n <= 9; n++) await db.push.addSubscription(P, sub(n));
        assert.equal(await db.push.countSubscriptions(P), 10);
        await assert.rejects(db.push.addSubscription(P, sub(99)), { code: 'VALIDATION' });
        assert.equal((await db.push.addSubscription(P, sub(1))).count, 10, 'refreshing an existing one still works at the cap');

        // An endpoint that shows up under another account moves there (a shared browser).
        assert.equal((await db.push.addSubscription(Q, sub(2))).count, 1);
        assert.equal(await db.push.countSubscriptions(P), 9);
        assert.equal(await db.push.removeSubscription(P, sub(2).endpoint), false, 'P no longer owns it');
        assert.equal(await db.push.removeSubscription(Q, sub(2).endpoint), true);
        assert.equal(await db.push.removeSubscription(Q, sub(2).endpoint), false);

        const [first] = await db.push.listSubscriptions(P);
        await db.push.touchSubscription(first.id);
        assert.ok((await db.query('SELECT last_used_at FROM push_subscriptions WHERE id = ?', [first.id]))[0].last_used_at);
        await db.push.deleteSubscriptionById(first.id);
        assert.equal(await db.push.countSubscriptions(P), 8);
        await db.query('DELETE FROM users WHERE discord_id = ?', [P]);
        assert.equal(await db.push.countSubscriptions(P), 0, 'subscriptions go with the user');
    });

    // ─── Shared lists: access matrix ──────────────────────────────────────────────

    const SL = { owner: '200000000000000301', viewer: '200000000000000302', editor: '200000000000000303', manager: '200000000000000304', stranger: '200000000000000305', other: '200000000000000306' };
    const addMember = (listId, userId, role) =>
        db.query('INSERT INTO list_members (list_id, discord_id, role, public_id) VALUES (?, ?, ?, ?)', [listId, userId, role, require('crypto').randomBytes(6).toString('hex')]);
    let slFixture;
    async function sharedFixture() {
        if (slFixture) return slFixture;
        for (const [name, id] of Object.entries(SL)) await db.users.ensureUser(id, { username: `sl_${name}`, handle: `sl_${name}`, avatar: null });
        const { list } = await db.tasks.createList(SL.owner, { name: 'Household', priority: 'HIGH' });
        const a = (await db.tasks.addItem(SL.owner, list.id, { name: 'Bins' })).item;
        const b = (await db.tasks.addItem(SL.owner, list.id, { name: 'Dishes', due_date: '2031-01-05' })).item;
        await addMember(list.id, SL.viewer, 'viewer');
        await addMember(list.id, SL.editor, 'editor');
        await addMember(list.id, SL.manager, 'manager');
        const template = await db.templates.createTemplate(SL.owner, { name: 'Weekly', items: [{ name: 'Plan' }] });
        slFixture = { list, a, b, template };
        return slFixture;
    }

    await t.test('access: owner, each role and a stranger on one list', async () => {
        const f = await sharedFixture();
        const conn = db.getPool();
        const as = (user, min) => db.access.forList(conn, SL[user], f.list.id, min);
        for (const [user, role, isOwner] of [['owner', 'manager', true], ['manager', 'manager', false], ['editor', 'editor', false], ['viewer', 'viewer', false]]) {
            const r = await as(user, 'viewer');
            assert.equal(r.role, role, user);
            assert.equal(r.isOwner, isOwner, user);
            assert.equal(r.list.id, f.list.id);
        }
        await assert.rejects(as('stranger', 'viewer'), { code: 'NOT_FOUND' });
        await assert.rejects(as('stranger', 'manager'), { code: 'NOT_FOUND' }, 'a stranger never learns the list exists, whatever role is asked for');
        await assert.rejects(as('viewer', 'editor'), { code: 'FORBIDDEN', message: /view access/ });
        await assert.rejects(as('editor', 'manager'), { code: 'FORBIDDEN' });
        assert.equal((await as('editor', 'editor')).role, 'editor');
        await assert.rejects(db.access.forList(conn, SL.owner, 99999999, 'viewer'), { code: 'NOT_FOUND' });
        await assert.rejects(db.access.forList(conn, SL.owner, 'abc', 'viewer'), { code: 'NOT_FOUND' });
        await assert.rejects(db.access.forItem(conn, SL.stranger, f.a.id), { code: 'NOT_FOUND' });
        assert.equal((await db.access.forItem(conn, SL.viewer, f.a.id)).item.list_name, 'Household');
        assert.equal(await db.access.roleOn(conn, SL.stranger, f.list.id), null);
        assert.equal(await db.access.roleOn(conn, SL.editor, f.list.id), 'editor');
    });

    await t.test('shared lists: role matrix over every task and list operation', async () => {
        const f = await sharedFixture();
        const T = db.tasks;
        // viewer: reads everything, writes nothing
        assert.equal((await T.getList(SL.viewer, f.list.id)).role, 'viewer');
        assert.equal((await T.getItems(SL.viewer, f.list.id)).length, 2);
        assert.equal((await T.getItem(SL.viewer, f.a.id)).name, 'Bins');
        assert.equal((await T.getListByName(SL.viewer, 'Household')).id, f.list.id);
        assert.equal((await T.search(SL.viewer, 'Bins', { scope: 'all' })).tasks.length, 1);
        assert.equal((await T.search(SL.viewer, 'Household')).lists.length, 1);
        for (const [what, call] of [
            ['addItem', () => T.addItem(SL.viewer, f.list.id, { name: 'x' })],
            ['addItems', () => T.addItems(SL.viewer, f.list.id, [{ name: 'x' }])],
            ['addSubtasks', () => T.addSubtasks(SL.viewer, f.a.id, ['x'])],
            ['updateItem', () => T.updateItem(SL.viewer, f.a.id, { name: 'x' })],
            ['updateItem position', () => T.updateItem(SL.viewer, f.a.id, { position: 1 })],
            ['deleteItem', () => T.deleteItem(SL.viewer, f.a.id)],
            ['setItemCompleted', () => T.setItemCompleted(SL.viewer, f.a.id)],
            ['moveItem', () => T.moveItem(SL.viewer, f.a.id, 1)],
            ['swapItemPositions', () => T.swapItemPositions(SL.viewer, f.a.id, f.b.id)],
            ['reorderItems', () => T.reorderItems(SL.viewer, f.list.id, [f.b.id, f.a.id])],
            ['updateList', () => T.updateList(SL.viewer, f.list.id, { name: 'x' })],
            ['deleteList', () => T.deleteList(SL.viewer, f.list.id)],
            ['saveFromList', () => db.templates.saveFromList(SL.viewer, f.list.id)]
        ]) {
            await assert.rejects(call(), { code: 'FORBIDDEN' }, `viewer: ${what}`);
        }
        // editor: tasks yes, list settings no
        for (const [what, call] of [
            ['updateList', () => T.updateList(SL.editor, f.list.id, { name: 'x' })],
            ['deleteList', () => T.deleteList(SL.editor, f.list.id)]
        ]) {
            await assert.rejects(call(), { code: 'FORBIDDEN' }, `editor: ${what}`);
        }
        const added = await T.addItem(SL.editor, f.list.id, { name: 'Recycling' });
        assert.ok(added.item.id);
        assert.equal(added.item.created_by, undefined, 'IDs of other people never come back');
        await T.updateItem(SL.editor, added.item.id, { name: 'Recycling day' });
        await T.moveItem(SL.editor, added.item.id, 0);
        await T.swapItemPositions(SL.editor, added.item.id, f.a.id);
        await T.reorderItems(SL.editor, f.list.id, [f.a.id, f.b.id, added.item.id]);
        const sub = await T.addSubtasks(SL.editor, added.item.id, ['Glass']);
        assert.equal(sub.items.length, 1);
        assert.ok((await db.templates.saveFromList(SL.editor, f.list.id, { name: 'From the house' })).id);
        await T.deleteItem(SL.editor, sub.items[0].item.id);
        await T.deleteItem(SL.editor, added.item.id);
        // manager: list settings yes, delete no (the owner alone destroys a list)
        assert.equal((await T.updateList(SL.manager, f.list.id, { description: 'Chores' })).description, 'Chores');
        await assert.rejects(T.deleteList(SL.manager, f.list.id), { code: 'FORBIDDEN', message: /owner/ });
        // the list the manager gets back never carries the owner's Discord ID; the owner's own copy does
        assert.equal((await T.getList(SL.manager, f.list.id)).discord_id, undefined);
        assert.equal((await T.getList(SL.owner, f.list.id)).discord_id, SL.owner);
        assert.equal((await T.getList(SL.manager, f.list.id)).owner_name, 'sl_owner');
    });

    await t.test('shared lists: list overviews carry sharing fields, owned and shared side by side', async () => {
        const f = await sharedFixture();
        const own = (await db.tasks.createList(SL.editor, { name: 'Household' })).list; // same name as the shared one, different owner
        const mine = await db.tasks.getLists(SL.editor);
        const shared = mine.find((l) => l.id === f.list.id);
        const owned = mine.find((l) => l.id === own.id);
        assert.deepEqual([shared.shared, shared.role, shared.is_owner, shared.owner_name, shared.member_count], [true, 'editor', false, 'sl_owner', 4]);
        assert.deepEqual([owned.shared, owned.role, owned.is_owner, owned.member_count], [false, 'manager', true, 1]);
        assert.equal(shared.discord_id, undefined, 'a shared list does not reveal its owner\'s Discord ID');
        assert.equal((await db.tasks.getListByName(SL.editor, 'Household')).id, own.id, 'an own list wins a name clash');
        assert.equal((await db.tasks.getLists(SL.stranger)).length, 0);
        const ownerView = (await db.tasks.getLists(SL.owner)).find((l) => l.id === f.list.id);
        assert.deepEqual([ownerView.shared, ownerView.role, ownerView.is_owner, ownerView.member_count], [true, 'manager', true, 4]);
        await db.tasks.deleteList(SL.editor, own.id);
    });

    await t.test('shared lists: a member removed while the list is open gets NOT_FOUND on the next call', async () => {
        const f = await sharedFixture();
        await addMember(f.list.id, SL.other, 'editor');
        assert.equal((await db.tasks.getItems(SL.other, f.list.id)).length, 2);
        const read = await db.tasks.getItem(SL.other, f.a.id);
        assert.ok(read);
        await db.query('DELETE FROM list_members WHERE list_id = ? AND discord_id = ?', [f.list.id, SL.other]);
        assert.equal(await db.tasks.getItems(SL.other, f.list.id), null);
        assert.equal(await db.tasks.getItem(SL.other, f.a.id), null);
        assert.equal(await db.tasks.getList(SL.other, f.list.id), null);
        await assert.rejects(db.tasks.addItem(SL.other, f.list.id, { name: 'late' }), { code: 'NOT_FOUND' });
        await assert.rejects(db.tasks.setItemCompleted(SL.other, f.a.id), { code: 'NOT_FOUND' });
        assert.equal((await db.tasks.search(SL.other, 'Bins', { scope: 'all' })).tasks.length, 0);
    });

    await t.test('stranger test: every id-taking function of tasks, templates, transfer and quests refuses a non-member and changes nothing', async () => {
        const f = await sharedFixture();
        const S = SL.stranger;
        const later = new Date('2031-01-01T09:00:00Z');
        // name -> [args after the user, expected]. 'null' = the lookup returns null, 'rejects' = NOT_FOUND.
        const withId = {
            tasks: {
                getList: [[f.list.id], 'null'],
                getListByName: [['Household'], 'null'],
                getItems: [[f.list.id], 'null'],
                getItem: [[f.a.id], 'null'],
                updateList: [[f.list.id, { name: 'pwned' }], 'rejects'],
                deleteList: [[f.list.id], 'rejects'],
                addItem: [[f.list.id, { name: 'pwned' }], 'rejects'],
                addItems: [[f.list.id, [{ name: 'pwned' }]], 'rejects'],
                addSubtasks: [[f.a.id, ['pwned']], 'rejects'],
                updateItem: [[f.a.id, { name: 'pwned' }], 'rejects'],
                deleteItem: [[f.a.id], 'rejects'],
                setItemCompleted: [[f.a.id], 'rejects'],
                swapItemPositions: [[f.a.id, f.b.id], 'rejects'],
                moveItem: [[f.a.id, 0], 'rejects'],
                reorderItems: [[f.list.id, [f.b.id, f.a.id]], 'rejects'],
                snoozeList: [[f.list.id, later], 'rejects'],
                snoozeTask: [[f.b.id, later], 'rejects']
            },
            templates: {
                getTemplate: [[f.template.id], 'rejects'],
                deleteTemplate: [[f.template.id], 'rejects'],
                saveFromList: [[f.list.id], 'rejects'],
                applyTemplate: [[f.template.id], 'rejects']
            }
        };
        // Functions that take no list or task id: they read or write only the caller's own data (checked below), or are not per-user at all.
        const withoutId = {
            tasks: ['getLists', 'createList', 'createListWithItems', 'searchLists', 'searchItems', 'search', 'SEARCH_LIMIT', 'getListsDueOn', 'getReminderCandidates', 'markReminderSent', 'getTaskReminderCandidates', 'markTaskReminderSent', 'markDeadlineNotified', 'cleanupOldLists', 'asOwner', 'completionContext', 'mayDelete'],
            templates: ['MAX_TEMPLATES', 'MAX_ITEMS', 'parseTemplateInput', 'listTemplates', 'createTemplate'],
            transfer: ['LIMITS', 'exportAll', 'toCsv', 'importAll', 'parseImport', 'regenerateCalendarToken', 'getCalendarToken', 'clearCalendarToken', 'findUserByCalendarToken', 'getCalendarData'],
            quests: ['getQuests', 'claimQuest']
        };
        for (const mod of ['tasks', 'templates', 'transfer', 'quests']) {
            const classified = new Set([...Object.keys(withId[mod] || {}), ...(withoutId[mod] || [])]);
            const exported = Object.keys(db[mod]);
            const unclassified = exported.filter((n) => !classified.has(n));
            assert.deepEqual(unclassified, [], `db.${mod}: classify new exports in the stranger test (id-taking functions need a case)`);
            assert.deepEqual([...classified].filter((n) => !exported.includes(n)), [], `db.${mod}: stale entries`);
        }

        const snapshot = async () => {
            const out = {};
            for (const table of ['lists', 'items', 'list_members', 'list_reminders', 'item_reminders', 'task_templates']) {
                out[table] = JSON.stringify((await pool.query(`SELECT * FROM ${table} ORDER BY 1, 2`))[0]);
            }
            out.stranger = JSON.stringify((await pool.query('SELECT player_xp, total_items_added, total_items_completed, total_lists_created FROM users WHERE discord_id = ?', [S]))[0]);
            out.xp = JSON.stringify((await pool.query('SELECT COUNT(*) AS n FROM xp_transactions'))[0]);
            return out;
        };
        const ownTemplate = await db.templates.createTemplate(S, { name: 'Mine', items: [{ name: 't' }] });
        const before = await snapshot();
        for (const [mod, fns] of Object.entries(withId)) {
            for (const [name, [args, expected]] of Object.entries(fns)) {
                const call = () => db[mod][name](S, ...args);
                if (expected === 'null') assert.equal(await call(), null, `${mod}.${name} returns null for a stranger`);
                else await assert.rejects(call(), { code: 'NOT_FOUND' }, `${mod}.${name} throws NOT_FOUND for a stranger`);
            }
        }
        await assert.rejects(db.templates.applyTemplate(S, ownTemplate.id, { listId: f.list.id }), { code: 'NOT_FOUND' }, 'a stranger cannot apply even their own template to another list');
        assert.deepEqual(await db.tasks.searchLists(S, 'Household'), []);
        assert.deepEqual(await db.tasks.searchItems(S, 'Bins'), []);
        // The id-less readers see only the stranger's own (empty) world.
        assert.deepEqual(await db.tasks.getLists(S), []);
        assert.deepEqual(await db.tasks.search(S, 'Bins', { scope: 'all' }), { lists: [], tasks: [] });
        assert.deepEqual((await db.templates.listTemplates(S)).map((x) => x.name), ['Mine'], 'only their own template');
        assert.deepEqual((await db.transfer.exportAll(S)).lists, []);
        assert.deepEqual(await db.transfer.getCalendarData(S), { lists: [], items: [] });
        assert.deepEqual(await snapshot(), before, 'nothing was written by any refused call');
    });

    await t.test('shared lists: the export holds only what the exporter owns, the calendar also what is shared with them', async () => {
        const f = await sharedFixture();
        assert.equal((await db.transfer.exportAll(SL.editor)).lists.some((l) => l.name === 'Household'), false);
        assert.equal((await db.transfer.exportAll(SL.owner)).lists.some((l) => l.name === 'Household'), true);
        const cal = await db.transfer.getCalendarData(SL.viewer);
        assert.ok(cal.items.some((i) => i.id === f.b.id), 'a task with a due date on a shared list is in a member\'s calendar');
        assert.equal((await db.transfer.getCalendarData(SL.stranger)).items.length, 0);
    });


    // ─── Shared lists: the actor gets the rewards ─────────────────────────────────

    await t.test('shared lists: completions, XP, caps, quests, review and stats belong to the person who acted', async () => {
        const AC = { owner: '200000000000000311', editor: '200000000000000312' };
        for (const [k, id] of Object.entries(AC)) await db.users.ensureUser(id, { username: `ac_${k}`, handle: `ac_${k}`, avatar: null });
        const { list } = await db.tasks.createList(AC.owner, { name: 'Team board' });
        await addMember(list.id, AC.editor, 'editor');
        const ids = [];
        for (const n of ['one', 'two', 'three']) ids.push((await db.tasks.addItem(AC.owner, list.id, { name: n, priority: 'HIGH' })).item.id);
        const xpBefore = async (id) => Number((await db.users.getUser(id)).player_xp);
        const [ownerXp, editorXp] = [await xpBefore(AC.owner), await xpBefore(AC.editor)];

        const done = await db.tasks.setItemCompleted(AC.editor, ids[0]);
        assert.equal(done.firstCompletion, true);
        assert.ok(done.xp.finalXP > 0, 'the editor was paid');
        assert.equal(await xpBefore(AC.owner), ownerXp, 'the owner got nothing for the editor\'s work');
        assert.ok((await xpBefore(AC.editor)) > editorXp);
        assert.equal(Number((await db.users.getUser(AC.owner)).total_items_completed), 0);
        assert.equal(Number((await db.users.getUser(AC.editor)).total_items_completed), 1);
        const [[row]] = await pool.query('SELECT completed_by, first_completed_by, created_by FROM items WHERE id = ?', [ids[0]]);
        assert.deepEqual({ ...row }, { completed_by: AC.editor, first_completed_by: AC.editor, created_by: AC.owner });
        assert.equal((await db.tasks.getItems(AC.owner, list.id)).find((i) => i.id === ids[0]).completed_by_name, 'ac_editor', 'a display name, never an ID');
        assert.equal(JSON.stringify(await db.tasks.getItems(AC.owner, list.id)).includes(AC.editor), false, 'no Discord ID in the items');

        // Un-checking by the owner and re-checking pays nobody again and keeps the first completer.
        await db.tasks.setItemCompleted(AC.owner, ids[0], false);
        const again = await db.tasks.setItemCompleted(AC.owner, ids[0], true);
        assert.equal(again.firstCompletion, false);
        assert.equal(again.xp, null);
        assert.equal((await pool.query('SELECT first_completed_by FROM items WHERE id = ?', [ids[0]]))[0][0].first_completed_by, AC.editor);
        assert.equal((await pool.query('SELECT completed_by FROM items WHERE id = ?', [ids[0]]))[0][0].completed_by, AC.owner, 'the current completer follows the last toggle');

        // Quests: the editor finished a high-priority task, the owner did not (and the owner added all three).
        const prog = async (id, key) => (await db.quests.getQuests(id)).find((q) => q.key === key).progress;
        assert.equal(await prog(AC.editor, 'DAILY_HIGH_1'), 1);
        assert.equal(await prog(AC.owner, 'DAILY_HIGH_1'), 0);
        assert.equal(await prog(AC.editor, 'DAILY_ADD_3'), 0, 'adding counts for whoever added');
        assert.equal(await prog(AC.owner, 'DAILY_ADD_3'), 3);
        assert.equal((await db.review.getReview(AC.editor)).completed, 1);
        assert.equal((await db.review.getReview(AC.owner)).completed, 0);
        assert.equal((await db.stats.getStatsSummary(AC.editor)).tasksCompleted7d, 1);
        assert.equal((await db.stats.getStatsSummary(AC.owner)).tasksCompleted7d, 0);
        assert.equal((await db.stats.getXPHistory(AC.editor, 7)).reduce((n, d) => n + d.tasksCompleted, 0), 1);
        assert.equal((await db.users.getWeeklyStats(AC.editor)).completed, 0, 'the digest counts the current completer, and the owner re-checked it');
        assert.equal((await db.users.getWeeklyStats(AC.owner)).completed, 1, 'the owner\'s last toggle was theirs');
        assert.equal((await db.users.getWeeklyStats(AC.editor)).listsOpen, 1, 'a shared list with open tasks is open for the member too');

        // Clearing the list pays the person who finished it, and the "clear lists" quest counts them.
        await db.tasks.setItemCompleted(AC.editor, ids[1]);
        const last = await db.tasks.setItemCompleted(AC.editor, ids[2]);
        assert.ok(last.bonuses.some((b) => b.key === 'list_cleared'), 'the editor earned the cleared bonus');
        assert.equal((await pool.query('SELECT cleared_by FROM lists WHERE id = ?', [list.id]))[0][0].cleared_by, AC.editor);
        assert.equal((await pool.query("SELECT COUNT(*) AS n FROM xp_transactions WHERE discord_id = ? AND source = 'list_cleared'", [AC.owner]))[0][0].n, 0);
        assert.equal((await pool.query("SELECT COUNT(*) AS n FROM xp_transactions WHERE discord_id = ? AND source = 'list_cleared'", [AC.editor]))[0][0].n, 1);
    });

    await t.test('shared lists: daily completion caps count the actor, not the list owner', async () => {
        const CAP = { owner: '200000000000000321', editor: '200000000000000322' };
        for (const [k, id] of Object.entries(CAP)) await db.users.ensureUser(id, { username: `cap_${k}`, handle: `cap_${k}`, avatar: null });
        const { list } = await db.tasks.createList(CAP.owner, { name: 'Cap board' });
        await addMember(list.id, CAP.editor, 'editor');
        const { LIMITS } = require('../src');
        const ids = [];
        // Fill the OWNER's completion cap on their own list...
        const { list: mine } = await db.tasks.createList(CAP.owner, { name: 'Owner own' });
        await db.query(
            `INSERT INTO xp_transactions (discord_id, amount, source, balance_before, balance_after, created_at)
             SELECT ?, 1, 'item_complete', 0, 1, CURRENT_TIMESTAMP FROM generate_series(1, ${LIMITS.ITEM_COMPLETE_REWARDS_PER_DAY})`,
            [CAP.owner]
        );
        const own = (await db.tasks.addItem(CAP.owner, mine.id, { name: 'capped' })).item;
        const capped = await db.tasks.setItemCompleted(CAP.owner, own.id);
        assert.ok(!capped.xp || capped.xp.finalXP === 0 || capped.xp.capped, 'the owner is at the cap');
        // ...the editor, who has done nothing today, is still paid on the owner's shared list.
        ids.push((await db.tasks.addItem(CAP.owner, list.id, { name: 'fresh' })).item.id);
        const paid = await db.tasks.setItemCompleted(CAP.editor, ids[0]);
        assert.ok(paid.xp && paid.xp.finalXP > 0 && !paid.xp.capped, 'the editor\'s own counter decides');
    });

    await t.test('shared lists: the AI-facing owner-only services refuse a member and never widen access', async () => {
        const f = await sharedFixture();
        const O = db.tasks.asOwner;
        const before = (await pool.query('SELECT COUNT(*) AS n FROM items WHERE list_id = ?', [f.list.id]))[0][0].n;
        await assert.rejects(O.addItem(SL.editor, f.list.id, { name: 'ai' }), { code: 'NOT_FOUND' }, 'even an editor');
        await assert.rejects(O.addItem(SL.manager, f.list.id, { name: 'ai' }), { code: 'NOT_FOUND' });
        await assert.rejects(O.updateItem(SL.editor, f.a.id, { name: 'ai' }), { code: 'NOT_FOUND' });
        await assert.rejects(O.setItemCompleted(SL.editor, f.a.id), { code: 'NOT_FOUND' });
        await assert.rejects(O.addSubtasks(SL.editor, f.a.id, ['ai']), { code: 'NOT_FOUND' });
        await assert.rejects(O.updateList(SL.manager, f.list.id, { name: 'ai' }), { code: 'NOT_FOUND' });
        await assert.rejects(O.addItem(SL.stranger, f.list.id, { name: 'ai' }), { code: 'NOT_FOUND' });
        assert.equal((await pool.query('SELECT COUNT(*) AS n FROM items WHERE list_id = ?', [f.list.id]))[0][0].n, before);
        assert.ok((await O.addItem(SL.owner, f.list.id, { name: 'ai ok' })).item.id, 'the owner is served');
        const created = await O.createListWithItems(SL.owner, { name: 'AI made' }, ['x']);
        assert.equal(created.items.length, 1);
    });

    await t.test('shared lists: auto-delete never removes a list that has members', async () => {
        const CL = { owner: '200000000000000331', member: '200000000000000332' };
        for (const [k, id] of Object.entries(CL)) await db.users.ensureUser(id, { username: `cl_${k}`, handle: `cl_${k}`, avatar: null });
        const mk = async (name, shared) => {
            const { list } = await db.tasks.createList(CL.owner, { name });
            const { item } = await db.tasks.addItem(CL.owner, list.id, { name: 'only' });
            await db.tasks.setItemCompleted(CL.owner, item.id);
            await db.query('UPDATE items SET updated_at = CURRENT_TIMESTAMP - make_interval(days => 30) WHERE list_id = ?', [list.id]);
            if (shared) await addMember(list.id, CL.member, 'viewer');
            return list.id;
        };
        const solo = await mk('Solo old', false);
        const withMember = await mk('Shared old', true);
        const deleted = (await db.tasks.cleanupOldLists(5)).map((d) => d.id);
        assert.ok(deleted.includes(solo));
        assert.ok(!deleted.includes(withMember));
        assert.ok(await db.tasks.getList(CL.member, withMember));
    });

    await t.test('shared lists: reminders go to every member with automation on, once each, with their own snooze', async () => {
        const RM = { owner: '200000000000000341', viewer: '200000000000000342', editor: '200000000000000343', quiet: '200000000000000344' };
        for (const [k, id] of Object.entries(RM)) await db.users.ensureUser(id, { username: `rm_${k}`, handle: `rm_${k}`, avatar: null });
        await db.users.updateSettings(RM.quiet, { automation_enabled: false });
        const today = new Date().toISOString().slice(0, 10);
        const { list } = await db.tasks.createList(RM.owner, { name: 'Due today', deadline: today });
        const { item } = await db.tasks.addItem(RM.owner, list.id, { name: 'Ship it', due_date: today });
        const { list: l2 } = await db.tasks.createList(RM.owner, { name: 'No deadline' });
        const { item: due } = await db.tasks.addItem(RM.owner, l2.id, { name: 'Own due', due_date: today });
        for (const [id, role] of [[RM.viewer, 'viewer'], [RM.editor, 'editor'], [RM.quiet, 'viewer']]) {
            await addMember(list.id, id, role);
            await addMember(l2.id, id, role);
        }
        const rows = async () => (await db.tasks.getReminderCandidates()).filter((r) => r.id === list.id);
        const who = (rs) => rs.map((r) => r.discord_id).sort();
        assert.deepEqual(who(await rows()), [RM.owner, RM.viewer, RM.editor].sort(), 'the member with automation off is skipped');
        assert.ok((await rows()).every((r) => r.owner_id === RM.owner));

        await db.tasks.markReminderSent(list.id, 'due', { late: false, recipientId: RM.viewer });
        const flags = Object.fromEntries((await rows()).map((r) => [r.discord_id, Number(r.deadline_notified)]));
        assert.deepEqual(flags, { [RM.owner]: 0, [RM.viewer]: 1, [RM.editor]: 0 }, 'one member\'s reminder is not another\'s');
        await db.tasks.markReminderSent(list.id, 'due', { late: false }); // the owner (old call shape)
        assert.equal(Number((await rows()).find((r) => r.discord_id === RM.owner).deadline_notified), 1);

        // Each person's snooze is their own.
        await db.tasks.snoozeList(RM.editor, list.id, new Date(Date.now() - 1000));
        assert.equal((await db.query('SELECT remind_at FROM lists WHERE id = ?', [list.id]))[0].remind_at, null, 'a member\'s snooze does not touch the owner\'s');
        assert.ok((await rows()).find((r) => r.discord_id === RM.editor).remind_at);
        await db.tasks.markReminderSent(list.id, 'snooze', { late: false, pastDeadline: true, recipientId: RM.editor });
        assert.equal((await rows()).find((r) => r.discord_id === RM.editor).remind_at, null);
        await assert.rejects(db.tasks.snoozeList('200000000000000349', list.id, new Date()), { code: 'NOT_FOUND' });

        // A new deadline re-arms everyone (an unchanged one does not, see the re-arm limits test).
        await db.tasks.updateList(RM.owner, list.id, { deadline: new Date(Date.parse(`${today}T00:00:00Z`) - 86400e3).toISOString().slice(0, 10) });
        await db.tasks.updateList(RM.owner, list.id, { deadline: today });
        assert.deepEqual((await rows()).map((r) => Number(r.deadline_notified)), [0, 0, 0]);

        // Task reminders: the same per-person state.
        const taskRows = async (id) => (await db.tasks.getTaskReminderCandidates()).filter((r) => r.id === id);
        assert.deepEqual(who(await taskRows(due.id)), [RM.owner, RM.viewer, RM.editor].sort());
        await db.tasks.markTaskReminderSent(due.id, new Date(), RM.viewer);
        assert.deepEqual(who(await taskRows(due.id)), [RM.owner, RM.editor].sort(), 'the viewer was reminded once');
        await db.tasks.markTaskReminderSent(due.id, new Date());
        assert.deepEqual(who(await taskRows(due.id)), [RM.editor]);
        await db.tasks.snoozeTask(RM.viewer, due.id, new Date(Date.now() - 1000));
        assert.deepEqual(who(await taskRows(due.id)), [RM.viewer, RM.editor].sort());
        assert.equal(item.list_id, list.id);
        // A task due on the list's deadline day is left to the list reminder, for members as well.
        assert.deepEqual(await taskRows(item.id), []);
    });


    // ─── Sharing service ──────────────────────────────────────────────────────────

    await t.test('sharing service: caps, expiry, ambiguity, per-day limit and removal clean-up', async () => {
        const S = db.sharing;
        const O = '200000000000000701';
        await db.users.ensureUser(O, { username: 'svc_owner', handle: 'svc_owner', avatar: null });
        const mkUser = async (n, name) => {
            const id = `2000000000000007${String(n).padStart(2, '0')}`;
            await db.users.ensureUser(id, { username: name, avatar: null });
            return id;
        };
        const { list } = await db.tasks.createList(O, { name: 'Service list' });
        const { LIMITS } = require('../src');

        // Named lookups: exact stored name, a bot may pass an ID, an ambiguous name is refused, an unknown one is a 404.
        const a = await mkUser(10, 'svc_alpha');
        assert.deepEqual(await S.invite(O, list.id, { username: 'svc_alph' }), { sent: false }, 'exact names only: nobody, and no hint');
        assert.deepEqual(await S.invite(O, list.id, { discordId: '299999999999999999' }), { sent: false });
        await assert.rejects(S.invite(O, list.id, { discordId: O }), { code: 'VALIDATION' });
        await assert.rejects(S.invite(O, list.id, { username: '' }), { code: 'VALIDATION' });
        const first = await S.invite(O, list.id, { discordId: a, role: 'editor' });
        assert.equal(first.inviteeName, 'svc_alpha');
        assert.ok(first.expiresAt.getTime() > Date.now() + 6.9 * 86400e3 && first.expiresAt.getTime() < Date.now() + 7.1 * 86400e3, '7 days');
        await assert.rejects(S.invite(O, list.id, { discordId: a }), { code: 'CONFLICT' });

        // Expiry: an old invitation cannot be accepted, no longer shows up and no longer blocks a new one.
        await db.query('UPDATE list_invites SET expires_at = CURRENT_TIMESTAMP - make_interval(hours => 1) WHERE id = ?', [first.id]);
        assert.deepEqual(await S.listInvites(a), []);
        await assert.rejects(S.respond(a, first.id, true), { code: 'CONFLICT', message: /expired/ });
        const second = await S.invite(O, list.id, { discordId: a, role: 'viewer' });
        assert.deepEqual((await S.listInvites(a)).map((i) => i.id), [second.id]);
        assert.deepEqual(await S.respond(a, second.id, true), { accepted: true, list: { id: list.id, name: 'Service list' }, role: 'viewer' });
        await assert.rejects(S.invite(O, list.id, { discordId: a }), { code: 'CONFLICT', message: /already on this list/ });

        // Declined invitations can be sent again.
        const b = await mkUser(13, 'svc_bravo');
        const declined = await S.invite(O, list.id, { discordId: b });
        assert.equal((await S.respond(b, declined.id, false)).accepted, false);
        await assert.rejects(S.respond(b, declined.id, true), { code: 'CONFLICT' });
        // ...but not by the same inviter within the cooldown, and the inviter is not told (nothing is sent, nothing is stored).
        assert.deepEqual(await S.invite(O, list.id, { discordId: b }), { sent: false });
        assert.equal((await db.query("SELECT COUNT(*) AS n FROM list_invites WHERE invitee_discord_id = ? AND status = 'pending'", [b]))[0].n, 0);
        await db.query('UPDATE list_invites SET created_at = CURRENT_TIMESTAMP - make_interval(days => 8), responded_at = CURRENT_TIMESTAMP - make_interval(days => 8) WHERE id = ?', [declined.id]);
        const retry = await S.invite(O, list.id, { discordId: b });
        assert.ok(retry.sent && retry.id > declined.id, 'after the cooldown they can be invited again');

        // The cap counts members and pending invitations together.
        for (let n = 20; n < 20 + LIMITS.MAX_LIST_MEMBERS - 2; n++) await S.invite(O, list.id, { discordId: await mkUser(n, `svc_fill${n}`) });
        const overflow = await mkUser(40, 'svc_over');
        await assert.rejects(S.invite(O, list.id, { discordId: overflow }), { code: 'VALIDATION', message: /at most 10/ });

        // Removing a member also removes their private reminder state; leaving works the same; the owner cannot leave.
        const { item } = await db.tasks.addItem(O, list.id, { name: 'Due', due_date: '2031-02-02' });
        await db.tasks.snoozeList(a, list.id, new Date(Date.now() + 3600e3));
        await db.tasks.snoozeTask(a, item.id, new Date(Date.now() + 3600e3));
        assert.equal((await db.query('SELECT COUNT(*) AS n FROM list_reminders WHERE discord_id = ?', [a]))[0].n, 1);
        const key = (await S.listMembers(O, list.id)).members.find((m) => m.name === 'svc_alpha').memberKey;
        await S.removeMember(O, list.id, key);
        assert.equal((await db.query('SELECT COUNT(*) AS n FROM list_reminders WHERE discord_id = ?', [a]))[0].n, 0);
        assert.equal((await db.query('SELECT COUNT(*) AS n FROM item_reminders WHERE discord_id = ?', [a]))[0].n, 0);
        await assert.rejects(S.removeMember(O, list.id, key), { code: 'NOT_FOUND' });
        await assert.rejects(S.leave(O, list.id), { code: 'FORBIDDEN' });
        await assert.rejects(S.leave(a, list.id), { code: 'NOT_FOUND' }, 'no longer a member');
        assert.equal((await S.respond(b, retry.id, true)).accepted, true);
        assert.equal(await S.leave(b, list.id), true);
        assert.equal(await db.tasks.getList(b, list.id), null);

        // Deleting the list or the user clears the sharing rows.
        await db.tasks.deleteList(O, list.id);
        assert.equal((await db.query('SELECT COUNT(*) AS n FROM list_invites WHERE list_id = ?', [list.id]))[0].n, 0);
        assert.equal((await db.query('SELECT COUNT(*) AS n FROM list_members WHERE list_id = ?', [list.id]))[0].n, 0);
    });

    await t.test('sharing service: the per-day invitation limit and managers\' limits', async () => {
        const S = db.sharing;
        const O = '200000000000000751';
        const M = '200000000000000752';
        await db.users.ensureUser(O, { username: 'lim_owner', handle: 'lim_owner', avatar: null });
        await db.users.ensureUser(M, { username: 'lim_manager', handle: 'lim_manager', avatar: null });
        const { list } = await db.tasks.createList(O, { name: 'Limits' });
        const inv = await S.invite(O, list.id, { discordId: M, role: 'manager' });
        await S.respond(M, inv.id, true);
        const T = '200000000000000753';
        await db.users.ensureUser(T, { username: 'lim_target', handle: 'lim_target', avatar: null });
        await assert.rejects(S.invite(M, list.id, { discordId: T, role: 'manager' }), { code: 'FORBIDDEN' });
        const ti = await S.invite(M, list.id, { discordId: T, role: 'editor' });
        await S.respond(T, ti.id, true);
        const members = (await S.listMembers(M, list.id)).members;
        assert.deepEqual(members.map((x) => x.name), ['lim_owner', 'lim_manager', 'lim_target']);
        assert.equal(JSON.stringify(members).match(/\d{15,}/), null, 'no Discord ID in the member list');
        await assert.rejects(S.setRole(M, list.id, 'owner', 'viewer'), { code: 'NOT_FOUND' }, 'the owner has no row to change');
        await assert.rejects(S.setRole(T, list.id, members[1].memberKey, 'viewer'), { code: 'FORBIDDEN' });
        await assert.rejects(S.setRole(M, list.id, members[1].memberKey, 'viewer'), { code: 'FORBIDDEN', message: /owner/ }, 'a manager cannot demote another manager');
        await assert.rejects(S.removeMember(M, list.id, members[1].memberKey), { code: 'FORBIDDEN' });
        assert.deepEqual(await S.setRole(O, list.id, members[1].memberKey, 'editor'), { memberKey: members[1].memberKey, role: 'editor' });
        // Invitations per day: after INVITES_PER_DAY recorded sends the next is refused (429).
        const { LIMITS } = require('../src');
        await db.query(
            `INSERT INTO list_invites (list_id, invitee_discord_id, role, invited_by, expires_at, status)
             SELECT ?, ?, 'viewer', ?, CURRENT_TIMESTAMP + make_interval(days => 1), 'declined' FROM generate_series(1, ${LIMITS.INVITES_PER_DAY})`,
            [list.id, T, O]
        );
        const X = '200000000000000754';
        await db.users.ensureUser(X, { username: 'lim_extra', handle: 'lim_extra', avatar: null });
        await assert.rejects(S.invite(O, list.id, { discordId: X }), { code: 'RATE_LIMITED', status: 429 });
        // The limit does not depend on who is invited, so it can't be used to find out which usernames exist.
        await assert.rejects(S.invite(O, list.id, { username: 'nobody_has_this_name' }), { code: 'RATE_LIMITED', status: 429 });
    });

    await t.test('invite identity: the exact Discord username only, never the display name; a dry run shows who it resolved to', async () => {
        const S = db.sharing;
        const O = '200000000000000761';
        const A = '200000000000000762';
        const B = '200000000000000763';
        await db.users.ensureUser(O, { username: 'Owner Olive', handle: 'ident_owner', avatar: null });
        // Two different people chose the same display name; one's display name is also the other's Discord username.
        await db.users.ensureUser(A, { username: 'Bob Smith', handle: 'ident_bob_a', avatar: 'abc123' });
        await db.users.ensureUser(B, { username: 'ident_bob_a', handle: 'ident_bob_b', avatar: null });
        const { list } = await db.tasks.createList(O, { name: 'Identity' });

        // The display name is never searched: not the shared one, and not the one that looks like somebody else's username.
        await assert.rejects(S.invite(O, list.id, { username: 'Bob Smith' }), { code: 'VALIDATION' });
        const viaOther = await S.invite(O, list.id, { username: 'ident_bob_a', dryRun: true });
        assert.equal(viaOther.name, 'Bob Smith', 'ident_bob_a is A\'s username, even though it is B\'s display name');
        // Case does not matter on input (Discord usernames are lowercase), accents and look-alikes do not match.
        assert.equal((await S.invite(O, list.id, { username: '@IDENT_BOB_B', dryRun: true })).name, 'ident_bob_a');
        await assert.rejects(S.invite(O, list.id, { username: 'ident_bób_b' }), { code: 'VALIDATION' });
        assert.deepEqual(await S.invite(O, list.id, { username: 'ident_bob_' }), { sent: false }, 'no prefix match');
        assert.equal((await db.query('SELECT COUNT(*) AS n FROM list_invites WHERE list_id = ?', [list.id]))[0].n, 0, 'a dry run invites nobody');

        // The dry run says who it is (display name and an avatar, no ids) and still runs every check.
        assert.deepEqual(Object.keys(viaOther).sort(), ['avatarUrl', 'dryRun', 'name']);
        assert.equal(viaOther.avatarUrl, null, 'a custom avatar address would contain the Discord ID, so it is not sent');
        const withDefault = await S.invite(O, list.id, { username: 'ident_bob_b', dryRun: true });
        assert.match(withDefault.avatarUrl, /^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
        assert.equal(JSON.stringify([viaOther, withDefault]).match(/\d{15,}/), null);
        await assert.rejects(S.invite(O, list.id, { username: 'ident_owner', dryRun: true }), { code: 'VALIDATION' }, 'no self-invite even as a dry run');
        await assert.rejects(S.invite(A, list.id, { username: 'ident_bob_b', dryRun: true }), { code: 'NOT_FOUND' }, 'a stranger cannot even preview');

        // A real invitation goes to exactly that account.
        const sent = await S.invite(O, list.id, { username: 'ident_bob_b' });
        assert.equal(sent.inviteeDiscordId, B);
        assert.deepEqual((await S.listInvites(A)).length, 0);

        // A handle belongs to one account: when someone else logs in with it, the stale holder loses it; no handle passed keeps the old one.
        await db.users.ensureUser(B, { username: 'Renamed B', avatar: null });
        assert.equal((await db.users.getUser(B)).discord_handle, 'ident_bob_b', 'a login without a handle leaves it alone');
        await db.users.ensureUser(A, { username: 'Bob Smith', handle: 'ident_bob_b', avatar: 'abc123' });
        assert.equal((await db.users.getUser(A)).discord_handle, 'ident_bob_b');
        assert.equal((await db.users.getUser(B)).discord_handle, null, 'the account that renamed on Discord no longer answers to the old username');
        assert.deepEqual(await S.invite(O, list.id, { username: 'ident_bob_a', dryRun: true }), { dryRun: true, name: null, avatarUrl: null });
        assert.equal((await S.invite(O, list.id, { username: 'ident_bob_b', dryRun: true })).name, 'Bob Smith');

        // Parties work the same way.
        await db.parties.create(O, 'Identity party');
        assert.equal((await db.parties.invite(O, { username: 'ident_bob_b', dryRun: true })).name, 'Bob Smith');
        await assert.rejects(db.parties.invite(O, { username: 'Bob Smith' }), { code: 'VALIDATION' });
        assert.equal((await db.query('SELECT COUNT(*) AS n FROM party_invites WHERE invited_by = ?', [O]))[0].n, 0, 'a dry run invites nobody');
    });

    await t.test('invite abuse: a decline cooldown per inviter and person, and a switch that turns every invitation off', async () => {
        const S = db.sharing;
        const { LIMITS } = require('../src');
        const mk = async (n) => {
            const id = `2000000000000012${String(n).padStart(2, '0')}`;
            await db.users.ensureUser(id, { username: `abuse_${n}`, handle: `abuse_${n}`, avatar: null });
            return id;
        };
        const [O, M, V, W] = [await mk(1), await mk(2), await mk(3), await mk(4)];
        const { list } = await db.tasks.createList(O, { name: 'Abuse list' });
        const { list: other } = await db.tasks.createList(O, { name: 'Abuse list 2' });
        assert.equal(LIMITS.INVITE_DECLINE_COOLDOWN_DAYS, 7);

        // Declining blocks the SAME inviter for 7 days, on any of their lists; nothing is sent and nothing is stored.
        await S.respond(M, (await S.invite(O, list.id, { discordId: M, role: 'manager' })).id, true);
        const first = await S.invite(O, list.id, { discordId: V });
        await S.respond(V, first.id, false);
        assert.deepEqual(await S.invite(O, list.id, { discordId: V }), { sent: false });
        assert.deepEqual(await S.invite(O, other.id, { username: 'abuse_3' }), { sent: false }, 'a different list of the same inviter, by username');
        assert.deepEqual(await S.invite(O, list.id, { username: 'abuse_3', dryRun: true }), { dryRun: true, name: null, avatarUrl: null }, 'a dry run says nothing either');
        assert.equal((await S.listInvites(V)).length, 0);
        // Another inviter (a manager) is not blocked by it.
        const viaManager = await S.invite(M, list.id, { discordId: V, role: 'viewer' });
        assert.equal(viaManager.sent, true);
        await S.respond(V, viaManager.id, false);
        assert.deepEqual(await S.invite(M, list.id, { discordId: V }), { sent: false }, 'the manager now has their own cooldown');
        // After the cooldown (counted from when the declined invitation was made) it works again.
        await db.query("UPDATE list_invites SET created_at = CURRENT_TIMESTAMP - make_interval(days => 8), responded_at = CURRENT_TIMESTAMP - make_interval(days => 8) WHERE invitee_discord_id = ? AND status = 'declined'", [V]);
        assert.equal((await S.invite(O, list.id, { discordId: V })).sent, true);

        // Parties have the same cooldown (their own declines).
        await db.parties.create(O, 'Abuse party');
        const pi = await db.parties.invite(O, { discordId: W });
        assert.equal(pi.sent, true);
        await db.parties.respond(W, pi.id, false);
        assert.deepEqual(await db.parties.invite(O, { discordId: W }), { sent: false });
        assert.equal((await db.parties.invite(O, { username: 'abuse_4', dryRun: true })).name, null);
        await db.query("UPDATE party_invites SET created_at = CURRENT_TIMESTAMP - make_interval(days => 8), responded_at = CURRENT_TIMESTAMP - make_interval(days => 8) WHERE invitee_discord_id = ?", [W]);
        assert.equal((await db.parties.invite(O, { discordId: W })).sent, true);

        // The switch: with invitations off nothing is sent to a list or a party, by name or by ID, and the answer gives nothing away.
        const X = await mk(5);
        assert.equal((await db.users.getUser(X)).accept_invites, 1, 'on by default');
        await db.users.updateSettings(X, { accept_invites: false });
        assert.equal((await db.users.getUser(X)).accept_invites, 0);
        assert.deepEqual(await S.invite(O, list.id, { discordId: X }), { sent: false });
        assert.deepEqual(await S.invite(O, list.id, { username: 'abuse_5' }), { sent: false });
        assert.deepEqual(await S.invite(O, list.id, { username: 'abuse_5', dryRun: true }), { dryRun: true, name: null, avatarUrl: null });
        assert.deepEqual(await db.parties.invite(O, { discordId: X }), { sent: false });
        assert.equal((await db.query('SELECT COUNT(*) AS n FROM list_invites WHERE invitee_discord_id = ?', [X]))[0].n, 0);
        assert.equal((await db.query('SELECT COUNT(*) AS n FROM party_invites WHERE invitee_discord_id = ?', [X]))[0].n, 0);
        await db.users.updateSettings(X, { accept_invites: true });
        assert.equal((await S.invite(O, list.id, { discordId: X })).sent, true);
        assert.equal((await db.parties.invite(O, { discordId: X })).sent, true);
    });

    await t.test('invitations do not outlive their inviter: removal, demotion, leaving and a void inviter', async () => {
        const S = db.sharing;
        const mk = async (n) => {
            const id = `2000000000000013${String(n).padStart(2, '0')}`;
            await db.users.ensureUser(id, { username: `outl_${n}`, handle: `outl_${n}`, avatar: null });
            return id;
        };
        const [O, M, X, Y, Z] = [await mk(1), await mk(2), await mk(3), await mk(4), await mk(5)];
        const { list } = await db.tasks.createList(O, { name: 'Outlive' });
        await S.respond(M, (await S.invite(O, list.id, { discordId: M, role: 'manager' })).id, true);
        const keyM = async () => (await S.listMembers(O, list.id)).members.find((m) => m.name === 'outl_2').memberKey;
        const pendingOf = async (id) => (await S.listInvites(id)).length;

        // Demoting the manager below manager voids what they sent; the owner's own invitations stay.
        await S.invite(M, list.id, { discordId: X });
        await S.invite(M, list.id, { discordId: Y });
        await S.invite(O, list.id, { discordId: Z });
        assert.deepEqual([await pendingOf(X), await pendingOf(Y), await pendingOf(Z)], [1, 1, 1]);
        await S.setRole(O, list.id, await keyM(), 'editor');
        assert.deepEqual([await pendingOf(X), await pendingOf(Y), await pendingOf(Z)], [0, 0, 1], 'only the demoted manager\'s invitations are withdrawn');
        // A change that keeps the manager role withdraws nothing.
        await S.setRole(O, list.id, await keyM(), 'manager');
        const kept = await S.invite(M, list.id, { discordId: X });
        await S.setRole(O, list.id, await keyM(), 'manager');
        assert.equal(await pendingOf(X), 1);

        // Removing the manager, or the manager leaving, does the same.
        await S.removeMember(O, list.id, await keyM());
        assert.equal(await pendingOf(X), 0);
        await assert.rejects(S.respond(X, kept.id, true), { code: 'CONFLICT' });
        await S.respond(M, (await S.invite(O, list.id, { discordId: M, role: 'manager' })).id, true);
        await S.invite(M, list.id, { discordId: Y });
        await S.leave(M, list.id);
        assert.equal(await pendingOf(Y), 0);

        // Even a row that is still pending (say, left over from before this fix) cannot be accepted once its inviter is no longer a manager.
        await S.respond(M, (await S.invite(O, list.id, { discordId: M, role: 'manager' })).id, true);
        const stale = await S.invite(M, list.id, { discordId: X });
        await db.query("UPDATE list_members SET role = 'viewer' WHERE list_id = ? AND discord_id = ?", [list.id, M]); // demoted behind the service's back
        await assert.rejects(S.respond(X, stale.id, true), { code: 'CONFLICT', message: /no longer open/ });
        assert.equal(await db.tasks.getList(X, list.id), null, 'X did not get in');
        assert.equal(await pendingOf(X), 0, 'and the invitation is gone from their list');
        // Declining is always allowed.
        await db.query("UPDATE list_members SET role = 'manager' WHERE list_id = ? AND discord_id = ?", [list.id, M]);
        const again = await S.invite(M, list.id, { discordId: Y });
        await db.query("UPDATE list_members SET role = 'viewer' WHERE list_id = ? AND discord_id = ?", [list.id, M]);
        assert.equal((await S.respond(Y, again.id, false)).accepted, false);

        // Parties: an invitation needs its inviter still in the party; leaving or being removed withdraws theirs.
        const PA = db.parties;
        await PA.create(O, 'Outlive party');
        const pi = await PA.invite(O, { discordId: X });
        await db.query('UPDATE party_invites SET invited_by = ? WHERE id = ?', [Z, pi.id]); // the inviter is not in the party
        await assert.rejects(PA.respond(X, pi.id, true), { code: 'CONFLICT', message: /no longer open/ });
        assert.equal(await PA.status(X), null);
        assert.equal((await PA.listInvites(X)).length, 0);
        // A member who was somehow allowed to invite loses their open invitations when removed.
        const joined = await PA.respond(Y, (await PA.invite(O, { discordId: Y })).id, true);
        assert.equal(joined.accepted, true);
        const pw = await PA.invite(O, { discordId: Z });
        await db.query('UPDATE party_invites SET invited_by = ? WHERE id = ?', [Y, pw.id]);
        await PA.leave(Y);
        assert.equal((await PA.listInvites(Z)).length, 0);
        await PA.disband(O);
    });

    await t.test('reminder re-arm limits: only a changed date re-arms everyone, at most three times a day', async () => {
        const S = db.sharing;
        const { LIMITS } = require('../src');
        assert.equal(LIMITS.REMINDER_REARMS_PER_DAY, 3);
        const mk = async (n) => {
            const id = `2000000000000014${String(n).padStart(2, '0')}`;
            await db.users.ensureUser(id, { username: `rearm_${n}`, handle: `rearm_${n}`, avatar: null });
            return id;
        };
        const [O, E] = [await mk(1), await mk(2)];
        const { list } = await db.tasks.createList(O, { name: 'Rearm', deadline: '2031-05-01' });
        await S.respond(E, (await S.invite(O, list.id, { discordId: E, role: 'editor' })).id, true);
        const { item } = await db.tasks.addItem(O, list.id, { name: 'Dated', due_date: '2031-05-01' });
        const itemRows = async () => Number((await db.query('SELECT COUNT(*) AS n FROM item_reminders WHERE item_id = ?', [item.id]))[0].n);
        const listRows = async () => Number((await db.query('SELECT COUNT(*) AS n FROM list_reminders WHERE list_id = ?', [list.id]))[0].n);
        const arm = async () => {
            await db.tasks.snoozeTask(E, item.id, new Date(Date.now() + 3600e3));
            await db.tasks.snoozeList(E, list.id, new Date(Date.now() + 3600e3));
            await db.tasks.markTaskReminderSent(item.id, new Date()); // the owner's own state
            await db.tasks.markReminderSent(list.id, 'due');
        };
        const ownerFlags = async () => ({
            item: (await db.query('SELECT reminded_at FROM items WHERE id = ?', [item.id]))[0].reminded_at !== null,
            list: Number((await db.query('SELECT deadline_notified FROM lists WHERE id = ?', [list.id]))[0].deadline_notified) === 1
        });

        // Saving the same date (by anyone) clears nobody's reminder state.
        await arm();
        await db.tasks.updateItem(E, item.id, { due_date: '2031-05-01', name: 'Dated again' });
        await db.tasks.updateList(O, list.id, { deadline: '2031-05-01', name: 'Rearm 2' });
        assert.deepEqual([await itemRows(), await listRows(), await ownerFlags()], [1, 1, { item: true, list: true }], 'an unchanged date re-arms nothing');

        // A changed date re-arms the owner's and everyone else's state, three times a day.
        const days = ['2031-05-02', '2031-05-03', '2031-05-04'];
        for (const d of days) {
            await arm();
            await db.tasks.updateItem(E, item.id, { due_date: d });
            await db.tasks.updateList(O, list.id, { deadline: d });
            assert.deepEqual([await itemRows(), await listRows(), await ownerFlags()], [0, 0, { item: false, list: false }], `${d}: re-armed`);
        }
        // The fourth change today still moves the date but leaves everybody's state alone.
        await arm();
        await db.tasks.updateItem(E, item.id, { due_date: '2031-05-05' });
        await db.tasks.updateList(O, list.id, { deadline: '2031-05-05' });
        assert.deepEqual([await itemRows(), await listRows(), await ownerFlags()], [1, 1, { item: true, list: true }], 'over the daily limit: not re-armed');
        assert.equal((await db.tasks.getItem(O, item.id)).due_date, '2031-05-05', 'but the date itself changed');
        assert.equal((await db.tasks.getList(O, list.id)).deadline, '2031-05-05');
        assert.equal((await db.query('SELECT rearm_count FROM items WHERE id = ?', [item.id]))[0].rearm_count, 3);

        // The next day the allowance is back.
        await db.query("UPDATE items SET rearm_day = CURRENT_DATE - make_interval(days => 1) WHERE id = ?", [item.id]);
        await db.query("UPDATE lists SET rearm_day = CURRENT_DATE - make_interval(days => 1) WHERE id = ?", [list.id]);
        await db.tasks.updateItem(E, item.id, { due_date: '2031-05-06' });
        await db.tasks.updateList(O, list.id, { deadline: '2031-05-06' });
        assert.deepEqual([await itemRows(), await listRows(), await ownerFlags()], [0, 0, { item: false, list: false }], 'a new day: re-armed again');
        assert.equal((await db.query('SELECT rearm_count FROM items WHERE id = ?', [item.id]))[0].rearm_count, 1);
    });

    await t.test('progress erasure: editors cannot delete tasks others added, and a reset really zeroes quest, review and party progress', async () => {
        const S = db.sharing;
        const mk = async (n) => {
            const id = `2000000000000016${String(n).padStart(2, '0')}`;
            await db.users.ensureUser(id, { username: `erase_${n}`, handle: `erase_${n}`, avatar: null });
            return id;
        };
        const [O, E, M] = [await mk(1), await mk(2), await mk(3)];
        const { list } = await db.tasks.createList(O, { name: 'Erase' });
        await S.respond(E, (await S.invite(O, list.id, { discordId: E, role: 'editor' })).id, true);
        await S.respond(M, (await S.invite(O, list.id, { discordId: M, role: 'manager' })).id, true);

        // An editor deletes only what they added; managers and the owner delete anything.
        const mine = (await db.tasks.addItem(E, list.id, { name: 'editor task' })).item;
        const owners = (await db.tasks.addItem(O, list.id, { name: 'owner task' })).item;
        const owners2 = (await db.tasks.addItem(O, list.id, { name: 'owner task 2' })).item;
        await db.tasks.setItemCompleted(M, owners.id, true); // somebody else finished it: their progress is in it
        await assert.rejects(db.tasks.deleteItem(E, owners.id), { code: 'FORBIDDEN', message: /Editors can only delete tasks they added/ });
        assert.ok(await db.tasks.getItem(O, owners.id), 'still there');
        const flags = Object.fromEntries((await db.tasks.getItems(E, list.id)).map((i) => [i.name, i.can_delete]));
        assert.deepEqual(flags, { 'editor task': true, 'owner task': false, 'owner task 2': false }, 'the UI is told which deletes to offer');
        assert.equal((await db.tasks.getItems(O, list.id)).every((i) => i.can_delete), true);
        assert.equal((await db.tasks.getItem(E, owners2.id)).can_delete, false);
        // The editor's own task goes, but not with subtasks somebody else added under it.
        const parent = (await db.tasks.addItem(E, list.id, { name: 'editor parent' })).item;
        const child = (await db.tasks.addItem(M, list.id, { name: 'manager subtask', parent_id: parent.id })).item;
        await assert.rejects(db.tasks.deleteItem(E, parent.id), { code: 'FORBIDDEN', message: /subtasks added by other people/ });
        assert.equal(await db.tasks.deleteItem(E, mine.id), true);
        assert.equal(await db.tasks.deleteItem(M, parent.id), true, 'a manager may delete it with its subtasks');
        assert.equal(await db.tasks.getItem(O, child.id), null);
        assert.equal(await db.tasks.deleteItem(M, owners2.id), true, 'a manager deletes the owner\'s task');
        assert.equal(await db.tasks.deleteItem(O, owners.id), true);
        await assert.rejects(db.tasks.deleteItem(E, owners.id), { code: 'NOT_FOUND' });

        // A reset zeroes quest, review and party progress even for tasks finished on somebody else's list (which a reset cannot delete).
        const R = await mk(4);
        await db.sharing.respond(R, (await S.invite(O, list.id, { discordId: R, role: 'editor' })).id, true);
        await db.parties.create(R, 'Reset party');
        await new Promise((r) => setTimeout(r, 1100));
        for (let n = 0; n < 4; n++) await db.tasks.setItemCompleted(R, (await db.tasks.addItem(O, list.id, { name: `r${n}` })).item.id, true);
        const questSum = async () => (await db.quests.getQuests(R)).reduce((n, q) => n + q.progress, 0);
        assert.ok((await questSum()) > 0);
        assert.equal((await db.review.getReview(R)).completed, 4);
        assert.equal((await db.parties.status(R)).members[0].count, 4);
        await new Promise((r) => setTimeout(r, 1100)); // timestamps are whole seconds
        await db.users.resetProgress(R);
        assert.ok((await db.users.getUser(R)).progress_reset_at, 'the reset is recorded');
        assert.equal(await questSum(), 0, 'quests start from zero');
        assert.equal((await db.review.getReview(R)).completed, 0, 'and so does the weekly review');
        await db.parties.create(R, 'Fresh party');
        assert.equal((await db.parties.status(R)).members[0].count, 0, 'and the party quest');
        await assert.rejects(db.review.claimReview(R), { code: 'VALIDATION' }, 'no re-claim on old work');
        // New work after the reset counts again.
        await new Promise((r) => setTimeout(r, 1100));
        const own = (await db.tasks.createList(R, { name: 'After reset' })).list;
        await db.tasks.setItemCompleted(R, (await db.tasks.addItem(R, own.id, { name: 'after reset' })).item.id, true);
        assert.equal((await db.review.getReview(R)).completed, 1);
    });

    await t.test('column whitelist: members get the fields the UI draws, the owner keeps the whole row', async () => {
        const mk = async (n) => {
            const id = `2000000000000017${String(n).padStart(2, '0')}`;
            await db.users.ensureUser(id, { username: `cols_${n}`, handle: `cols_${n}`, avatar: null });
            return id;
        };
        const [O, E] = [await mk(1), await mk(2)];
        const { list } = await db.tasks.createList(O, { name: 'Columns', deadline: '2031-09-01' });
        await db.sharing.respond(E, (await db.sharing.invite(O, list.id, { discordId: E, role: 'editor' })).id, true);
        const { item } = await db.tasks.addItem(O, list.id, { name: 'Private state', due_date: '2031-09-01', recurrence: 'weekly', tags: 'a,b', priority: 'HIGH' });
        await db.tasks.snoozeTask(O, item.id, new Date(Date.now() + 3600e3));
        await db.tasks.snoozeList(O, list.id, new Date(Date.now() + 3600e3));
        await db.tasks.setItemCompleted(O, item.id, true); // xp_awarded, first_completed_*, the repeat copy

        const MEMBER_ITEM = ['id', 'list_id', 'name', 'description', 'completed', 'completed_at', 'position', 'priority', 'due_date', 'tags', 'parent_id', 'recurrence', 'estimate_minutes', 'created_at', 'updated_at', 'completed_by_name', 'can_delete', 'list_name', 'list_priority'];
        const PRIVATE_ITEM = ['remind_at', 'reminded_at', 'xp_awarded', 'counts_for_quests', 'first_completed_at', 'first_completed_by', 'first_completed_high', 'first_completed_early', 'first_completed_overdue', 'due_date_set_at', 'repeat_anchor_day', 'habit_streak', 'rearm_count', 'rearm_day', 'created_by', 'completed_by'];
        const PRIVATE_LIST = ['remind_at', 'deadline_notified', 'overdue_notified', 'cleared_at', 'cleared_by', 'rearm_count', 'rearm_day', 'discord_id'];

        // The owner's rows are unchanged: everything the owner needs, including their own reminder state.
        const ownerItems = await db.tasks.getItems(O, list.id);
        for (const f of ['remind_at', 'reminded_at', 'xp_awarded', 'counts_for_quests', 'first_completed_at', 'habit_streak', 'due_date_set_at']) assert.ok(f in ownerItems[0], `owner row has ${f}`);
        for (const f of ['created_by', 'completed_by', 'first_completed_by']) assert.equal(f in ownerItems[0], false, 'other people\'s IDs never leave');
        const ownerList = await db.tasks.getList(O, list.id);
        for (const f of ['remind_at', 'deadline_notified', 'overdue_notified', 'cleared_at', 'discord_id']) assert.ok(f in ownerList, `owner list has ${f}`);

        // A member gets only the drawn fields, from every read and every write that returns a row.
        const checkItem = (row, what) => {
            for (const k of Object.keys(row)) assert.ok(MEMBER_ITEM.includes(k), `${what}: unexpected field ${k}`);
            for (const k of PRIVATE_ITEM) assert.equal(k in row, false, `${what}: ${k} must not be sent`);
        };
        const memberItems = await db.tasks.getItems(E, list.id);
        assert.equal(memberItems.length, ownerItems.length);
        memberItems.forEach((row, n) => checkItem(row, `getItems[${n}]`));
        assert.deepEqual(memberItems.map((i) => [i.id, i.name, i.completed, i.due_date, i.recurrence, i.priority]), ownerItems.map((i) => [i.id, i.name, i.completed, i.due_date, i.recurrence, i.priority]), 'the visible values are the same');
        checkItem(await db.tasks.getItem(E, item.id), 'getItem');
        const added = await db.tasks.addItem(E, list.id, { name: 'member task' });
        checkItem(added.item, 'addItem');
        checkItem((await db.tasks.setItemCompleted(E, added.item.id, true)).item, 'setItemCompleted');
        checkItem(await db.tasks.updateItem(E, added.item.id, { name: 'member task 2' }), 'updateItem');
        const subs = await db.tasks.addSubtasks(E, added.item.id, ['s1']);
        checkItem(subs.parent, 'addSubtasks parent');
        const repeating = (await db.tasks.addItem(E, list.id, { name: 'weekly', recurrence: 'weekly', due_date: '2031-09-02' })).item;
        const done = await db.tasks.setItemCompleted(E, repeating.id, true);
        assert.ok(done.nextItem, 'a repeat copy was made');
        checkItem(done.nextItem, 'the repeat copy');

        const checkList = (row, what, drawn = ['id', 'name', 'deadline', 'role', 'is_owner', 'owner_name', 'member_count', 'shared']) => {
            for (const k of PRIVATE_LIST) assert.equal(k in row, false, `${what}: ${k} must not be sent`);
            for (const k of drawn) assert.ok(k in row, `${what}: ${k} is drawn`);
        };
        checkList(await db.tasks.getList(E, list.id), 'getList');
        checkList((await db.tasks.getLists(E)).find((l) => l.id === list.id), 'getLists');
        checkList((await db.tasks.searchLists(E, 'Columns'))[0], 'searchLists', ['id', 'name', 'deadline']);
        assert.equal((await db.tasks.getLists(E)).find((l) => l.id === list.id).items_total >= 1, true);
    });


    // ─── Parties ──────────────────────────────────────────────────────────────────

    await t.test('parties: one per user, named invitations, weekly quest progress and a once-a-week claim', async () => {
        const PA = db.parties;
        const { PARTY_QUEST, LIMITS } = require('../src');
        const u = {};
        for (const [k, n] of Object.entries({ own: 1, two: 2, three: 3, four: 4 })) {
            u[k] = `2000000000000008${String(n).padStart(2, '0')}`;
            await db.users.ensureUser(u[k], { username: `pty_${k}`, handle: `pty_${k}`, avatar: null });
        }
        assert.equal(await PA.status(u.own), null);
        await assert.rejects(PA.create(u.own, '   '), { code: 'VALIDATION' });
        await assert.rejects(PA.create(u.own, 'x'.repeat(41)), { code: 'VALIDATION' });
        const party = await PA.create(u.own, 'Night Owls');
        await assert.rejects(PA.create(u.own, 'Second'), { code: 'CONFLICT', message: /already in a party/ });
        await assert.rejects(PA.invite(u.two, { username: 'pty_three' }), { code: 'NOT_FOUND' }, 'not in a party');
        await assert.rejects(PA.invite(u.own, { username: 'pty_own' }), { code: 'VALIDATION' });
        assert.deepEqual(await PA.invite(u.own, { username: 'nobody_x' }), { sent: false });
        const i2 = await PA.invite(u.own, { username: 'pty_two' });
        await assert.rejects(PA.invite(u.own, { discordId: u.two }), { code: 'CONFLICT' });
        assert.deepEqual((await PA.listInvites(u.two)).map((i) => [i.id, i.partyName, i.ownerName]), [[i2.id, 'Night Owls', 'pty_own']]);
        await assert.rejects(PA.respond(u.three, i2.id, true), { code: 'NOT_FOUND' }, 'only the invitee answers');
        assert.deepEqual(await PA.respond(u.two, i2.id, true), { accepted: true, party: { id: party.id, name: 'Night Owls' } });
        assert.deepEqual(await PA.invite(u.own, { discordId: u.two }), { sent: false }, 'someone already in a party: the same neutral answer');
        await assert.rejects(PA.invite(u.two, { discordId: u.three }), { code: 'FORBIDDEN' }, 'only the owner invites');
        assert.equal((await db.query('SELECT COUNT(*) AS n FROM party_members WHERE discord_id = ?', [u.two]))[0].n, 1);

        // The status shows names and counts only.
        const day = new Date();
        let st = await PA.status(u.two, day);
        assert.deepEqual(st.members.map((m) => [m.name, m.count, m.isYou, m.isOwner]), [['pty_own', 0, false, true], ['pty_two', 0, true, false]]);
        assert.equal(st.target, PARTY_QUEST.PER_MEMBER_TARGET, 'nobody has finished a task yet: the target is one member\'s worth, idle seats do not raise it');
        assert.equal(st.reward, PARTY_QUEST.REWARD);
        assert.equal(st.party.isOwner, false);
        assert.deepEqual(st.invites, [], 'only the owner sees pending invitations');
        assert.equal(JSON.stringify(st).match(/\d{15,}/), null, 'no Discord ID in the party status');
        assert.deepEqual(Object.keys(st.members[0]).sort(), ['count', 'isOwner', 'isYou', 'memberKey', 'name'], 'nothing but a name, a count and an opaque key per member');
        await assert.rejects(PA.claim(u.two, day), { code: 'VALIDATION', message: /isn't finished/ });

        // Progress is the sum of first completions (counted for quests) by the members, in the UTC week.
        const finish = async (id, n) => {
            const { list } = await db.tasks.createList(id, { name: `Quest list ${n}` });
            for (let k = 0; k < n; k++) {
                const { item } = await db.tasks.addItem(id, list.id, { name: `t${k}` });
                await db.tasks.setItemCompleted(id, item.id);
            }
            return list;
        };
        const ownList = await finish(u.own, 12);
        await finish(u.two, 11);
        st = await PA.status(u.own, day);
        assert.equal(st.progress, 23);
        assert.equal(st.reached, false);
        // Re-checking a finished task adds nothing; a task completed by someone else on a shared list counts for them.
        const [first] = await db.tasks.getItems(u.own, ownList.id);
        await db.tasks.setItemCompleted(u.own, first.id, false);
        await db.tasks.setItemCompleted(u.own, first.id, true);
        assert.equal((await PA.status(u.own, day)).progress, 23);
        await db.sharing.respond(u.two, (await db.sharing.invite(u.own, ownList.id, { discordId: u.two, role: 'editor' })).id, true);
        const { item: extra } = await db.tasks.addItem(u.own, ownList.id, { name: 'for the partner' });
        await db.tasks.setItemCompleted(u.two, extra.id);
        st = await PA.status(u.own, day);
        assert.deepEqual(st.members.map((m) => m.count), [12, 12], 'it counts for the one who finished it');
        assert.equal(st.reached, true);
        assert.equal(st.claimable, true);

        // Claiming: flat XP once per person per week; non-members and XP-off users cannot.
        await assert.rejects(PA.claim(u.three, day), { code: 'NOT_FOUND' });
        const before = Number((await db.users.getUser(u.own)).player_xp);
        const paid = await PA.claim(u.own, day);
        assert.equal(paid.xp, PARTY_QUEST.REWARD);
        assert.ok(Number((await db.users.getUser(u.own)).player_xp) - before >= PARTY_QUEST.REWARD);
        assert.equal((await db.query("SELECT COUNT(*) AS n FROM xp_transactions WHERE discord_id = ? AND source = 'party_quest'", [u.own]))[0].n, 1);
        await assert.rejects(PA.claim(u.own, day), { code: 'CONFLICT' });
        assert.equal((await PA.status(u.own, day)).claimed, true);
        assert.equal((await PA.status(u.two, day)).claimable, true, 'each member claims for themselves');
        await db.users.updateSettings(u.two, { gamification_enabled: false });
        assert.equal((await PA.status(u.two, day)).claimable, false);
        await assert.rejects(PA.claim(u.two, day), { code: 'GAMIFICATION_DISABLED' });
        await db.users.updateSettings(u.two, { gamification_enabled: true });
        assert.equal((await PA.claim(u.two, day)).xp, PARTY_QUEST.REWARD);
        // The next week starts from zero and the reward can be claimed again.
        const nextWeek = new Date(day.getTime() + 7 * 86400e3);
        assert.deepEqual((await PA.status(u.own, nextWeek)).members.map((m) => m.count), [0, 0]);

        // Changing parties does not pay a second reward in the same week.
        await PA.leave(u.two);
        await assert.rejects(PA.leave(u.two), { code: 'NOT_FOUND' });
        await new Promise((r) => setTimeout(r, 1100)); // timestamps are whole seconds: make sure his work predates the new party
        await PA.create(u.two, 'Solo run');
        const mine = await PA.status(u.two, day);
        assert.equal(mine.members.length, 1);
        assert.equal(mine.reached, false, 'his 12 completions were made before he joined this party, so they do not count for it');
        assert.equal(mine.claimed, true, 'and he already claimed a party reward this week');
        await assert.rejects(PA.claim(u.two, day), { code: 'VALIDATION', message: /isn't finished/ });
        await PA.disband(u.two);
        assert.equal(await PA.status(u.two, day), null);
        await assert.rejects(PA.disband(u.two), { code: 'NOT_FOUND' });

        // Owner rules and the size cap (6 including the owner, counting pending invitations).
        await assert.rejects(PA.leave(u.own), { code: 'FORBIDDEN', message: /Disband/ });
        const more = [];
        for (let n = 10; n < 10 + LIMITS.MAX_PARTY_MEMBERS - 1; n++) {
            const id = `2000000000000008${n}`;
            await db.users.ensureUser(id, { username: `pty_fill${n}`, handle: `pty_fill${n}`, avatar: null });
            more.push(id);
        }
        const invites = [];
        for (const id of more.slice(0, LIMITS.MAX_PARTY_MEMBERS - 2)) invites.push(await PA.invite(u.own, { discordId: id }));
        for (const inv of invites) await PA.respond(more[invites.indexOf(inv)], inv.id, true);
        assert.equal((await PA.status(u.own)).members.length, LIMITS.MAX_PARTY_MEMBERS - 1);
        await PA.invite(u.own, { discordId: more.at(-1) }); // the sixth seat is held by a pending invitation
        await assert.rejects(PA.invite(u.own, { discordId: u.three }), { code: 'VALIDATION', message: /at most 6/ });
        const pending = (await PA.status(u.own)).invites;
        assert.equal(pending.length, 1);
        await PA.revoke(u.own, pending[0].id);
        await assert.rejects(PA.revoke(u.own, pending[0].id), { code: 'NOT_FOUND' });
        await assert.rejects(PA.respond(more.at(-1), pending[0].id, true), { code: 'CONFLICT' });
        // Declined and expired invitations behave like list invitations.
        const again = await PA.invite(u.own, { discordId: more.at(-1) });
        await db.query('UPDATE party_invites SET expires_at = CURRENT_TIMESTAMP - make_interval(hours => 1) WHERE id = ?', [again.id]);
        assert.deepEqual(await PA.listInvites(more.at(-1)), []);
        await assert.rejects(PA.respond(more.at(-1), again.id, true), { code: 'CONFLICT', message: /expired/ });
        const declined = await PA.invite(u.own, { discordId: more.at(-1) });
        assert.equal((await PA.respond(more.at(-1), declined.id, false)).accepted, false);
        // Disbanding removes everyone; a member who was in it is free to join elsewhere.
        await PA.disband(u.own);
        assert.equal(await PA.status(more[0]), null);
        assert.equal((await db.query('SELECT COUNT(*) AS n FROM party_members WHERE party_id = ?', [party.id]))[0].n, 0);
    });

    await t.test('the decline cooldown counts from the moment of the decline, not from when the invitation was sent', async () => {
        const S = db.sharing;
        const [O, B] = ['300000000000000101', '300000000000000102'];
        await db.users.ensureUser(O, { username: 'cd_owner', handle: 'cd_owner', avatar: null });
        await db.users.ensureUser(B, { username: 'cd_bravo', handle: 'cd_bravo', avatar: null });
        const { list } = await db.tasks.createList(O, { name: 'Cooldown list' });
        const invite = await S.invite(O, list.id, { discordId: B });
        // The invitation is 8 days old but still open (a long-lived one), and is declined just now.
        await db.query('UPDATE list_invites SET created_at = CURRENT_TIMESTAMP - make_interval(days => 8), expires_at = CURRENT_TIMESTAMP + make_interval(days => 1) WHERE id = ?', [invite.id]);
        assert.equal((await S.respond(B, invite.id, false)).accepted, false);
        assert.deepEqual(await S.invite(O, list.id, { discordId: B }), { sent: false }, 'still inside the cooldown');
    });

    await t.test('accepting a party invitation does not put other inviters on a decline cooldown', async () => {
        const PA = db.parties;
        const [O1, O2, X] = ['300000000000000111', '300000000000000112', '300000000000000113'];
        for (const [id, n] of [[O1, 'pc_one'], [O2, 'pc_two'], [X, 'pc_x']]) await db.users.ensureUser(id, { username: n, handle: n, avatar: null });
        await PA.create(O1, 'Party One');
        await PA.create(O2, 'Party Two');
        const first = await PA.invite(O1, { discordId: X });
        const second = await PA.invite(O2, { discordId: X });
        assert.equal((await PA.respond(X, first.id, true)).accepted, true);
        const row = (await db.query('SELECT status FROM party_invites WHERE id = ?', [second.id]))[0];
        assert.equal(row.status, 'revoked', 'the other invitation is withdrawn, not declined');
        await PA.leave(X);
        assert.equal((await PA.invite(O2, { discordId: X })).sent, true, 'party two can invite them again');
    });

    await t.test('party reward: idle seats and spare accounts earn nothing, only work since joining counts, and the owner can remove a member', async () => {
        const PA = db.parties;
        const { PARTY_QUEST } = require('../src');
        const ids = {};
        for (const [k, n] of Object.entries({ own: 1, a: 2, b: 3, c: 4 })) {
            ids[k] = `2000000000000011${String(n).padStart(2, '0')}`;
            await db.users.ensureUser(ids[k], { username: `prw_${k}`, handle: `prw_${k}`, avatar: null });
        }
        const finish = async (id, n, list) => {
            const target = list || (await db.tasks.createList(id, { name: `Reward list ${id.slice(-2)} ${Math.random().toString(36).slice(2, 6)}` })).list;
            for (let k = 0; k < n; k++) {
                const { item } = await db.tasks.addItem(id, target.id, { name: `t${k}` });
                await db.tasks.setItemCompleted(id, item.id);
            }
            return target;
        };
        const join = async (who) => PA.respond(ids[who], (await PA.invite(ids.own, { discordId: ids[who] })).id, true);

        // Work done BEFORE joining does not count for the party.
        await finish(ids.a, 4);
        await new Promise((r) => setTimeout(r, 1100)); // timestamps are whole seconds: make sure his work predates the party
        await PA.create(ids.own, 'Reward crew');
        await new Promise((r) => setTimeout(r, 1100));
        await join('a');
        await join('b');
        await join('c');
        let st = await PA.status(ids.own);
        assert.deepEqual(st.members.map((m) => m.count), [0, 0, 0, 0], 'a\'s 4 earlier completions are from before he joined');
        assert.equal(st.target, PARTY_QUEST.PER_MEMBER_TARGET, 'no active member yet: one member\'s worth');

        // The owner alone does the whole target: idle seats do not raise it, but only the person who did the work may claim.
        await finish(ids.own, PARTY_QUEST.PER_MEMBER_TARGET);
        st = await PA.status(ids.own);
        assert.equal(st.target, PARTY_QUEST.PER_MEMBER_TARGET);
        assert.equal(st.reached, true);
        assert.equal(st.claimable, true);
        assert.equal(st.yourCount, PARTY_QUEST.PER_MEMBER_TARGET);
        for (const idle of ['a', 'b', 'c']) {
            const mine = await PA.status(ids[idle]);
            assert.equal(mine.claimable, false, 'a seat that did nothing is not paid for the owner\'s work');
            await assert.rejects(PA.claim(ids[idle]), { code: 'VALIDATION', message: /Finish at least 6 tasks yourself/ });
        }

        // A spare account that finishes one task does not move the target or the progress (it has not done enough to claim), so it
        // cannot block the owner. Nothing was claimed or paid.
        await finish(ids.b, 1);
        st = await PA.status(ids.own);
        assert.equal(st.target, PARTY_QUEST.PER_MEMBER_TARGET);
        assert.equal(st.progress, PARTY_QUEST.PER_MEMBER_TARGET);
        assert.equal(st.reached, true);
        assert.equal((await db.query("SELECT COUNT(*) AS n FROM xp_transactions WHERE source = 'party_quest' AND discord_id IN (?, ?, ?, ?)", [ids.own, ids.a, ids.b, ids.c]))[0].n, 0);

        // One member cannot carry the party: their share is capped at the per-member target.
        await finish(ids.own, 20);
        st = await PA.status(ids.own);
        assert.equal(st.progress, PARTY_QUEST.PER_MEMBER_TARGET, 'extra tasks beyond the share add nothing');

        // A real team effort: b finishes the minimum share, a the rest; everybody who did half or more claims, the idle seat cannot.
        await finish(ids.b, PARTY_QUEST.MIN_OWN_TO_CLAIM - 1); // now 6 in total
        await finish(ids.a, PARTY_QUEST.PER_MEMBER_TARGET - 4); // 8: target is 36 now (three active members)
        st = await PA.status(ids.own);
        assert.equal(st.target, PARTY_QUEST.PER_MEMBER_TARGET * 3);
        assert.equal(st.progress, PARTY_QUEST.PER_MEMBER_TARGET + PARTY_QUEST.MIN_OWN_TO_CLAIM + 8);
        assert.equal(st.reached, false);
        await finish(ids.b, PARTY_QUEST.PER_MEMBER_TARGET - PARTY_QUEST.MIN_OWN_TO_CLAIM); // b: 12
        await finish(ids.a, 4); // a: 12
        st = await PA.status(ids.own);
        assert.equal(st.reached, true);
        assert.equal((await PA.claim(ids.own)).xp, PARTY_QUEST.REWARD);
        assert.equal((await PA.claim(ids.a)).xp, PARTY_QUEST.REWARD);
        await assert.rejects(PA.claim(ids.c), { code: 'VALIDATION', message: /Finish at least 6 tasks yourself/ }, 'the idle seat still gets nothing');

        // Removing a member: the owner only, never themselves, by the opaque key; the member loses the seat and the claim.
        const keyOf = async (who) => (await PA.status(ids.own)).members.find((m) => m.name === `prw_${who}`).memberKey;
        const keyC = await keyOf('c');
        assert.match(keyC, /^[a-f0-9]{12}$/);
        await assert.rejects(PA.kick(ids.a, { memberKey: keyC }), { code: 'FORBIDDEN' }, 'only the owner removes people');
        await assert.rejects(PA.kick(ids.own, { memberKey: await keyOf('own') }), { code: 'VALIDATION', message: /Disband/ }, 'not yourself');
        await assert.rejects(PA.kick(ids.own, { memberKey: 'ffffffffffff' }), { code: 'NOT_FOUND' });
        await assert.rejects(PA.kick(ids.own, { memberKey: 'nope' }), { code: 'NOT_FOUND' });
        await assert.rejects(PA.kick(ids.c, { memberKey: keyC }), { code: 'FORBIDDEN' }, 'not even themselves: they leave instead');
        assert.equal(await PA.kick(ids.own, { memberKey: keyC }), true);
        assert.equal(await PA.status(ids.c), null);
        await assert.rejects(PA.kick(ids.own, { memberKey: keyC }), { code: 'NOT_FOUND' }, 'already gone');
        assert.equal((await PA.status(ids.own)).members.length, 3);
        await assert.rejects(PA.kick(ids.own, { discordId: ids.c }), { code: 'NOT_FOUND' }, 'the bot path by Discord ID reaches only members of my own party');
        assert.equal(await PA.kick(ids.own, { discordId: ids.b }), true);
        assert.equal((await PA.status(ids.own)).members.length, 2);
        // The owner of another party cannot reach into this one.
        await PA.create(ids.c, 'Other crew');
        await assert.rejects(PA.kick(ids.c, { memberKey: await keyOf('a') }), { code: 'NOT_FOUND' });
        await PA.disband(ids.c);
        await PA.disband(ids.own);
    });


    await t.test('sharing: races between answering, inviting, removing and working never corrupt anything', async () => {
        const R = { own: '200000000000000901', a: '200000000000000902', b: '200000000000000903' };
        for (const [k, id] of Object.entries(R)) await db.users.ensureUser(id, { username: `race_${k}`, handle: `race_${k}`, avatar: null });
        const { list } = await db.tasks.createList(R.own, { name: 'Race' });
        // Two invitations of the same person at once: exactly one is created.
        const both = await Promise.allSettled([db.sharing.invite(R.own, list.id, { discordId: R.a, role: 'editor' }), db.sharing.invite(R.own, list.id, { discordId: R.a, role: 'editor' })]);
        assert.deepEqual(both.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
        assert.equal(both.find((r) => r.status === 'rejected').reason.code, 'CONFLICT');
        const invite = (await db.sharing.listInvites(R.a))[0];
        // Accepting twice at once: one joins, the other is refused, one member row.
        const twice = await Promise.allSettled([db.sharing.respond(R.a, invite.id, true), db.sharing.respond(R.a, invite.id, true)]);
        assert.deepEqual(twice.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
        assert.equal((await db.query('SELECT COUNT(*) AS n FROM list_members WHERE list_id = ?', [list.id]))[0].n, 1);
        // Working while being removed: every call either succeeds before the removal or is NOT_FOUND after it.
        const key = (await db.sharing.listMembers(R.own, list.id)).members.find((m) => m.name === 'race_a').memberKey;
        const items = [];
        for (let n = 0; n < 6; n++) items.push((await db.tasks.addItem(R.own, list.id, { name: `r${n}` })).item.id);
        const results = await Promise.allSettled([
            ...items.map((id) => db.tasks.setItemCompleted(R.a, id)),
            db.sharing.removeMember(R.own, list.id, key),
            db.tasks.addItem(R.a, list.id, { name: 'late' })
        ]);
        for (const r of results) if (r.status === 'rejected') assert.equal(r.reason.code, 'NOT_FOUND', `only NOT_FOUND may fail: ${r.reason && r.reason.message}`);
        assert.equal(await db.tasks.getList(R.a, list.id), null, 'the member is gone');
        // The invitee who accepted a list that was deleted a moment later gets a clean answer.
        const gone = await db.tasks.createList(R.own, { name: 'Doomed' });
        const inv = await db.sharing.invite(R.own, gone.list.id, { discordId: R.b });
        const settled = await Promise.allSettled([db.sharing.respond(R.b, inv.id, true), db.tasks.deleteList(R.own, gone.list.id)]);
        for (const r of settled) if (r.status === 'rejected') assert.ok(['NOT_FOUND', 'CONFLICT'].includes(r.reason.code), r.reason && r.reason.message);
        assert.equal((await db.query('SELECT COUNT(*) AS n FROM list_members WHERE list_id = ?', [gone.list.id]))[0].n, 0);
    });

    await t.test('backdated and far-future due dates earn no overdue or early extras until they are 24 hours old', async () => {
        const N = '100000000000000701';
        const G = '100000000000000702';
        const E = '100000000000000603';
        for (const id of [N, G, E]) await db.users.ensureUser(id);
        for (const [id, cls] of [[N, 'necromancer'], [G, 'RANGER']]) {
            await setXP(id, 650);
            await db.progression.buyClass(id, cls);
        }
        const dayOff = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
        const setAt = async (id) => (await db.query('SELECT due_date_set_at FROM items WHERE id = ?', [id]))[0].due_date_set_at;

        // Necromancer: a task created already overdue is not a revive; the same task with an aged date is.
        const crypt = (await db.tasks.createList(N, { name: 'Crypt2' })).list;
        const fresh = (await db.tasks.addItem(N, crypt.id, { name: 'made up', due_date: '2000-01-01' })).item;
        assert.ok(await setAt(fresh.id), 'a due date records when it was set');
        const a = await db.tasks.setItemCompleted(N, fresh.id);
        assert.equal(a.xp.bonusInfo.type, 'NECROMANCER', 'no revive for a date typed in just now');
        assert.ok(!bonusKeys(a).includes('overdue_clear'));
        assert.equal(Number((await db.users.getUser(N)).necro_souls), 0);
        assert.equal((await db.query('SELECT first_completed_overdue AS o FROM items WHERE id = ?', [fresh.id]))[0].o, null, 'and it is not an overdue fact for quests');
        const aged = await ageDue((await db.tasks.addItem(N, crypt.id, { name: 'really stale', due_date: dayOff(-3) })).item.id);
        const b = await db.tasks.setItemCompleted(N, aged);
        assert.equal(b.xp.bonusInfo.type, 'NECROMANCER_REVIVE');
        assert.ok(bonusKeys(b).includes('overdue_clear'));

        // Ranger: a far-future date paid +45 before; fresh pays the plain flat, aged pays the early bonus.
        const trail = (await db.tasks.createList(G, { name: 'Trail2' })).list;
        const far = await db.tasks.setItemCompleted(G, (await db.tasks.addItem(G, trail.id, { name: 'far', due_date: '2100-01-01' })).item.id);
        assert.equal(far.xp.bonusInfo.type, 'RANGER');
        const farAged = await db.tasks.setItemCompleted(G, await ageDue((await db.tasks.addItem(G, trail.id, { name: 'far aged', due_date: dayOff(3) })).item.id));
        assert.equal(farAged.xp.bonusInfo.type, 'RANGER_EARLY');

        // early_finish and the early quest fact need an aged date too.
        const l2 = (await db.tasks.createList(E, { name: 'Early2' })).list;
        const e1 = await db.tasks.setItemCompleted(E, (await db.tasks.addItem(E, l2.id, { name: 'e1', due_date: dayOff(20) })).item.id);
        assert.ok(!bonusKeys(e1).includes('early_finish'));
        assert.equal((await db.query('SELECT first_completed_early AS o FROM items WHERE id = ?', [e1.item.id]))[0].o, null);
        const e2 = await db.tasks.setItemCompleted(E, await ageDue((await db.tasks.addItem(E, l2.id, { name: 'e2', due_date: dayOff(20) })).item.id));
        assert.ok(bonusKeys(e2).includes('early_finish'));

        // Editing: the same date keeps its age, a different date starts the clock again, clearing it clears the stamp.
        const edit = await ageDue((await db.tasks.addItem(E, l2.id, { name: 'edit', due_date: dayOff(10) })).item.id);
        const before = (await setAt(edit)).getTime();
        await db.tasks.updateItem(E, edit, { due_date: dayOff(10), name: 'edit2' });
        assert.equal((await setAt(edit)).getTime(), before);
        await db.tasks.updateItem(E, edit, { due_date: dayOff(11) });
        assert.ok((await setAt(edit)).getTime() > before + 86400e3, 'a changed date is fresh again');
        const e3 = await db.tasks.setItemCompleted(E, edit);
        assert.ok(!bonusKeys(e3).includes('early_finish'));
        const none = (await db.tasks.addItem(E, l2.id, { name: 'none' })).item;
        assert.equal(await setAt(none.id), null);
        await db.tasks.updateItem(E, none.id, { due_date: dayOff(2) });
        assert.ok(await setAt(none.id));
        await db.tasks.updateItem(E, none.id, { due_date: '' });
        assert.equal(await setAt(none.id), null);

        // A repeating copy is stamped when it spawns; imported tasks when they are imported.
        const rep = (await db.tasks.addItem(E, l2.id, { name: 'daily', recurrence: 'daily', due_date: dayOff(0) })).item;
        const done = await db.tasks.setItemCompleted(E, rep.id);
        assert.ok(await setAt(done.nextItem.id));
        await db.transfer.importAll(E, { lists: [{ name: 'Imp2', items: [{ name: 'x', due_date: dayOff(5) }] }] });
        const imported = (await db.query("SELECT i.id FROM items i JOIN lists l ON l.id = i.list_id WHERE l.name = 'Imp2' AND l.discord_id = ?", [E]))[0];
        assert.ok(await setAt(imported.id));
    });

    await t.test('lock order: breaking a task down while the same user adds and completes tasks never deadlocks', async () => {
        const U = '100000000000000611';
        await db.users.ensureUser(U);
        const { list } = await db.tasks.createList(U, { name: 'Lock order' });
        const parents = [];
        for (let n = 0; n < 6; n++) parents.push((await db.tasks.addItem(U, list.id, { name: `p${n}` })).item.id);
        const deadlocks = async () => {
            const [rows] = await pool.query('SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()');
            return rows[0] ? Number(rows[0].deadlocks) : null;
        };
        const before = await deadlocks();
        for (let round = 0; round < 5; round++) {
            const results = await Promise.allSettled([
                ...parents.map((id) => db.tasks.addSubtasks(U, id, ['a', 'b'])),
                ...parents.map((id, n) => db.tasks.addItem(U, list.id, { name: `r${round}-${n}` })),
                ...parents.map((id) => db.tasks.setItemCompleted(U, id, round % 2 === 0))
            ]);
            for (const r of results) assert.equal(r.status, 'fulfilled', r.reason && r.reason.message);
        }
        // Retries would hide a deadlock, so also read the server's counter (pg_stat_database; it can lag by a moment).
        // Other test files run against other databases at the same time, so only a rise is a failure when it is ours.
        const after = await deadlocks();
        if (before !== null) assert.equal(after, before, 'no deadlock was even raised');
    });

    await t.test('lock order: swaps, moves, reorders and edits by different people on one shared list never deadlock', async () => {
        const mk = async (n) => {
            const id = `2000000000000015${String(n).padStart(2, '0')}`;
            await db.users.ensureUser(id, { username: `lock_${n}`, handle: `lock_${n}`, avatar: null });
            return id;
        };
        const [O, E1, E2] = [await mk(1), await mk(2), await mk(3)];
        const { list } = await db.tasks.createList(O, { name: 'Shared lock order' });
        for (const e of [E1, E2]) await db.sharing.respond(e, (await db.sharing.invite(O, list.id, { discordId: e, role: 'editor' })).id, true);
        const ids = [];
        for (let n = 0; n < 8; n++) ids.push((await db.tasks.addItem(O, list.id, { name: `t${n}` })).item.id);
        const deadlocks = async () => {
            const [rows] = await pool.query('SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()');
            return rows[0] ? Number(rows[0].deadlocks) : null;
        };
        const before = await deadlocks();
        for (let round = 0; round < 8; round++) {
            const shuffled = [...ids].sort(() => Math.random() - 0.5);
            const results = await Promise.allSettled([
                // Opposite orders of the same pair: the classic way to deadlock when locks are taken in argument order.
                db.tasks.swapItemPositions(E1, ids[0], ids[1]),
                db.tasks.swapItemPositions(E2, ids[1], ids[0]),
                db.tasks.swapItemPositions(O, ids[2], ids[3]),
                db.tasks.swapItemPositions(E1, ids[3], ids[2]),
                db.tasks.moveItem(E1, ids[4], 0),
                db.tasks.moveItem(E2, ids[0], 5),
                db.tasks.reorderItems(O, list.id, shuffled),
                db.tasks.setItemCompleted(E1, ids[5], round % 2 === 0),
                db.tasks.setItemCompleted(E2, ids[6], round % 2 === 0),
                db.tasks.updateItem(E2, ids[7], { name: `renamed ${round}`, position: 2 })
            ]);
            for (const r of results) assert.equal(r.status, 'fulfilled', r.reason && r.reason.message);
        }
        const after = await deadlocks();
        if (before !== null) assert.equal(after, before, 'no deadlock was even raised');
        const positions = (await db.tasks.getItems(O, list.id)).map((i) => i.position).sort((a, b) => a - b);
        assert.deepEqual(positions, ids.map((_, n) => n), 'positions stay unique and contiguous');
    });

    await t.test('per-user quotas hold on every way of creating lists and tasks', async () => {
        const { LIMITS: L } = require('../src/constants');
        const Q = '100000000000000621';
        const M = '100000000000000622';
        await db.users.ensureUser(Q);
        await db.users.ensureUser(M);
        // Lists: fill to the cap with plain rows, then the next one is refused.
        const base = (await db.tasks.createList(Q, { name: 'Quota 0' })).list;
        await pool.query("INSERT INTO lists (discord_id, name) SELECT ?, 'Quota ' || n FROM generate_series(1, ?::int) AS n", [Q, L.MAX_LISTS_PER_USER - 1]);
        await assert.rejects(db.tasks.createList(Q, { name: 'One too many' }), { code: 'VALIDATION', message: /at most 200 lists/ });
        await assert.rejects(db.tasks.createListWithItems(Q, { name: 'Also too many' }, ['a']), { code: 'VALIDATION' });
        await db.query("DELETE FROM lists WHERE discord_id = ? AND name = 'Quota 1'", [Q]);
        await db.tasks.createList(Q, { name: 'Room again' });

        // Tasks: fill the user's lists to the cap, then every way of adding one is refused.
        const recurring = (await db.tasks.addItem(Q, base.id, { name: 'repeat', recurrence: 'daily' })).item;
        const parent = (await db.tasks.addItem(Q, base.id, { name: 'parent' })).item;
        const have = Number((await db.query('SELECT COUNT(*) AS n FROM items i JOIN lists l ON l.id = i.list_id WHERE l.discord_id = ?', [Q]))[0].n);
        await pool.query("INSERT INTO items (list_id, name, position, created_by) SELECT ?, 'bulk' || n, n + 10, ? FROM generate_series(?::int, ?::int) AS n", [base.id, Q, have, L.MAX_ITEMS_PER_USER - 1]);
        await assert.rejects(db.tasks.addItem(Q, base.id, { name: 'over' }), { code: 'VALIDATION', message: /5000 tasks/ });
        await assert.rejects(db.tasks.addItems(Q, base.id, [{ name: 'o1' }, { name: 'o2' }]), { code: 'VALIDATION' });
        await assert.rejects(db.tasks.addSubtasks(Q, parent.id, ['s1']), { code: 'VALIDATION' });
        await assert.rejects(db.tasks.createListWithItems(Q, { name: 'Fresh list' }, ['x']), { code: 'VALIDATION' });
        assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM lists WHERE name = 'Fresh list'"))[0].n), 0, 'all or nothing');
        // A member adding to the capped owner's list is refused too: the owner's data grows.
        await db.query("INSERT INTO list_members (list_id, discord_id, role, public_id, added_by) VALUES (?, ?, 'editor', 'abcdef012345', ?)", [base.id, M, Q]);
        await assert.rejects(db.tasks.addItem(M, base.id, { name: 'member over' }), { code: 'VALIDATION' });
        // Finishing a repeating task at the cap does not spawn a next copy: the completed task stays, so a copy is a new row.
        const done = await db.tasks.setItemCompleted(Q, recurring.id);
        assert.equal(done.nextItem, null, 'no next occurrence at the cap');
        // Deleting makes room.
        await db.tasks.deleteItem(Q, recurring.id);
        await db.tasks.deleteItem(Q, parent.id);
        await db.tasks.addItem(Q, base.id, { name: 'fits now' });
    });

    await t.test('a re-opened list does not pay the Artisan clear bonus or list_cleared a second time', async () => {
        const R = '100000000000000631';
        await db.users.ensureUser(R);
        await setXP(R, 700);
        await db.progression.buyClass(R, 'artisan');
        const { list } = await db.tasks.createList(R, { name: 'Reopen' });
        const ids = [];
        for (const name of ['a', 'b', 'c']) ids.push((await db.tasks.addItem(R, list.id, { name })).item.id);
        await db.tasks.setItemCompleted(R, ids[0]);
        await db.tasks.setItemCompleted(R, ids[1]);
        const cleared = await db.tasks.setItemCompleted(R, ids[2]);
        assert.equal(cleared.xp.bonusInfo.type, 'ARTISAN_CLEAR');
        assert.ok(bonusKeys(cleared).includes('list_cleared'));
        // Re-open with new tasks and clear it again: the list is already marked cleared.
        const again = [];
        for (const name of ['d', 'e', 'f']) again.push((await db.tasks.addItem(R, list.id, { name })).item.id);
        for (const id of again.slice(0, 2)) await db.tasks.setItemCompleted(R, id);
        const second = await db.tasks.setItemCompleted(R, again[2]);
        assert.equal(second.xp.bonusInfo.type, 'ARTISAN', 'no second project bonus');
        assert.ok(!bonusKeys(second).includes('list_cleared'));
        assert.ok(Number((await db.users.getUser(R)).artisan_progress) > 0, 'progress keeps building instead of resetting');
    });

    await t.test('import: list names that differ only by case get an (imported) suffix instead of a 500', async () => {
        const U = '100000000000000641';
        await db.users.ensureUser(U);
        await db.tasks.createList(U, { name: 'Café' });
        const r = await db.transfer.importAll(U, { lists: [{ name: 'Cafe' }, { name: 'CAFÉ' }, { name: 'cafe' }, { name: 'Naïve' }, { name: 'Naive' }] });
        assert.equal(r.lists, 5);
        const names = (await db.query('SELECT name FROM lists WHERE discord_id = ? ORDER BY id', [U])).map((x) => x.name);
        assert.equal(new Set(names).size, 6, names.join(' | '));
        // List names are CITEXT: unique ignoring case, but accents count (Cafe and Café are two lists).
        assert.ok(names.includes('CAFÉ (imported)'), names.join(' | '));
        assert.ok(names.includes('cafe (imported)'), names.join(' | '));
        assert.ok(names.includes('Naive') && names.includes('Naïve'), names.join(' | '));
    });

    await t.test('sending or snoozing a task reminder does not touch items.updated_at', async () => {
        const U = '100000000000000642';
        await db.users.ensureUser(U);
        const { list } = await db.tasks.createList(U, { name: 'Quiet reminders' });
        const { item } = await db.tasks.addItem(U, list.id, { name: 'Remind me', due_date: dayOffset(1) });
        const stamp = async () => String((await db.query('SELECT updated_at FROM items WHERE id = ?', [item.id]))[0].updated_at);
        await db.query("UPDATE items SET updated_at = '2020-01-01 00:00:00' WHERE id = ?", [item.id]);
        const before = await stamp();
        await db.tasks.snoozeTask(U, item.id, new Date(Date.now() + 3600e3));
        assert.equal(await stamp(), before, 'snooze');
        await db.tasks.markTaskReminderSent(item.id);
        assert.equal(await stamp(), before, 'reminder sent');
        const row = (await db.query('SELECT reminded_at, remind_at FROM items WHERE id = ?', [item.id]))[0];
        assert.ok(row.reminded_at);
        assert.equal(row.remind_at, null);
    });

    await t.test('a monthly task re-saved with the same date and rule keeps its anchor day; a real change starts a new one', async () => {
        const U = '100000000000000651';
        await db.users.ensureUser(U);
        const { list } = await db.tasks.createList(U, { name: 'Rent on the 31st' });
        const { item } = await db.tasks.addItem(U, list.id, { name: 'Rent', due_date: '2031-04-30', recurrence: 'monthly' });
        // As a copy spawned from a task due on the 31st would be: due on the 30th (April), anchored on the 31st.
        await db.query('UPDATE items SET repeat_anchor_day = 31 WHERE id = ?', [item.id]);
        const anchor = async () => (await db.query('SELECT repeat_anchor_day AS a FROM items WHERE id = ?', [item.id]))[0].a;

        await db.tasks.updateItem(U, item.id, { name: 'Rent!', due_date: '2031-04-30', recurrence: 'monthly' });
        assert.equal(await anchor(), 31, 'the edit form re-sends the same date and rule');
        await db.tasks.updateItem(U, item.id, { recurrence: 'Monthly' });
        assert.equal(await anchor(), 31, 'the same rule, spelled differently');
        await db.tasks.updateItem(U, item.id, { due_date: '2031-05-15' });
        assert.equal(await anchor(), null, 'a new date starts a new anchor');
        await db.query('UPDATE items SET repeat_anchor_day = 15 WHERE id = ?', [item.id]);
        await db.tasks.updateItem(U, item.id, { recurrence: 'weekly' });
        assert.equal(await anchor(), null, 'so does a new rule');
    });

    await t.test('a task edit and its move are one transaction: a move that fails keeps the old fields', async () => {
        const U = '100000000000000652';
        await db.users.ensureUser(U);
        const { list } = await db.tasks.createList(U, { name: 'Atomic edit' });
        const a = (await db.tasks.addItem(U, list.id, { name: 'a' })).item;
        await db.tasks.addItem(U, list.id, { name: 'b' });
        // Make the move fail half-way (its position UPDATE throws), as a lost connection or a deadlock in the middle of it would.
        const probe = await pool.getConnection();
        const Connection = Object.getPrototypeOf(probe);
        probe.release();
        const query = Connection.query;
        Connection.query = function (sql, params) {
            if (/^UPDATE items SET position/.test(String(sql).trim())) return Promise.reject(new Error('move refused'));
            return query.call(this, sql, params);
        };
        try {
            await assert.rejects(db.tasks.updateItem(U, a.id, { name: 'renamed', priority: 'HIGH', position: 1 }), /move refused/);
        } finally {
            Connection.query = query;
        }
        const row = (await db.query('SELECT name, priority, position FROM items WHERE id = ?', [a.id]))[0];
        assert.deepEqual({ ...row }, { name: 'a', priority: null, position: 0 }, 'nothing of the edit was kept');

        const done = await db.tasks.updateItem(U, a.id, { name: 'renamed', position: 1 });
        assert.equal(done.name, 'renamed');
        assert.equal(done.position, 1);
    });

    await t.test('an AI (owner-only) write waiting on the list sees a hand-over that commits first, and is refused', async () => {
        const O = '100000000000000653';
        const N = '100000000000000654';
        for (const id of [O, N]) await db.users.ensureUser(id);
        const { list } = await db.tasks.createList(O, { name: 'Handed over mid-write' });
        const { item } = await db.tasks.addItem(O, list.id, { name: 'existing' });
        const count = async () => Number((await db.query('SELECT COUNT(*) AS n FROM items WHERE list_id = ?', [list.id]))[0].n);

        for (const [label, write] of [
            ['addItem', () => db.tasks.asOwner.addItem(O, list.id, { name: 'from the AI' })],
            ['updateItem', () => db.tasks.asOwner.updateItem(O, item.id, { name: 'renamed by the AI' })],
            ['setItemCompleted', () => db.tasks.asOwner.setItemCompleted(O, item.id, true)],
            ['addSubtasks', () => db.tasks.asOwner.addSubtasks(O, item.id, ['one', 'two'])],
            ['updateList', () => db.tasks.asOwner.updateList(O, list.id, { priority: 'HIGH' })]
        ]) {
            await db.query('UPDATE lists SET discord_id = ? WHERE id = ?', [O, list.id]);
            await db.query('DELETE FROM list_members WHERE list_id = ?', [list.id]);
            const before = await count();
            // Another session holds the list (as a hand-over does) and gives it to N, keeping O on it as a manager.
            const conn = await pool.getConnection();
            let pending;
            try {
                await conn.beginTransaction();
                await conn.query('SELECT id FROM lists WHERE id = ? FOR UPDATE', [list.id]);
                pending = write().then(
                    (value) => ({ value }),
                    (error) => ({ error })
                );
                await new Promise((resolve) => setTimeout(resolve, 150)); // the write has checked what it can and waits on the list
                await conn.query('UPDATE lists SET discord_id = ? WHERE id = ?', [N, list.id]);
                await conn.query("INSERT INTO list_members (list_id, discord_id, role, public_id) VALUES (?, ?, 'manager', ?)", [list.id, O, require('crypto').randomBytes(6).toString('hex')]);
                await conn.commit();
            } finally {
                conn.release();
            }
            const outcome = await pending;
            assert.equal(outcome.error && outcome.error.code, 'NOT_FOUND', `${label}: refused once the list is someone else's`);
            assert.equal(await count(), before, `${label}: nothing was added`);
        }
        const row = (await db.query('SELECT name, completed FROM items WHERE id = ?', [item.id]))[0];
        assert.deepEqual({ ...row }, { name: 'existing', completed: 0 });
        assert.equal((await db.query('SELECT priority FROM lists WHERE id = ?', [list.id]))[0].priority, null);
    });

    await t.test('a hand-over swaps reminder state: each person keeps their own, on the rows as owner and in the reminder tables as member', async () => {
        const O = '100000000000000655';
        const N = '100000000000000656';
        for (const id of [O, N]) await db.users.ensureUser(id);
        await db.query('UPDATE users SET discord_username = ? WHERE discord_id = ?', ['remind_new', N]);
        await db.query('UPDATE users SET discord_username = ? WHERE discord_id = ?', ['remind_old', O]);
        const { list } = await db.tasks.createList(O, { name: 'Reminder hand-over', deadline: dayOffset(1) });
        const a = (await db.tasks.addItem(O, list.id, { name: 'a', due_date: dayOffset(1) })).item;
        const b = (await db.tasks.addItem(O, list.id, { name: 'b', due_date: dayOffset(1) })).item;
        const c = (await db.tasks.addItem(O, list.id, { name: 'c', due_date: dayOffset(1) })).item;
        await db.query("INSERT INTO list_members (list_id, discord_id, role, public_id) VALUES (?, ?, 'editor', ?)", [list.id, N, require('crypto').randomBytes(6).toString('hex')]);
        const T = (s) => new Date(`2031-01-0${s}T03:04:05.000Z`);
        // The owner was told the deadline is near, snoozed the list, was reminded about a and snoozed b.
        await db.query('UPDATE lists SET deadline_notified = 1, overdue_notified = 0, remind_at = ? WHERE id = ?', [T(1), list.id]);
        await db.query('UPDATE items SET reminded_at = ? WHERE id = ?', [T(2), a.id]);
        await db.query('UPDATE items SET remind_at = ? WHERE id = ?', [T(3), b.id]);
        // The member was told about the deadline and the overdue day, and was reminded about c.
        await db.query('INSERT INTO list_reminders (list_id, discord_id, deadline_notified, overdue_notified, remind_at) VALUES (?, ?, 1, 1, NULL)', [list.id, N]);
        await db.query('INSERT INTO item_reminders (item_id, discord_id, reminded_at, remind_at) VALUES (?, ?, ?, NULL)', [c.id, N, T(4)]);
        const ms = (d) => (d ? new Date(d).getTime() : null);
        const listState = async () => {
            const [l] = await db.query('SELECT deadline_notified AS dn, overdue_notified AS onn, remind_at FROM lists WHERE id = ?', [list.id]);
            return [Number(l.dn), Number(l.onn), ms(l.remind_at)];
        };
        const memberList = async (who) => {
            const rows = await db.query('SELECT deadline_notified AS dn, overdue_notified AS onn, remind_at FROM list_reminders WHERE list_id = ? AND discord_id = ?', [list.id, who]);
            return rows.map((r) => [Number(r.dn), Number(r.onn), ms(r.remind_at)]);
        };
        const itemState = async () => (await db.query('SELECT name, reminded_at, remind_at FROM items WHERE list_id = ? ORDER BY name', [list.id])).map((r) => [r.name, ms(r.reminded_at), ms(r.remind_at)]);
        const memberItems = async (who) =>
            (await db.query('SELECT i.name, r.reminded_at, r.remind_at FROM item_reminders r JOIN items i ON i.id = r.item_id WHERE i.list_id = ? AND r.discord_id = ? ORDER BY i.name', [list.id, who])).map((r) => [
                r.name,
                ms(r.reminded_at),
                ms(r.remind_at)
            ]);
        const stamp = async () => (await db.query('SELECT MAX(updated_at) AS t FROM items WHERE list_id = ?', [list.id]))[0].t;
        const before = String(await stamp());

        const key = (await db.sharing.listMembers(O, list.id)).members.find((m) => m.name === 'remind_new').memberKey;
        await db.sharing.transferOwnership(O, list.id, key);
        assert.deepEqual(await listState(), [1, 1, null], "the list carries the new owner's state");
        assert.deepEqual(await itemState(), [['a', null, null], ['b', null, null], ['c', ms(T(4)), null]], 'so do the tasks');
        assert.deepEqual(await memberList(O), [[1, 0, ms(T(1))]], 'the old owner keeps their list state as a member');
        assert.deepEqual(await memberItems(O), [['a', ms(T(2)), null], ['b', null, ms(T(3))]], 'and their task reminders and snoozes');
        assert.deepEqual(await memberList(N), [], 'the new owner has no member rows left');
        assert.deepEqual(await memberItems(N), []);
        assert.equal(String(await stamp()), before, 'moving reminder state is not an edit of the tasks');

        // The bot now reminds each of them by their own state: the old owner's snooze of b is still theirs.
        const due = (await db.tasks.getTaskReminderCandidates(T(5))).filter((r) => r.list_id === list.id);
        assert.deepEqual(due.filter((r) => r.discord_id === O).map((r) => r.name), ['b']);

        // And back: a hand-over to someone who has no member list row resets the list's flags to "not told yet".
        await db.query('DELETE FROM list_reminders WHERE list_id = ? AND discord_id = ?', [list.id, O]);
        const back = (await db.sharing.listMembers(N, list.id)).members.find((m) => m.name === 'remind_old').memberKey;
        await db.sharing.transferOwnership(N, list.id, back);
        assert.deepEqual(await listState(), [0, 0, null]);
        assert.deepEqual(await itemState(), [['a', ms(T(2)), null], ['b', null, ms(T(3))], ['c', null, null]]);
        assert.deepEqual(await memberList(N), [[1, 1, null]]);
        assert.deepEqual(await memberItems(N), [['c', ms(T(4)), null]]);
        assert.deepEqual(await memberItems(O), []);
    });

    await t.test('import links subtasks whatever the row order, and refuses duplicate ids, self-parents and grandchildren', async () => {
        const U = '100000000000000657';
        await db.users.ensureUser(U);
        let n = 0;
        const imported = async (items) => {
            const name = `order ${++n}`;
            const r = await db.transfer.importAll(U, { lists: [{ name, items }] });
            const rows = await db.query('SELECT i.id, i.name, i.parent_id FROM items i JOIN lists l ON l.id = i.list_id WHERE l.discord_id = ? AND l.name = ? ORDER BY i.position', [U, name]);
            const byId = new Map(rows.map((x) => [x.id, x.name]));
            return { r, links: Object.fromEntries(rows.map((x) => [x.name, x.parent_id === null ? null : byId.get(x.parent_id)])) };
        };
        const childFirst = await imported([{ id: 2, name: 'child', parent_id: 1 }, { id: 1, name: 'parent' }]);
        assert.deepEqual(childFirst.links, { parent: null, child: 'parent' }, 'a subtask listed before its parent still belongs to it');
        assert.equal(childFirst.r.orphanedSubtasks, undefined);
        const orphan = await imported([{ id: 1, name: 'lonely', parent_id: 99 }, { name: 'plain' }]);
        assert.deepEqual(orphan.links, { lonely: null, plain: null });
        assert.equal(orphan.r.orphanedSubtasks, 1, 'a parent that is not in the file is reported');

        const listsBefore = (await db.tasks.getLists(U)).length;
        const refused = (items, pattern) => assert.rejects(db.transfer.importAll(U, { lists: [{ name: 'bad', items }] }), (err) => err.code === 'VALIDATION' && pattern.test(err.message));
        await refused([{ id: 1, name: 'a' }, { id: 1, name: 'b' }], /items\[1\]: the id "1" is used by more than one task/);
        await refused([{ id: 1, name: 'a' }, { id: '1', name: 'b' }], /more than one task/);
        await refused([{ id: 1, name: 'a', parent_id: 1 }], /own subtask/);
        // A subtask of a subtask is refused in every order, not only when the middle task happens to come first.
        const chain = [{ id: 1, name: 'a' }, { id: 2, name: 'b', parent_id: 1 }, { id: 3, name: 'c', parent_id: 2 }];
        for (const order of [[0, 1, 2], [0, 2, 1], [2, 1, 0], [1, 2, 0], [2, 0, 1]]) await refused(order.map((i) => chain[i]), /one level deep/);
        assert.equal((await db.tasks.getLists(U)).length, listsBefore, 'a refused import writes nothing');
    });

    await t.test('a progress reset also clears reflections, goals, member reminder state and push subscriptions, and withdraws sent invitations', async () => {
        const U = '100000000000000658';
        const OTHER = '100000000000000659';
        const INVITEE = '100000000000000660';
        for (const id of [U, OTHER, INVITEE]) await db.users.ensureUser(id);
        const { list } = await db.tasks.createList(OTHER, { name: "Someone else's" });
        const { item } = await db.tasks.addItem(OTHER, list.id, { name: 'theirs', due_date: dayOffset(1) });
        await db.query("INSERT INTO list_members (list_id, discord_id, role, public_id) VALUES (?, ?, 'manager', ?)", [list.id, U, require('crypto').randomBytes(6).toString('hex')]);
        await db.tasks.snoozeList(U, list.id, new Date(Date.now() + 3600e3));
        await db.tasks.snoozeTask(U, item.id, new Date(Date.now() + 3600e3));
        await db.query('INSERT INTO reflections (discord_id, day, note) VALUES (?, ?, ?)', [U, dayOffset(0), 'a good day']);
        await db.query('INSERT INTO weekly_goals (discord_id, week_key, target) VALUES (?, ?, 10)', [U, dayOffset(0)]);
        await db.query("INSERT INTO push_subscriptions (discord_id, endpoint, endpoint_hash, p256dh, auth) VALUES (?, 'https://push.example/x', ?, 'k', 'a')", [U, 'f'.repeat(64)]);
        const expires = new Date(Date.now() + 86400e3);
        await db.query("INSERT INTO list_invites (list_id, invitee_discord_id, role, invited_by, expires_at) VALUES (?, ?, 'viewer', ?, ?)", [list.id, INVITEE, U, expires]);
        await db.query("INSERT INTO list_invites (list_id, invitee_discord_id, role, invited_by, status, expires_at) VALUES (?, ?, 'viewer', ?, 'declined', ?)", [list.id, OTHER, U, expires]);
        const [[party]] = await pool.query("INSERT INTO parties (name, owner_id) VALUES ('Not mine', ?) RETURNING id", [OTHER]).then(([res]) => [res.rows]);
        await db.query('INSERT INTO party_invites (party_id, invitee_discord_id, invited_by, expires_at) VALUES (?, ?, ?, ?)', [party.id, INVITEE, U, expires]);

        await db.users.resetProgress(U);
        const count = async (sql) => Number((await db.query(sql, [U]))[0].n);
        for (const table of ['reflections', 'weekly_goals', 'push_subscriptions', 'list_reminders', 'item_reminders', 'list_members']) {
            assert.equal(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE discord_id = ?`), 0, table);
        }
        assert.equal(await count("SELECT COUNT(*) AS n FROM list_invites WHERE invited_by = ? AND status = 'pending'"), 0, 'pending list invitations are withdrawn');
        assert.equal(await count("SELECT COUNT(*) AS n FROM party_invites WHERE invited_by = ? AND status = 'pending'"), 0, 'pending party invitations are withdrawn');
        assert.equal(await count("SELECT COUNT(*) AS n FROM list_invites WHERE invited_by = ? AND status = 'declined'"), 1, 'a decline still counts for the cooldown');
        assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM items WHERE id = ?', [item.id]))[0].n), 1, "the other person's list is untouched");
    });

    await t.test('list overviews count top-level tasks only, like clearing a list does', async () => {
        const U = '100000000000000661';
        await db.users.ensureUser(U);
        const { list } = await db.tasks.createList(U, { name: 'Counted' });
        const a = (await db.tasks.addItem(U, list.id, { name: 'a' })).item;
        await db.tasks.addItem(U, list.id, { name: 'b' });
        await db.tasks.addSubtasks(U, a.id, ['a1', 'a2']);
        await db.tasks.setItemCompleted(U, a.id, true);
        const row = (await db.tasks.getLists(U)).find((l) => l.id === list.id);
        assert.deepEqual([row.items_total, row.items_completed], [2, 1], 'two tasks, one done; the open subtasks are steps of the done one');
    });

    await t.test('reordering a long list writes every position in a few statements and leaves unmoved rows alone', async () => {
        const U = '100000000000000662';
        await db.users.ensureUser(U);
        const { list } = await db.tasks.createList(U, { name: 'Long list' });
        const N = 2345; // three chunks of the batched UPDATE
        await db.query("INSERT INTO items (list_id, name, position) SELECT ?, 't' || g, g FROM generate_series(0, ?) AS g", [list.id, N - 1]);
        const ids = (await db.query('SELECT id FROM items WHERE list_id = ? ORDER BY position', [list.id])).map((r) => r.id);
        await db.query("UPDATE items SET updated_at = '2020-01-01 00:00:00' WHERE list_id = ?", [list.id]);

        const reversed = [...ids].reverse();
        await db.tasks.reorderItems(U, list.id, reversed);
        const after = await db.query('SELECT id, position FROM items WHERE list_id = ? ORDER BY position', [list.id]);
        assert.deepEqual(after.map((r) => r.id), reversed);
        assert.deepEqual(after.map((r) => r.position), reversed.map((_, i) => i));
        // The middle row of an odd-length list keeps its position, so it is not written.
        const untouched = await db.query("SELECT COUNT(*) AS n FROM items WHERE list_id = ? AND updated_at = '2020-01-01 00:00:00'", [list.id]);
        assert.equal(Number(untouched[0].n), 1);

        // A move inside the long list goes through the same writer.
        await db.tasks.moveItem(U, reversed[N - 1], 0);
        const moved = await db.query('SELECT id, position FROM items WHERE list_id = ? ORDER BY position', [list.id]);
        assert.equal(moved[0].id, reversed[N - 1]);
        assert.deepEqual(moved.map((r) => r.position), moved.map((_, i) => i));
        await db.query('DELETE FROM lists WHERE id = ?', [list.id]);
    });

    await db.closePool();
});
