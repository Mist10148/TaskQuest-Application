/**
 * Lists and items. Every function takes the acting user's Discord ID and
 * only ever touches rows that belong to that user — ownership is part of
 * each SQL statement, never a separate check that could be forgotten.
 */

'use strict';

const { getPool, withTransaction } = require('./pool');
const { lockUser } = require('./users');
const { rewardAction, unlockAchievements, awardFlat, countToday } = require('./progression');
const { errors } = require('../errors');
const { REWARDS, LIMITS, BONUS_LABELS, HABIT_PERIOD_DAYS } = require('../constants');
const v = require('../validation');
const { nextDueOnOrAfter, todayInZone, daysBetween } = require('../dates');

const run = async (sql, params = []) => (await getPool().query(sql, params))[0];

// Each sort is a list of expressions; NULLs always sort last.
const LIST_SORTS = {
    created_at: ['l.created_at'],
    name: ['l.name'],
    deadline: ['l.deadline IS NULL', 'l.deadline'],
    category: ['l.category IS NULL', 'l.category'],
    priority: ["FIELD(l.priority, 'LOW', 'MEDIUM', 'HIGH') = 0", "FIELD(l.priority, 'LOW', 'MEDIUM', 'HIGH')"]
};
const ITEM_SORTS = { position: ['i.position'], name: ['i.name'], completed: ['i.completed'], created_at: ['i.created_at'] };

function orderClause(map, sortBy, order, fallback) {
    const exprs = map[sortBy] || map[fallback];
    const dir = String(order).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    // The "IS NULL" / "= 0" guard always sorts ascending so missing values stay last.
    return exprs.map((e, i) => (exprs.length > 1 && i === 0 ? `${e} ASC` : `${e} ${dir}`)).join(', ');
}

function unwrap(result) {
    if (!result.ok) throw errors.validation(result.error);
    return result.value;
}

function isDuplicate(err) {
    return err && err.code === 'ER_DUP_ENTRY';
}

// ─── Lists ───────────────────────────────────────────────────────────────────

/** Lists with item counts, in one query. */
async function getLists(discordId, { sortBy = 'created_at', order = 'DESC' } = {}) {
    return run(
        `SELECT l.*, COUNT(i.id) AS items_total, COALESCE(SUM(i.completed), 0) AS items_completed
         FROM lists l LEFT JOIN items i ON i.list_id = l.id
         WHERE l.discord_id = ?
         GROUP BY l.id
         ORDER BY ${orderClause(LIST_SORTS, sortBy, order, 'created_at')}`,
        [String(discordId)]
    ).then((rows) => rows.map((r) => ({ ...r, items_total: Number(r.items_total), items_completed: Number(r.items_completed) })));
}

async function getList(discordId, listId) {
    const id = v.id(listId);
    if (!id.ok) return null;
    const [row] = await run('SELECT * FROM lists WHERE id = ? AND discord_id = ?', [id.value, String(discordId)]);
    return row || null;
}

async function getListByName(discordId, name) {
    const [row] = await run('SELECT * FROM lists WHERE discord_id = ? AND name = ?', [String(discordId), String(name)]);
    return row || null;
}

function parseListInput(input, { partial = false } = {}) {
    const out = {};
    if (!partial || input.name !== undefined) out.name = unwrap(v.listName(input.name));
    if (!partial || input.description !== undefined) out.description = unwrap(v.description(input.description));
    if (!partial || input.category !== undefined) out.category = unwrap(v.category(input.category));
    if (!partial || input.priority !== undefined) out.priority = unwrap(v.priority(input.priority));
    if (!partial || input.deadline !== undefined) out.deadline = unwrap(v.deadline(input.deadline));
    return out;
}

/**
 * @returns {Promise<{ list: object, xp: object|null, achievements: object[] }>}
 */
async function createList(discordId, input) {
    const fields = parseListInput(input);
    return withTransaction((conn) => createListIn(conn, discordId, fields));
}

/**
 * Create a list and its first items in ONE transaction: if any item fails, the list (and the XP
 * it earned) is rolled back too, so callers never see a half-created list.
 * @returns {Promise<{ list: object, xp: object|null, achievements: object[], items: Array<{ item: object, xp: object|null, achievements: object[] }> }>}
 */
async function createListWithItems(discordId, input, names = []) {
    const fields = parseListInput(input);
    // Each entry is a task name, or { name, description?, priority?, tags?, recurrence? } (templates).
    const parsed = names.map((entry) => parseItemInput(0, typeof entry === 'string' ? { name: entry } : entry));
    return withTransaction(async (conn) => {
        const created = await createListIn(conn, discordId, fields);
        const items = [];
        for (const p of parsed) items.push(await addItemIn(conn, discordId, { ...p, lid: created.list.id }));
        return { ...created, items };
    });
}

async function createListIn(conn, discordId, fields) {
    const user = await lockUser(conn, discordId);
    let insertId;
    try {
        const [res] = await conn.query(
            'INSERT INTO lists (discord_id, name, description, category, priority, deadline) VALUES (?, ?, ?, ?, ?, ?)',
            [user.discord_id, fields.name, fields.description, fields.category, fields.priority, fields.deadline]
        );
        insertId = res.insertId;
    } catch (err) {
        if (isDuplicate(err)) throw errors.conflict(`You already have a list called "${fields.name}".`);
        throw err;
    }
    await conn.query('UPDATE users SET total_lists_created = total_lists_created + 1 WHERE discord_id = ?', [user.discord_id]);
    user.total_lists_created = Number(user.total_lists_created) + 1;

    const xp = await rewardAction(conn, user, 'list_create', REWARDS.LIST_CREATE, {
        dailyLimit: LIMITS.LIST_CREATE_REWARDS_PER_DAY,
        referenceId: insertId
    });
    const achievements = await unlockAchievements(conn, user);
    const [[list]] = await conn.query('SELECT * FROM lists WHERE id = ?', [insertId]);
    return { list, xp, achievements };
}

async function updateList(discordId, listId, input) {
    const id = unwrap(v.id(listId));
    const fields = parseListInput(input, { partial: true });
    const keys = Object.keys(fields);
    if (!keys.length) throw errors.validation('Nothing to update.');
    if (keys.includes('deadline')) {
        // A new deadline re-arms every reminder (due, overdue and any snooze).
        Object.assign(fields, { deadline_notified: 0, overdue_notified: 0, remind_at: null });
        keys.push('deadline_notified', 'overdue_notified', 'remind_at');
    }
    try {
        const [res] = await getPool().query(
            `UPDATE lists SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND discord_id = ?`,
            [...keys.map((k) => fields[k]), id, String(discordId)]
        );
        if (!res.affectedRows) throw errors.notFound('List not found.');
    } catch (err) {
        if (isDuplicate(err)) throw errors.conflict(`You already have a list called "${fields.name}".`);
        throw err;
    }
    return getList(discordId, id);
}

async function deleteList(discordId, listId) {
    const id = unwrap(v.id(listId));
    const [res] = await getPool().query('DELETE FROM lists WHERE id = ? AND discord_id = ?', [id, String(discordId)]);
    if (!res.affectedRows) throw errors.notFound('List not found.');
    return true;
}

const SEARCH_LIMIT = 50;
const SEARCH_SCOPES = ['lists', 'tasks', 'all'];

/** A LIKE pattern that matches the (trimmed, length-capped) query literally, % and _ included. */
const likeTerm = (query) => `%${v.escapeLike(v.cleanText(query).slice(0, 100))}%`;

async function searchLists(discordId, query) {
    const term = likeTerm(query);
    return run(
        `SELECT * FROM lists WHERE discord_id = ?
           AND (name LIKE ? ESCAPE '\\\\' OR category LIKE ? ESCAPE '\\\\' OR description LIKE ? ESCAPE '\\\\')
         ORDER BY name
         LIMIT ${SEARCH_LIMIT * 2}`,
        [String(discordId), term, term, term]
    );
}

/** Tasks (name or description) of the user's lists, each with its quest, at most SEARCH_LIMIT. */
async function searchItems(discordId, query) {
    const term = likeTerm(query);
    const rows = await run(
        `SELECT i.id, i.name, i.description, i.completed, i.parent_id, i.due_date, i.list_id, l.name AS list_name
         FROM items i JOIN lists l ON l.id = i.list_id
         WHERE l.discord_id = ? AND (i.name LIKE ? ESCAPE '\\\\' OR i.description LIKE ? ESCAPE '\\\\')
         ORDER BY i.completed, l.name, i.position, i.id
         LIMIT ${SEARCH_LIMIT}`,
        [String(discordId), term, term]
    );
    return rows.map((r) => ({ ...r, completed: Boolean(r.completed), due_date: v.formatDate(r.due_date) }));
}

/**
 * Search by scope: 'lists' (default: name, category and description of quests), 'tasks' (task names and
 * descriptions) or 'all'. Always owner-scoped and bounded; the part not asked for comes back empty.
 * @returns {Promise<{ lists: object[], tasks: object[] }>}
 */
async function search(discordId, query, { scope = 'lists' } = {}) {
    if (!SEARCH_SCOPES.includes(scope)) throw errors.validation(`Search scope must be one of ${SEARCH_SCOPES.join(', ')}.`);
    if (!v.cleanText(query)) throw errors.validation('Enter something to search for.');
    const [lists, tasks] = await Promise.all([
        scope === 'tasks' ? [] : searchLists(discordId, query),
        scope === 'lists' ? [] : searchItems(discordId, query)
    ]);
    return { lists, tasks };
}

// ─── Items ───────────────────────────────────────────────────────────────────

/** Items of an owned list, or null if the list isn't the user's. */
async function getItems(discordId, listId, { sortBy = 'position', order = 'ASC' } = {}) {
    const list = await getList(discordId, listId);
    if (!list) return null;
    return run(`SELECT i.* FROM items i WHERE i.list_id = ? ORDER BY ${orderClause(ITEM_SORTS, sortBy, order, 'position')}, i.id`, [
        list.id
    ]);
}

/** One item (with its list's name/priority) if it belongs to the user. */
async function getItem(discordId, itemId) {
    const id = v.id(itemId);
    if (!id.ok) return null;
    const [row] = await run(
        `SELECT i.*, l.name AS list_name, l.priority AS list_priority
         FROM items i JOIN lists l ON l.id = i.list_id
         WHERE i.id = ? AND l.discord_id = ?`,
        [id.value, String(discordId)]
    );
    return row || null;
}

/** Validate the optional per-task fields (due date, priority, tags, repeat). */
function parseItemExtras(input, { partial = false } = {}) {
    const out = {};
    if (!partial || input.due_date !== undefined) out.due_date = unwrap(v.dueDate(input.due_date));
    if (!partial || input.priority !== undefined) out.priority = unwrap(v.priority(input.priority));
    if (!partial || input.tags !== undefined) out.tags = unwrap(v.tags(input.tags));
    if (!partial || input.recurrence !== undefined) out.recurrence = unwrap(v.recurrence(input.recurrence));
    return out;
}

/**
 * A subtask's parent must be a top-level task of the same list (one level only),
 * and a task that already has subtasks cannot itself become a subtask.
 */
async function assertValidParent(conn, listId, parentId, itemId = null) {
    if (parentId === null) return;
    if (itemId !== null && parentId === itemId) throw errors.validation('A task cannot be its own subtask.');
    const [[parent]] = await conn.query('SELECT id, parent_id FROM items WHERE id = ? AND list_id = ?', [parentId, listId]);
    if (!parent) throw errors.validation('The parent task must be in the same list.');
    if (parent.parent_id !== null) throw errors.validation('Subtasks can only be one level deep.');
    if (itemId !== null) {
        const [[kids]] = await conn.query('SELECT COUNT(*) AS n FROM items WHERE parent_id = ?', [itemId]);
        if (Number(kids.n) > 0) throw errors.validation('A task with subtasks cannot become a subtask.');
    }
}

function parseParentId(value) {
    if (value === undefined || value === null || value === '') return null;
    return unwrap(v.id(value));
}

/** Validate the fields of a new item (throws a validation error before any database work). */
function parseItemInput(listId, input) {
    return {
        lid: listId === 0 ? 0 : unwrap(v.id(listId)),
        name: unwrap(v.itemName(input.name)),
        description: unwrap(v.description(input.description)),
        extras: parseItemExtras(input),
        parentId: parseParentId(input.parent_id)
    };
}

async function addItem(discordId, listId, input) {
    const parsed = parseItemInput(listId, input);
    return withTransaction((conn) => addItemIn(conn, discordId, parsed));
}

/**
 * Break a task down: create several subtasks under an owned top-level task in one transaction
 * (all or none). Subtasks nest one level only, and each one counts as an added task for XP like
 * any other (with the usual daily cap).
 * @returns {Promise<{ parent: object, items: Array<{ item: object, xp: object, achievements: Array }> }>}
 */
async function addSubtasks(discordId, parentId, names) {
    const pid = unwrap(v.id(parentId));
    if (!Array.isArray(names) || !names.length || names.length > 20) throw errors.validation('Give between 1 and 20 subtask names.');
    const parsed = names.map((name) => parseItemInput(0, { name }));
    return withTransaction(async (conn) => {
        const [[parent]] = await conn.query(
            `SELECT i.* FROM items i JOIN lists l ON l.id = i.list_id
             WHERE i.id = ? AND l.discord_id = ? FOR UPDATE`,
            [pid, String(discordId)]
        );
        if (!parent) throw errors.notFound('Task not found.');
        if (parent.parent_id !== null) throw errors.validation('Subtasks can only be one level deep.');
        const items = [];
        for (const p of parsed) items.push(await addItemIn(conn, discordId, { ...p, lid: parent.list_id, parentId: pid }));
        return { parent, items };
    });
}

/**
 * Add several tasks to an owned list in ONE transaction (all or nothing), each one rewarded like a normal addItem.
 * @returns {Promise<Array<{ item: object, xp: object|null, achievements: object[] }>>}
 */
async function addItems(discordId, listId, inputs) {
    const parsed = inputs.map((input) => parseItemInput(listId, input));
    return withTransaction(async (conn) => {
        const out = [];
        for (const p of parsed) out.push(await addItemIn(conn, discordId, p));
        return out;
    });
}

async function addItemIn(conn, discordId, { lid, name, description, extras, parentId }) {
    const user = await lockUser(conn, discordId);
    const [[list]] = await conn.query('SELECT id FROM lists WHERE id = ? AND discord_id = ? FOR UPDATE', [lid, user.discord_id]);
    if (!list) throw errors.notFound('List not found.');
    await assertValidParent(conn, lid, parentId);

    const [[pos]] = await conn.query('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM items WHERE list_id = ?', [lid]);
    const [res] = await conn.query(
        `INSERT INTO items (list_id, name, description, position, due_date, priority, tags, recurrence, parent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [lid, name, description, Number(pos.next), extras.due_date, extras.priority, extras.tags, extras.recurrence, parentId]
    );
    await conn.query('UPDATE users SET total_items_added = total_items_added + 1 WHERE discord_id = ?', [user.discord_id]);
    user.total_items_added = Number(user.total_items_added) + 1;

    const xp = await rewardAction(conn, user, 'item_add', REWARDS.ITEM_ADD, {
        dailyLimit: LIMITS.ITEM_ADD_REWARDS_PER_DAY,
        referenceId: res.insertId
    });
    const achievements = await unlockAchievements(conn, user);
    const [[item]] = await conn.query('SELECT * FROM items WHERE id = ?', [res.insertId]);
    return { item, xp, achievements };
}

async function updateItem(discordId, itemId, input) {
    const id = unwrap(v.id(itemId));
    const fields = {};
    if (input.name !== undefined) fields.name = unwrap(v.itemName(input.name));
    if (input.description !== undefined) fields.description = unwrap(v.description(input.description));
    Object.assign(fields, parseItemExtras(input, { partial: true }));
    const parentGiven = input.parent_id !== undefined;
    if (parentGiven) fields.parent_id = parseParentId(input.parent_id);
    let position;
    if (input.position !== undefined) {
        if (!Number.isSafeInteger(input.position) || input.position < 0) throw errors.validation('Position must be a non-negative integer.');
        position = input.position;
    }
    const keys = Object.keys(fields);
    if (!keys.length && position === undefined) throw errors.validation('Nothing to update.');

    if (keys.length) {
        await withTransaction(async (conn) => {
            const [[item]] = await conn.query(
                `SELECT i.id, i.list_id FROM items i JOIN lists l ON l.id = i.list_id
                 WHERE i.id = ? AND l.discord_id = ? FOR UPDATE`,
                [id, String(discordId)]
            );
            if (!item) throw errors.notFound('Task not found.');
            if (parentGiven) await assertValidParent(conn, item.list_id, fields.parent_id, id);
            // A new due date or rule starts a new monthly anchor.
            // A new due date also re-arms the task's reminder (due-day DM and any snooze).
            let cols = keys.includes('due_date') || keys.includes('recurrence') ? [...keys, 'repeat_anchor_day'] : keys;
            if (keys.includes('due_date')) cols = [...cols, 'reminded_at', 'remind_at'];
            await conn.query(`UPDATE items SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...cols.map((k) => (k in fields ? fields[k] : null)), id]);
        });
    }
    if (position !== undefined) await moveItem(discordId, id, position);
    const item = await getItem(discordId, id);
    if (!item) throw errors.notFound('Task not found.');
    return item;
}

/** Rewrite a list's positions as 0..n-1 in the given item-id order (inside a transaction). */
async function writePositions(conn, orderedIds) {
    for (let i = 0; i < orderedIds.length; i++) {
        await conn.query('UPDATE items SET position = ? WHERE id = ?', [i, orderedIds[i]]);
    }
}

/**
 * Move one item to a 0-based position (clamped to the list) and close the gaps,
 * so positions stay unique and contiguous.
 */
async function moveItem(discordId, itemId, position) {
    const id = unwrap(v.id(itemId));
    if (!Number.isSafeInteger(position) || position < 0) throw errors.validation('Position must be a non-negative integer.');
    return withTransaction(async (conn) => {
        const [[item]] = await conn.query(
            `SELECT i.id, i.list_id FROM items i JOIN lists l ON l.id = i.list_id
             WHERE i.id = ? AND l.discord_id = ? FOR UPDATE`,
            [id, String(discordId)]
        );
        if (!item) throw errors.notFound('Task not found.');
        const [rows] = await conn.query('SELECT id FROM items WHERE list_id = ? ORDER BY position, id FOR UPDATE', [item.list_id]);
        const ids = rows.map((r) => r.id).filter((x) => x !== id);
        ids.splice(Math.min(position, ids.length), 0, id);
        await writePositions(conn, ids);
        return ids;
    });
}

/** Apply a full new order to an owned list. `orderedIds` must be exactly the list's item ids. */
async function reorderItems(discordId, listId, orderedIds) {
    const lid = unwrap(v.id(listId));
    if (!Array.isArray(orderedIds) || orderedIds.length > 5000) throw errors.validation('Provide the task ids in their new order.');
    const wanted = orderedIds.map((x) => unwrap(v.id(x)));
    return withTransaction(async (conn) => {
        const [[list]] = await conn.query('SELECT id FROM lists WHERE id = ? AND discord_id = ? FOR UPDATE', [lid, String(discordId)]);
        if (!list) throw errors.notFound('List not found.');
        const [rows] = await conn.query('SELECT id FROM items WHERE list_id = ? FOR UPDATE', [lid]);
        const have = new Set(rows.map((r) => r.id));
        if (wanted.length !== have.size || new Set(wanted).size !== wanted.length || !wanted.every((x) => have.has(x))) {
            throw errors.validation('The order must list every task in this list exactly once.');
        }
        await writePositions(conn, wanted);
        return wanted;
    });
}

async function deleteItem(discordId, itemId) {
    const id = unwrap(v.id(itemId));
    const [res] = await getPool().query(
        'DELETE i FROM items i JOIN lists l ON l.id = i.list_id WHERE i.id = ? AND l.discord_id = ?',
        [id, String(discordId)]
    );
    if (!res.affectedRows) throw errors.notFound('Task not found.');
    return true;
}

/**
 * Create the next copy of a repeating task. It runs only on the first completion
 * (the xp_awarded guard), so un-checking and re-checking cannot duplicate it, and it
 * grants no creation XP or counters and never counts towards quests (counts_for_quests = 0),
 * so repeating tasks cannot be used to farm.
 */
async function spawnNextOccurrence(conn, item, user, habitStreak = 0) {
    const today = todayInZone(user.timezone);
    const base = item.due_date ? String(item.due_date).slice(0, 10) : today;
    const anchor = item.recurrence === 'monthly' ? item.repeat_anchor_day || Number(base.slice(8, 10)) : null;
    const due = nextDueOnOrAfter(base, item.recurrence, today, anchor);
    if (!due) return null;
    const [[pos]] = await conn.query('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM items WHERE list_id = ?', [item.list_id]);
    const [res] = await conn.query(
        `INSERT INTO items (list_id, name, description, position, due_date, priority, tags, recurrence, parent_id, repeat_anchor_day, counts_for_quests, habit_streak)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [item.list_id, item.name, item.description, Number(pos.next), due, item.priority, item.tags, item.recurrence, item.parent_id, anchor, habitStreak]
    );
    const [[created]] = await conn.query('SELECT * FROM items WHERE id = ?', [res.insertId]);
    return created;
}

/**
 * What class and skill rules may look at when a task is completed: its priority, whether it
 * repeats, its due date and how overdue it was (in the user's own time zone), and whether this
 * completion emptied a list of at least three tasks. Call after the item row is marked completed.
 */
async function completionContext(conn, item, user) {
    const today = todayInZone(user.timezone);
    const dueDate = item.due_date ? String(item.due_date).slice(0, 10) : null;
    const [[counts]] = await conn.query(
        'SELECT COUNT(*) AS total, COALESCE(SUM(completed = 0), 0) AS open FROM items WHERE list_id = ? AND parent_id IS NULL',
        [item.list_id]
    );
    return {
        priority: item.priority || item.list_priority,
        recurring: Boolean(item.recurrence),
        today,
        dueDate,
        overdueDays: dueDate ? Math.max(0, daysBetween(dueDate, today)) : 0,
        listCleared: !item.recurrence && !item.parent_id && Number(counts.total) >= 3 && Number(counts.open) === 0
    };
}

/**
 * Bonus XP on top of a task's first (paid) completion: first of the day, list cleared, early finish,
 * overdue cleared and all subtasks done. Each is flat, has its own cap, and is paid at most once per
 * thing it rewards, so un-checking, re-checking, re-clearing a list or backdating cannot farm it.
 * Imported tasks and auto-spawned recurring copies (counts_for_quests = 0) earn none.
 * @returns {Promise<Array<{ key: string, label: string, xp: number }>>}
 */
async function completionBonuses(conn, user, item, ctx) {
    if (!Number(item.counts_for_quests)) return [];
    const out = [];
    const pay = async (key, amount, opts = {}) => {
        const r = await awardFlat(conn, user, key, amount, opts);
        if (r) out.push({ key, label: BONUS_LABELS[key], xp: r.xp });
        return r;
    };

    if ((await countToday(conn, user, 'first_of_day')) === 0) await pay('first_of_day', REWARDS.FIRST_OF_DAY, { referenceId: item.id });

    if (ctx.listCleared) {
        // Marking the list first makes the payout once per list; the daily limit still applies on top.
        const [mark] = await conn.query('UPDATE lists SET cleared_at = ?, updated_at = updated_at WHERE id = ? AND cleared_at IS NULL', [new Date(), item.list_id]);
        if (mark.affectedRows === 1 && (await countToday(conn, user, 'list_cleared')) < LIMITS.LIST_CLEARED_PER_DAY) {
            await pay('list_cleared', REWARDS.LIST_CLEARED, { referenceId: item.list_id });
        }
    }

    const deadlineCap = { dailyCap: LIMITS.DEADLINE_BONUS_XP_PER_DAY, capSources: ['early_finish', 'overdue_clear'], referenceId: item.id };
    if (ctx.dueDate && ctx.dueDate > ctx.today) {
        const early = Math.min(LIMITS.EARLY_FINISH_MAX, REWARDS.EARLY_FINISH_PER_DAY * daysBetween(ctx.today, ctx.dueDate));
        await pay('early_finish', early, deadlineCap);
    } else if (ctx.overdueDays > 0) {
        await pay('overdue_clear', REWARDS.OVERDUE_CLEAR, deadlineCap);
    }

    if (item.parent_id) {
        const [[open]] = await conn.query('SELECT COUNT(*) AS n FROM items WHERE parent_id = ? AND completed = 0', [item.parent_id]);
        const [[done]] = await conn.query("SELECT COUNT(*) AS n FROM xp_transactions WHERE discord_id = ? AND source = 'subtasks_done' AND reference_id = ?", [user.discord_id, item.parent_id]);
        if (Number(open.n) === 0 && Number(done.n) === 0) {
            await pay('subtasks_done', REWARDS.SUBTASKS_DONE, { dailyCap: LIMITS.SUBTASKS_DONE_XP_PER_DAY, referenceId: item.parent_id });
        }
    }
    return out;
}

/**
 * What finishing a repeating task now does to its habit streak. Late resets it; finishing on or before
 * the due date adds one, unless it is a whole period early (a copy finished the moment it spawns),
 * which neither adds nor resets, so ticking copies off ahead of time cannot grow a streak.
 * @returns {{ streak: number, counted: boolean }}
 */
function habitOutcome(item, ctx) {
    const streak = Number(item.habit_streak) || 0;
    if (ctx.dueDate && ctx.dueDate < ctx.today) return { streak: 0, counted: false };
    const early = ctx.dueDate ? daysBetween(ctx.today, ctx.dueDate) : 0;
    if (early >= (HABIT_PERIOD_DAYS[item.recurrence] || 1)) return { streak, counted: false };
    return { streak: streak + 1, counted: true };
}

/**
 * Mark an item complete/incomplete (toggle when `completed` is undefined).
 * Completion XP and the completion counter are granted only the first time
 * an item is ever completed, so toggling cannot farm XP.
 */
async function setItemCompleted(discordId, itemId, completed) {
    const id = unwrap(v.id(itemId));
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        const [[item]] = await conn.query(
            `SELECT i.*, l.priority AS list_priority FROM items i JOIN lists l ON l.id = i.list_id
             WHERE i.id = ? AND l.discord_id = ? FOR UPDATE`,
            [id, user.discord_id]
        );
        if (!item) throw errors.notFound('Task not found.');

        const target = completed === undefined ? !item.completed : Boolean(completed);
        const now = new Date();
        await conn.query('UPDATE items SET completed = ?, completed_at = ? WHERE id = ?', [target ? 1 : 0, target ? now : null, id]);

        let xp = null;
        let achievements = [];
        let nextItem = null;
        let bonuses = [];
        if (target && !item.xp_awarded) {
            // first_completed_* is what quests count: set once, never rewritten by a re-check or a later priority edit.
            const dueOn = item.due_date ? String(item.due_date).slice(0, 10) : null;
            const todayLocal = todayInZone(user.timezone);
            await conn.query(
                `UPDATE items SET xp_awarded = TRUE, first_completed_at = ?, first_completed_high = ?,
                        first_completed_early = ?, first_completed_overdue = ? WHERE id = ?`,
                [now, (item.priority || item.list_priority) === 'HIGH' ? 1 : 0, dueOn ? (dueOn > todayLocal ? 1 : 0) : null, dueOn ? (dueOn < todayLocal ? 1 : 0) : null, id]
            );
            await conn.query('UPDATE users SET total_items_completed = total_items_completed + 1 WHERE discord_id = ?', [user.discord_id]);
            user.total_items_completed = Number(user.total_items_completed) + 1;
            const ctx = await completionContext(conn, item, user);
            xp = await rewardAction(conn, user, 'item_complete', REWARDS.ITEM_COMPLETE, {
                context: ctx,
                dailyLimit: LIMITS.ITEM_COMPLETE_REWARDS_PER_DAY,
                referenceId: id
            });
            // Bonuses ride on a completion that was actually paid, so the daily completion cap bounds them too.
            if (xp && xp.finalXP > 0) bonuses = await completionBonuses(conn, user, item, ctx);
            let habit = { streak: 0, counted: false };
            if (item.recurrence) {
                habit = habitOutcome(item, ctx);
                if (xp && xp.finalXP > 0 && habit.counted && Number(item.habit_streak) >= REWARDS.HABIT_MIN_STREAK) {
                    const amount = Math.min(LIMITS.HABIT_MAX, REWARDS.HABIT_PER_STREAK * Number(item.habit_streak));
                    const paid = await awardFlat(conn, user, 'habit_bonus', amount, { dailyCap: LIMITS.HABIT_XP_PER_DAY, referenceId: id });
                    if (paid) bonuses.push({ key: 'habit_bonus', label: BONUS_LABELS.habit_bonus, xp: paid.xp });
                }
            }
            achievements = await unlockAchievements(conn, user);
            if (item.recurrence) nextItem = await spawnNextOccurrence(conn, item, user, habit.streak);
        }
        const [[updated]] = await conn.query('SELECT * FROM items WHERE id = ?', [id]);
        return { item: updated, completed: target, xp, bonuses, achievements, nextItem, firstCompletion: Boolean(target && !item.xp_awarded) };
    });
}

/** Swap two items of the same owned list (works even on legacy lists with duplicate positions). */
async function swapItemPositions(discordId, itemIdA, itemIdB) {
    const a = unwrap(v.id(itemIdA));
    const b = unwrap(v.id(itemIdB));
    return withTransaction(async (conn) => {
        const [rows] = await conn.query(
            `SELECT i.id, i.list_id FROM items i JOIN lists l ON l.id = i.list_id
             WHERE i.id IN (?, ?) AND l.discord_id = ? FOR UPDATE`,
            [a, b, String(discordId)]
        );
        if (rows.length !== 2 || rows[0].list_id !== rows[1].list_id) throw errors.notFound('Tasks not found.');
        const [all] = await conn.query('SELECT id FROM items WHERE list_id = ? ORDER BY position, id FOR UPDATE', [rows[0].list_id]);
        const ids = all.map((r) => r.id);
        const [ia, ib] = [ids.indexOf(a), ids.indexOf(b)];
        [ids[ia], ids[ib]] = [ids[ib], ids[ia]];
        await writePositions(conn, ids);
        return true;
    });
}

// ─── Automation (bot background jobs) ─────────────────────────────────────────

/** Lists due on `date` (YYYY-MM-DD) whose owners have automation on. */
async function getListsDueOn(date) {
    return run(
        `SELECT l.* FROM lists l JOIN users u ON u.discord_id = l.discord_id
         WHERE l.deadline = ? AND l.deadline_notified = FALSE AND u.automation_enabled = TRUE`,
        [date]
    );
}

/**
 * Lists that might need a reminder right now, with their owner's time zone and
 * reminder hour. This is a deliberately wide net (a day either side covers every
 * time zone); the bot decides per user, in their own local time, what to send.
 *   - snoozed lists whose snooze has ended
 *   - lists due in the next day or the last 14 days that still owe a due or overdue notice
 */
async function getReminderCandidates(now = new Date()) {
    const day = (offset) => {
        const d = new Date(now.getTime() + offset * 86400e3);
        return d.toISOString().slice(0, 10);
    };
    return run(
        `SELECT l.*, u.timezone, u.reminder_hour,
                (SELECT COUNT(*) FROM items i WHERE i.list_id = l.id) AS items_total,
                (SELECT COALESCE(SUM(i.completed), 0) FROM items i WHERE i.list_id = l.id) AS items_done
         FROM lists l JOIN users u ON u.discord_id = l.discord_id
         WHERE u.automation_enabled = TRUE AND (
             (l.remind_at IS NOT NULL AND l.remind_at <= ?)
             OR (l.deadline IS NOT NULL AND l.deadline >= ? AND l.deadline <= ?
                 AND (l.deadline_notified = FALSE OR l.overdue_notified = FALSE))
         )`,
        [now, day(-14), day(1)]
    ).then((rows) => rows.map((r) => ({ ...r, items_total: Number(r.items_total), items_done: Number(r.items_done) })));
}

/**
 * Record that a reminder went out. `kind`: 'due' | 'overdue' | 'snooze'. Keeps updated_at: it is not an edit.
 * `late`: the deadline day is over; `pastDeadline`: the deadline is today or earlier.
 */
async function markReminderSent(listId, kind, { late = false, pastDeadline = late } = {}) {
    const sets = {
        due: late ? 'deadline_notified = TRUE, overdue_notified = TRUE' : 'deadline_notified = TRUE',
        overdue: 'deadline_notified = TRUE, overdue_notified = TRUE',
        // A snooze that fires on/after the deadline counts as the due (and, once the day is over,
        // the overdue) notice, so another DM does not follow within the hour.
        snooze: late
            ? 'remind_at = NULL, deadline_notified = TRUE, overdue_notified = TRUE'
            : pastDeadline
              ? 'remind_at = NULL, deadline_notified = TRUE'
              : 'remind_at = NULL'
    }[kind];
    if (!sets) throw new Error(`Unknown reminder kind ${kind}`);
    await run(`UPDATE lists SET ${sets}, updated_at = updated_at WHERE id = ?`, [listId]);
}

/** Remind the owner about a list again at `until`. */
async function snoozeList(discordId, listId, until) {
    const id = unwrap(v.id(listId));
    const [res] = await getPool().query('UPDATE lists SET remind_at = ?, updated_at = updated_at WHERE id = ? AND discord_id = ?', [
        until,
        id,
        String(discordId)
    ]);
    if (!res.affectedRows) throw errors.notFound('List not found.');
    return true;
}

/**
 * Open tasks with their own due date that might need a reminder right now, with the
 * owner's time zone and reminder hour (a wide net; the bot decides in local time).
 * A task due on the same day as its list's deadline is left to the list reminder.
 *   - snoozed tasks whose snooze has ended
 *   - tasks due in the next day or the last 14 days that have not been reminded yet
 */
async function getTaskReminderCandidates(now = new Date()) {
    const day = (offset) => new Date(now.getTime() + offset * 86400e3).toISOString().slice(0, 10);
    return run(
        `SELECT i.id, i.name, i.list_id, i.due_date, i.priority, i.remind_at, i.reminded_at, i.parent_id,
                l.name AS list_name, l.discord_id, u.timezone, u.reminder_hour
         FROM items i JOIN lists l ON l.id = i.list_id JOIN users u ON u.discord_id = l.discord_id
         WHERE u.automation_enabled = TRUE AND i.completed = FALSE AND i.due_date IS NOT NULL AND (
             (i.remind_at IS NOT NULL AND i.remind_at <= ?)
             OR (i.reminded_at IS NULL AND i.remind_at IS NULL AND i.due_date >= ? AND i.due_date <= ?
                 AND (l.deadline IS NULL OR l.deadline <> i.due_date))
         )`,
        [now, day(-14), day(1)]
    );
}

/** Record that a task's reminder went out (also ends a snooze). */
async function markTaskReminderSent(itemId, now = new Date()) {
    await run('UPDATE items SET reminded_at = ?, remind_at = NULL WHERE id = ?', [now, itemId]);
}

/** Remind the owner about a task again at `until`. */
async function snoozeTask(discordId, itemId, until) {
    const id = unwrap(v.id(itemId));
    const [res] = await getPool().query('UPDATE items i JOIN lists l ON l.id = i.list_id SET i.remind_at = ? WHERE i.id = ? AND l.discord_id = ?', [
        until,
        id,
        String(discordId)
    ]);
    if (!res.affectedRows) throw errors.notFound('Task not found.');
    return true;
}

async function markDeadlineNotified(listId) {
    // Keep updated_at: a reminder being sent is not an edit of the list.
    await run('UPDATE lists SET deadline_notified = TRUE, updated_at = updated_at WHERE id = ?', [listId]);
}

/**
 * Delete lists for users with auto_delete_old_lists on once every item is completed
 * and the last change was 5+ days ago. Unfinished lists are never deleted, even when
 * their deadline is long gone: they stay visible as overdue.
 * @returns {Promise<Array<{ id: number, discord_id: string }>>} the lists that were deleted
 */
async function cleanupOldLists(days = 5, { onCandidates } = {}) {
    const eligible = `u.auto_delete_old_lists = TRUE
         AND s.total > 0 AND s.done = s.total AND s.last_change < (UTC_TIMESTAMP() - INTERVAL ? DAY)`;
    const from = `FROM lists l
         JOIN users u ON u.discord_id = l.discord_id
         LEFT JOIN (
             SELECT list_id, COUNT(*) AS total, SUM(completed) AS done, MAX(updated_at) AS last_change
             FROM items GROUP BY list_id
         ) s ON s.list_id = l.id`;
    const [candidates] = await getPool().query(`SELECT l.id ${from} WHERE ${eligible}`, [days]);
    if (onCandidates) await onCandidates(candidates); // test hook: lets a test race a write in here
    const deleted = [];
    for (const { id } of candidates) {
        // Lock the list, then re-check the whole predicate inside the same transaction: a task
        // added (or un-checked) since the SELECT blocks the delete instead of losing the list.
        await withTransaction(async (conn) => {
            const [[list]] = await conn.query('SELECT id, discord_id FROM lists WHERE id = ? FOR UPDATE', [id]);
            if (!list) return;
            await conn.query('SELECT id FROM items WHERE list_id = ? FOR UPDATE', [id]);
            const [[still]] = await conn.query(`SELECT l.id ${from} WHERE l.id = ? AND ${eligible}`, [id, days]);
            if (!still) return;
            await conn.query('DELETE FROM lists WHERE id = ?', [id]);
            deleted.push({ id: Number(list.id), discord_id: String(list.discord_id) });
        });
    }
    return deleted;
}

module.exports = {
    getLists,
    getList,
    getListByName,
    createList,
    createListWithItems,
    updateList,
    deleteList,
    searchLists,
    searchItems,
    search,
    SEARCH_LIMIT,
    getItems,
    getItem,
    addItem,
    addItems,
    addSubtasks,
    updateItem,
    deleteItem,
    setItemCompleted,
    swapItemPositions,
    moveItem,
    reorderItems,
    getListsDueOn,
    getReminderCandidates,
    markReminderSent,
    snoozeList,
    getTaskReminderCandidates,
    markTaskReminderSent,
    snoozeTask,
    markDeadlineNotified,
    cleanupOldLists
};
