/**
 * Lists and items. Every function takes the acting user's Discord ID and
 * only ever touches rows that belong to that user — ownership is part of
 * each SQL statement, never a separate check that could be forgotten.
 */

'use strict';

const { getPool, withTransaction } = require('./pool');
const { lockUser } = require('./users');
const { rewardAction, unlockAchievements } = require('./progression');
const { errors } = require('../errors');
const { REWARDS, LIMITS } = require('../constants');
const v = require('../validation');

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
    return withTransaction(async (conn) => {
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
    });
}

async function updateList(discordId, listId, input) {
    const id = unwrap(v.id(listId));
    const fields = parseListInput(input, { partial: true });
    const keys = Object.keys(fields);
    if (!keys.length) throw errors.validation('Nothing to update.');
    if (keys.includes('deadline')) {
        fields.deadline_notified = 0;
        keys.push('deadline_notified');
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

async function searchLists(discordId, query) {
    const term = `%${v.escapeLike(v.cleanText(query).slice(0, 100))}%`;
    return run(
        `SELECT * FROM lists WHERE discord_id = ?
           AND (name LIKE ? ESCAPE '\\\\' OR category LIKE ? ESCAPE '\\\\' OR description LIKE ? ESCAPE '\\\\')
         ORDER BY name`,
        [String(discordId), term, term, term]
    );
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

async function addItem(discordId, listId, input) {
    const lid = unwrap(v.id(listId));
    const name = unwrap(v.itemName(input.name));
    const description = unwrap(v.description(input.description));

    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        const [[list]] = await conn.query('SELECT id FROM lists WHERE id = ? AND discord_id = ? FOR UPDATE', [lid, user.discord_id]);
        if (!list) throw errors.notFound('List not found.');

        const [[pos]] = await conn.query('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM items WHERE list_id = ?', [lid]);
        const [res] = await conn.query('INSERT INTO items (list_id, name, description, position) VALUES (?, ?, ?, ?)', [
            lid,
            name,
            description,
            Number(pos.next)
        ]);
        await conn.query('UPDATE users SET total_items_added = total_items_added + 1 WHERE discord_id = ?', [user.discord_id]);
        user.total_items_added = Number(user.total_items_added) + 1;

        const xp = await rewardAction(conn, user, 'item_add', REWARDS.ITEM_ADD, {
            dailyLimit: LIMITS.ITEM_ADD_REWARDS_PER_DAY,
            referenceId: res.insertId
        });
        const achievements = await unlockAchievements(conn, user);
        const [[item]] = await conn.query('SELECT * FROM items WHERE id = ?', [res.insertId]);
        return { item, xp, achievements };
    });
}

async function updateItem(discordId, itemId, input) {
    const id = unwrap(v.id(itemId));
    const fields = {};
    if (input.name !== undefined) fields.name = unwrap(v.itemName(input.name));
    if (input.description !== undefined) fields.description = unwrap(v.description(input.description));
    if (input.position !== undefined) {
        if (!Number.isSafeInteger(input.position) || input.position < 0) throw errors.validation('Position must be a non-negative integer.');
        fields.position = input.position;
    }
    const keys = Object.keys(fields);
    if (!keys.length) throw errors.validation('Nothing to update.');

    const [res] = await getPool().query(
        `UPDATE items i JOIN lists l ON l.id = i.list_id
         SET ${keys.map((k) => `i.${k} = ?`).join(', ')}
         WHERE i.id = ? AND l.discord_id = ?`,
        [...keys.map((k) => fields[k]), id, String(discordId)]
    );
    if (!res.affectedRows) throw errors.notFound('Task not found.');
    return getItem(discordId, id);
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
        await conn.query('UPDATE items SET completed = ?, completed_at = ? WHERE id = ?', [target ? 1 : 0, target ? new Date() : null, id]);

        let xp = null;
        let achievements = [];
        if (target && !item.xp_awarded) {
            await conn.query('UPDATE items SET xp_awarded = TRUE WHERE id = ?', [id]);
            await conn.query('UPDATE users SET total_items_completed = total_items_completed + 1 WHERE discord_id = ?', [user.discord_id]);
            user.total_items_completed = Number(user.total_items_completed) + 1;
            xp = await rewardAction(conn, user, 'item_complete', REWARDS.ITEM_COMPLETE, {
                context: { priority: item.list_priority },
                referenceId: id
            });
            achievements = await unlockAchievements(conn, user);
        }
        const [[updated]] = await conn.query('SELECT * FROM items WHERE id = ?', [id]);
        return { item: updated, completed: target, xp, achievements, firstCompletion: Boolean(target && !item.xp_awarded) };
    });
}

/** Swap the positions of two items in the same owned list. */
async function swapItemPositions(discordId, itemIdA, itemIdB) {
    const a = unwrap(v.id(itemIdA));
    const b = unwrap(v.id(itemIdB));
    return withTransaction(async (conn) => {
        const [rows] = await conn.query(
            `SELECT i.id, i.position, i.list_id FROM items i JOIN lists l ON l.id = i.list_id
             WHERE i.id IN (?, ?) AND l.discord_id = ? FOR UPDATE`,
            [a, b, String(discordId)]
        );
        if (rows.length !== 2 || rows[0].list_id !== rows[1].list_id) throw errors.notFound('Tasks not found.');
        await conn.query('UPDATE items SET position = ? WHERE id = ?', [rows[1].position, rows[0].id]);
        await conn.query('UPDATE items SET position = ? WHERE id = ?', [rows[0].position, rows[1].id]);
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

async function markDeadlineNotified(listId) {
    await run('UPDATE lists SET deadline_notified = TRUE WHERE id = ?', [listId]);
}

/**
 * Delete lists for users with auto_delete_old_lists on when either
 *   - every item is completed and the last change was 5+ days ago, or
 *   - the deadline passed 5+ days ago and work is still unfinished.
 * @returns {Promise<number>} number of deleted lists
 */
async function cleanupOldLists(days = 5) {
    const [res] = await getPool().query(
        `DELETE l FROM lists l
         JOIN users u ON u.discord_id = l.discord_id
         LEFT JOIN (
             SELECT list_id, COUNT(*) AS total, SUM(completed) AS done, MAX(updated_at) AS last_change
             FROM items GROUP BY list_id
         ) s ON s.list_id = l.id
         WHERE u.auto_delete_old_lists = TRUE AND (
             (s.total > 0 AND s.done = s.total AND s.last_change < (UTC_TIMESTAMP() - INTERVAL ? DAY))
             OR (l.deadline IS NOT NULL AND l.deadline <= (UTC_DATE() - INTERVAL ? DAY)
                 AND (s.total IS NULL OR s.done < s.total))
         )`,
        [days, days]
    );
    return res.affectedRows;
}

module.exports = {
    getLists,
    getList,
    getListByName,
    createList,
    updateList,
    deleteList,
    searchLists,
    getItems,
    getItem,
    addItem,
    updateItem,
    deleteItem,
    setItemCompleted,
    swapItemPositions,
    getListsDueOn,
    markDeadlineNotified,
    cleanupOldLists
};
