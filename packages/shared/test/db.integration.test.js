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

    await t.test('migrations 007-009 are idempotent and add the new columns', async () => {
        await pool.query("DELETE FROM schema_migrations WHERE id >= '007'"); // pretend they were interrupted
        const again = await db.runMigrations({ log: () => {} });
        assert.deepEqual(again.filter((id) => id >= '007'), ['007_item_fields', '008_user_prefs', '009_quest_claims']);
        const cols = async (table) => (await pool.query(`SHOW COLUMNS FROM ${table}`))[0].map((c) => c.Field);
        const items = await cols('items');
        for (const c of ['due_date', 'priority', 'tags', 'parent_id', 'recurrence']) assert.ok(items.includes(c), `items.${c}`);
        const users = await cols('users');
        for (const c of ['timezone', 'reminder_hour', 'weekly_digest', 'last_digest_at', 'calendar_token', 'streak_freezes', 'xp_spent']) {
            assert.ok(users.includes(c), `users.${c}`);
        }
        assert.ok((await cols('lists')).includes('remind_at'));
        assert.equal((await pool.query("SHOW TABLES LIKE 'quest_claims'"))[0].length, 1);
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

    await t.test('reminders cover due and recently missed lists only', async () => {
        const mk = async (name, deadline) => (await db.tasks.createList(CAROL, { name, deadline })).list;
        const today = await mk('due today', '2030-06-10');
        const missed = await mk('missed', '2030-06-08');
        const ancient = await mk('ancient', '2030-05-01');
        const future = await mk('future', '2030-06-11');
        const ids = (await db.tasks.getListsDueBy('2030-06-10')).map((l) => l.id);
        assert.ok(ids.includes(today.id) && ids.includes(missed.id));
        assert.ok(!ids.includes(ancient.id) && !ids.includes(future.id));
        await db.tasks.markDeadlineNotified(today.id);
        assert.ok(!(await db.tasks.getListsDueBy('2030-06-10')).some((l) => l.id === today.id));
    });

    await t.test('tasks carry their own due date, priority, tags and subtasks', async () => {
        const { list } = await db.tasks.createList(CAROL, { name: 'Detailed', priority: 'LOW' });
        const { item: parent } = await db.tasks.addItem(CAROL, list.id, {
            name: 'Write report', due_date: '2030-07-01', priority: 'high', tags: '#Work, urgent', recurrence: 'weekly'
        });
        assert.equal(parent.priority, 'HIGH');
        assert.equal(parent.tags, 'work,urgent');
        assert.equal(parent.recurrence, 'weekly');
        assert.equal(String(parent.due_date), '2030-07-01');

        const { item: child } = await db.tasks.addItem(CAROL, list.id, { name: 'Outline', parent_id: parent.id });
        assert.equal(child.parent_id, parent.id);
        await assert.rejects(db.tasks.addItem(CAROL, list.id, { name: 'Too deep', parent_id: child.id }), { code: 'VALIDATION' });
        await assert.rejects(db.tasks.updateItem(CAROL, parent.id, { parent_id: child.id }), { code: 'VALIDATION' });
        await assert.rejects(db.tasks.updateItem(CAROL, child.id, { parent_id: child.id }), { code: 'VALIDATION' });
        const { list: other } = await db.tasks.createList(CAROL, { name: 'Elsewhere' });
        await assert.rejects(db.tasks.addItem(CAROL, other.id, { name: 'x', parent_id: parent.id }), { code: 'VALIDATION' });
        await assert.rejects(db.tasks.addItem(CAROL, list.id, { name: 'x', tags: 'a b c d e f' }), { code: 'VALIDATION' });
        await assert.rejects(db.tasks.addItem(CAROL, list.id, { name: 'x', due_date: '2030-13-01' }), { code: 'VALIDATION' });

        const edited = await db.tasks.updateItem(CAROL, child.id, { priority: null, tags: ['one'], due_date: '2030-07-02', recurrence: null });
        assert.equal(edited.tags, 'one');
        assert.equal(edited.priority, null);
        const detached = await db.tasks.updateItem(CAROL, child.id, { parent_id: null });
        assert.equal(detached.parent_id, null);

        await db.tasks.updateItem(CAROL, child.id, { parent_id: parent.id });
        await db.tasks.deleteItem(CAROL, parent.id);
        assert.equal(await db.tasks.getItem(CAROL, child.id), null, 'subtasks go with their parent');
    });

    await t.test('completing a repeating task creates exactly one next occurrence', async () => {
        const { list } = await db.tasks.createList(CAROL, { name: 'Habits' });
        const { item } = await db.tasks.addItem(CAROL, list.id, { name: 'Water plants', due_date: '2099-01-31', recurrence: 'monthly', tags: 'home' });
        const before = await db.users.getUser(CAROL);
        const done = await db.tasks.setItemCompleted(CAROL, item.id, true);
        assert.ok(done.nextItem, 'next occurrence created');
        assert.equal(String(done.nextItem.due_date).slice(0, 10), '2099-02-28');
        assert.equal(done.nextItem.name, 'Water plants');
        assert.equal(done.nextItem.tags, 'home');
        assert.equal(Boolean(done.nextItem.completed), false);

        await db.tasks.setItemCompleted(CAROL, item.id, false);
        const again = await db.tasks.setItemCompleted(CAROL, item.id, true);
        assert.equal(again.nextItem, null, 're-checking must not spawn another copy');
        const copies = (await db.tasks.getItems(CAROL, list.id)).filter((i) => i.name === 'Water plants');
        assert.equal(copies.length, 2);

        const after = await db.users.getUser(CAROL);
        assert.equal(Number(after.total_items_added), Number(before.total_items_added), 'a repeat is not a newly added task');
    });

    await t.test('streak freezes are bought, capped, consumed once, and count as spending', async () => {
        const DAVE = '100000000000000004';
        await db.users.ensureUser(DAVE);
        await assert.rejects(db.progression.buyStreakFreeze(DAVE), { code: 'INSUFFICIENT_XP' });
        await setXP(DAVE, 1000);
        for (let i = 1; i <= 3; i++) assert.equal((await db.progression.buyStreakFreeze(DAVE)).freezes, i);
        await assert.rejects(db.progression.buyStreakFreeze(DAVE), { code: 'CONFLICT' });
        let user = await db.users.getUser(DAVE);
        assert.equal(Number(user.player_xp), 1000 - 3 * 150);
        assert.equal(Number(user.xp_spent), 450);

        // Streak of 5, last claimed 60 hours ago: the freeze keeps it alive and is used up.
        await pool.query('UPDATE users SET streak_count = 5, last_daily_claim = UTC_TIMESTAMP() - INTERVAL 60 HOUR WHERE discord_id = ?', [DAVE]);
        const claim = await db.progression.claimDaily(DAVE);
        assert.equal(claim.streak, 6);
        assert.equal(claim.freezeUsed, true);
        user = await db.users.getUser(DAVE);
        assert.equal(Number(user.streak_freezes), 2);

        // Buying a class counts toward the spending achievements.
        await setXP(DAVE, 5000);
        await db.progression.buyClass(DAVE, 'hero');
        assert.ok(Number((await db.users.getUser(DAVE)).xp_spent) >= 450 + 500);
    });

    await t.test('quests: progress from real activity, one claim per period', async () => {
        const ERIN = '100000000000000005';
        await db.users.ensureUser(ERIN);
        const { list } = await db.tasks.createList(ERIN, { name: 'Quest list', priority: 'HIGH' });
        const quests = async () => Object.fromEntries((await db.quests.getQuests(ERIN)).map((q) => [q.key, q]));

        let q = await quests();
        assert.equal(q.DAILY_COMPLETE_3.progress, 0);
        await assert.rejects(db.quests.claimQuest(ERIN, 'DAILY_COMPLETE_3'), { code: 'VALIDATION' });
        await assert.rejects(db.quests.claimQuest(ERIN, 'NOPE'), { code: 'NOT_FOUND' });

        for (const name of ['a', 'b', 'c']) {
            const { item } = await db.tasks.addItem(ERIN, list.id, { name });
            await db.tasks.setItemCompleted(ERIN, item.id, true);
        }
        q = await quests();
        assert.equal(q.DAILY_COMPLETE_3.progress, 3);
        assert.equal(q.DAILY_COMPLETE_3.claimable, true);
        assert.equal(q.DAILY_HIGH_1.claimable, true, 'tasks inherit the list priority');
        assert.equal(q.DAILY_ADD_3.claimable, true);
        assert.equal(q.WEEKLY_COMPLETE_15.claimable, false);

        const before = Number((await db.users.getUser(ERIN)).player_xp);
        const [a, b] = await Promise.allSettled([db.quests.claimQuest(ERIN, 'DAILY_COMPLETE_3'), db.quests.claimQuest(ERIN, 'daily_complete_3')]);
        assert.equal([a, b].filter((r) => r.status === 'fulfilled').length, 1, 'concurrent claims pay once');
        assert.equal(Number((await db.users.getUser(ERIN)).player_xp) - before, 30);
        q = await quests();
        assert.equal(q.DAILY_COMPLETE_3.claimed, true);
        assert.equal(q.DAILY_COMPLETE_3.claimable, false);
        await assert.rejects(db.quests.claimQuest(ERIN, 'DAILY_COMPLETE_3'), { code: 'CONFLICT' });

        // Tomorrow the daily quest is fresh again, but this week's weekly claim state is separate.
        const tomorrow = new Date(Date.now() + 36 * 3600e3);
        const next = (await db.quests.getQuests(ERIN, tomorrow)).find((x) => x.key === 'DAILY_COMPLETE_3');
        assert.equal(next.claimed, false);
        assert.equal(next.progress, 0);
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

    await t.test('arcade scores must be plausible', async () => {
        const run = await db.games.startArcade(BOB, 'snake');
        await assert.rejects(db.games.finishArcade(BOB, run.sessionId, 10_000), { code: 'VALIDATION' });
        const [[{ state }]] = await pool.query('SELECT state FROM game_sessions WHERE id = ?', [run.sessionId]);
        assert.equal(state, 'cancelled', 'an implausible score cancels the run for good');
        await assert.rejects(db.games.finishArcade(BOB, run.sessionId, 0), { code: 'NOT_FOUND' });
        await assert.rejects(db.games.finishArcade(ALICE, run.sessionId, 0), { code: 'NOT_FOUND' });
        const run2 = await db.games.startArcade(BOB, 'dino');
        const done = await db.games.finishArcade(BOB, run2.sessionId, 0);
        assert.equal(done.xpGained, 0);
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

    await db.closePool();
});
