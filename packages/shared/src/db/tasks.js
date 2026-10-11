/**
 * Lists and items. Every function takes the acting user's Discord ID and only ever touches lists that user
 * owns or has been given a role on. That rule lives in ./access (forList, forItem, accessSql): nothing in
 * this file decides ownership on its own, so a stranger gets NOT_FOUND from every function here.
 *
 * XP, daily caps, quests and stats belong to the ACTOR (the person who adds or completes a task), never to the list's owner.
 * Items record who created them, who completed them and who completed them first (see migration 018).
 */

'use strict';

const { getPool, withTransaction } = require('./pool');
const { lockUser } = require('./users');
const { rewardAction, unlockAchievements, awardFlat, countToday } = require('./progression');
const { errors } = require('../errors');
const { REWARDS, LIMITS, BONUS_LABELS, HABIT_PERIOD_DAYS } = require('../constants');
const v = require('../validation');
const { nextDueOnOrAfter, todayInZone, daysBetween } = require('../dates');
const access = require('./access');

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

/** Columns that hold other people's Discord IDs never leave this module. */
const HIDDEN_ITEM_COLUMNS = ['created_by', 'completed_by', 'first_completed_by'];

function shapeItem(row) {
    if (!row) return row;
    const out = { ...row };
    for (const c of HIDDEN_ITEM_COLUMNS) delete out[c];
    return out;
}

/** A list row as the caller may see it: no internal marker, and no owner ID unless the caller is the owner. */
function shapeList(row, me) {
    if (!row) return row;
    const { cleared_by: clearedBy, owner_id: ownerId, member_role: memberRole, ...out } = row; // eslint-disable-line no-unused-vars
    if (String(out.discord_id) !== String(me)) delete out.discord_id;
    return out;
}

/**
 * The columns that describe how a list is shared with `me`. The owner is an implicit manager; member_count
 * counts people (the owner plus members). owner_name is a display name only.
 */
const SHARE_COLUMNS = `IF(l.discord_id = ?, 'manager', me.role) AS role,
        (l.discord_id = ?) AS is_owner,
        ou.discord_username AS owner_name,
        1 + (SELECT COUNT(*) FROM list_members cm WHERE cm.list_id = l.id) AS member_count`;
const SHARE_JOINS = `LEFT JOIN list_members me ON me.list_id = l.id AND me.discord_id = ?
         JOIN users ou ON ou.discord_id = l.discord_id`;

function shareFields(row) {
    const memberCount = Number(row.member_count);
    return { ...row, is_owner: Boolean(Number(row.is_owner)), member_count: memberCount, shared: memberCount > 1 };
}

/** Lists the user owns plus lists shared with them, with item counts and how each is shared, in one query. */
async function getLists(discordId, { sortBy = 'created_at', order = 'DESC' } = {}) {
    const me = String(discordId);
    const acc = access.accessSql('l', me);
    const rows = await run(
        `SELECT l.*, COUNT(i.id) AS items_total, COALESCE(SUM(i.completed), 0) AS items_completed, ${SHARE_COLUMNS}
         FROM lists l LEFT JOIN items i ON i.list_id = l.id
         ${SHARE_JOINS}
         WHERE ${acc.sql}
         GROUP BY l.id, me.role, ou.discord_username
         ORDER BY ${orderClause(LIST_SORTS, sortBy, order, 'created_at')}`,
        [me, me, me, ...acc.params]
    );
    return rows.map((r) => shapeList({ ...shareFields(r), items_total: Number(r.items_total), items_completed: Number(r.items_completed) }, me));
}

/** One list the user owns or is a member of (with how it is shared), or null. */
async function getList(discordId, listId) {
    const id = v.id(listId);
    if (!id.ok) return null;
    const me = String(discordId);
    const acc = access.accessSql('l', me);
    const [row] = await run(`SELECT l.*, ${SHARE_COLUMNS} FROM lists l ${SHARE_JOINS} WHERE l.id = ? AND ${acc.sql}`, [me, me, me, id.value, ...acc.params]);
    return row ? shapeList(shareFields(row), me) : null;
}

/** A list by name: the user's own list first, then one shared with them (the oldest share if several have that name). */
async function getListByName(discordId, name) {
    const me = String(discordId);
    const acc = access.accessSql('l', me);
    const [row] = await run(`SELECT l.id FROM lists l WHERE l.name = ? AND ${acc.sql} ORDER BY (l.discord_id = ?) DESC, l.id LIMIT 1`, [String(name), ...acc.params, me]);
    return row ? getList(me, row.id) : null;
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
    const [[lists]] = await conn.query('SELECT COUNT(*) AS n FROM lists WHERE discord_id = ?', [user.discord_id]);
    if (Number(lists.n) >= LIMITS.MAX_LISTS_PER_USER) throw errors.validation(`You can have at most ${LIMITS.MAX_LISTS_PER_USER} lists. Delete one first.`);
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
    return { list: shapeList(list, user.discord_id), xp, achievements };
}

/**
 * Whether a changed date may re-arm reminders now, for a list or item row carrying rearm_count / rearm_day. Returns the new counter
 * columns to write (the day's count goes up by one) or null when it may not (the date did not change, or it already re-armed
 * LIMITS.REMINDER_REARMS_PER_DAY times today, UTC).
 */
function rearmAllowed(row, dateChanged, now = new Date()) {
    if (!dateChanged) return null;
    const today = now.toISOString().slice(0, 10);
    const used = String(row.rearm_day || '').slice(0, 10) === today ? Number(row.rearm_count) || 0 : 0;
    if (used >= LIMITS.REMINDER_REARMS_PER_DAY) return null;
    return { rearm_count: used + 1, rearm_day: today };
}

async function updateList(discordId, listId, input) {
    const id = unwrap(v.id(listId));
    const fields = parseListInput(input, { partial: true });
    const keys = Object.keys(fields);
    if (!keys.length) throw errors.validation('Nothing to update.');
    try {
        await withTransaction(async (conn) => {
            const { list } = await access.forList(conn, discordId, id, 'manager', { lock: true });
            // A deadline that really changed re-arms every reminder (due, overdue and any snooze), the owner's and every member's, but at
            // most REMINDER_REARMS_PER_DAY times a day: an edit that keeps the date, or the fourth change today, leaves them alone.
            const rearm = keys.includes('deadline') && rearmAllowed(list, String(list.deadline || '').slice(0, 10) !== (fields.deadline || ''));
            const sets = { ...fields, ...(rearm ? { deadline_notified: 0, overdue_notified: 0, remind_at: null, ...rearm } : {}) };
            const cols = Object.keys(sets);
            await conn.query(`UPDATE lists SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...cols.map((k) => sets[k]), id]);
            if (rearm) await conn.query('DELETE FROM list_reminders WHERE list_id = ?', [id]);
        });
    } catch (err) {
        if (isDuplicate(err)) throw errors.conflict(`A list called "${fields.name}" already exists.`);
        throw err;
    }
    return getList(discordId, id);
}

/** Delete a list and everything on it. Only the owner can: a manager may edit and invite, not destroy. */
async function deleteList(discordId, listId) {
    const id = unwrap(v.id(listId));
    await withTransaction(async (conn) => {
        const { isOwner } = await access.forList(conn, discordId, id, 'viewer', { lock: true });
        if (!isOwner) throw errors.forbidden('Only the owner can delete this list. You can leave it instead.');
        await conn.query('DELETE FROM lists WHERE id = ?', [id]);
    });
    return true;
}

const SEARCH_LIMIT = 50;
const SEARCH_SCOPES = ['lists', 'tasks', 'all'];

/** A LIKE pattern that matches the (trimmed, length-capped) query literally, % and _ included. */
const likeTerm = (query) => `%${v.escapeLike(v.cleanText(query).slice(0, 100))}%`;

async function searchLists(discordId, query) {
    const term = likeTerm(query);
    const acc = access.accessSql('l', discordId);
    const rows = await run(
        `SELECT l.* FROM lists l WHERE ${acc.sql}
           AND (l.name LIKE ? ESCAPE '\\\\' OR l.category LIKE ? ESCAPE '\\\\' OR l.description LIKE ? ESCAPE '\\\\')
         ORDER BY l.name
         LIMIT ${SEARCH_LIMIT * 2}`,
        [...acc.params, term, term, term]
    );
    return rows.map((r) => shapeList(r, discordId));
}

/** Tasks (name or description) of the user's lists, each with its quest, at most SEARCH_LIMIT. */
async function searchItems(discordId, query) {
    const term = likeTerm(query);
    const acc = access.accessSql('l', discordId);
    const rows = await run(
        `SELECT i.id, i.name, i.description, i.completed, i.parent_id, i.due_date, i.list_id, l.name AS list_name
         FROM items i JOIN lists l ON l.id = i.list_id
         WHERE ${acc.sql} AND (i.name LIKE ? ESCAPE '\\\\' OR i.description LIKE ? ESCAPE '\\\\')
         ORDER BY i.completed, l.name, i.position, i.id
         LIMIT ${SEARCH_LIMIT}`,
        [...acc.params, term, term]
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
    // On a shared list each task also says who finished it (a display name, never an ID).
    const names = list.shared ? ', cu.discord_username AS completed_by_name' : '';
    const join = list.shared ? 'LEFT JOIN users cu ON cu.discord_id = i.completed_by' : '';
    const rows = await run(`SELECT i.*${names} FROM items i ${join} WHERE i.list_id = ? ORDER BY ${orderClause(ITEM_SORTS, sortBy, order, 'position')}, i.id`, [list.id]);
    return rows.map(shapeItem);
}

/** One item (with its list's name/priority) if it is on a list the user owns or is a member of. */
async function getItem(discordId, itemId) {
    try {
        return shapeItem((await access.forItem(getPool(), discordId, itemId)).item);
    } catch (err) {
        if (err.code === 'NOT_FOUND') return null;
        throw err;
    }
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
 * Break a task down: create several subtasks under a top-level task of a list the user can edit, in one transaction
 * (all or none). Subtasks nest one level only, and each one counts as an added task for XP like
 * any other (with the usual daily cap).
 * @returns {Promise<{ parent: object, items: Array<{ item: object, xp: object, achievements: Array }> }>}
 */
async function addSubtasks(discordId, parentId, names) {
    const pid = unwrap(v.id(parentId));
    if (!Array.isArray(names) || !names.length || names.length > 20) throw errors.validation('Give between 1 and 20 subtask names.');
    const parsed = names.map((name) => parseItemInput(0, { name }));
    return withTransaction(async (conn) => {
        // Lock order is the user row first, then list and item rows (as addItemIn and setItemCompleted do), or two requests deadlock.
        await lockUser(conn, discordId);
        const { item: parent } = await access.forItem(conn, discordId, pid, 'editor', { lock: true });
        if (parent.parent_id !== null) throw errors.validation('Subtasks can only be one level deep.');
        const items = [];
        for (const p of parsed) items.push(await addItemIn(conn, discordId, { ...p, lid: parent.list_id, parentId: pid }));
        return { parent: shapeItem(parent), items };
    });
}

/**
 * Add several tasks to a list the user can edit in ONE transaction (all or nothing), each one rewarded like a normal addItem.
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
    const { list } = await access.forList(conn, user.discord_id, lid, 'editor', { lock: true });
    // The quota is the list OWNER's: a member adding to a shared list grows the owner's data. (Repeat copies from
    // spawnNextOccurrence are not counted against it: each one replaces the task just completed.)
    const [[owned]] = await conn.query('SELECT COUNT(*) AS n FROM items i JOIN lists l ON l.id = i.list_id WHERE l.discord_id = ?', [list.discord_id]);
    if (Number(owned.n) >= LIMITS.MAX_ITEMS_PER_USER) {
        throw errors.validation(`That quest's owner is at the limit of ${LIMITS.MAX_ITEMS_PER_USER} tasks. Delete some first.`);
    }
    await assertValidParent(conn, lid, parentId);

    const [[pos]] = await conn.query('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM items WHERE list_id = ?', [lid]);
    const [res] = await conn.query(
        `INSERT INTO items (list_id, name, description, position, due_date, due_date_set_at, priority, tags, recurrence, parent_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [lid, name, description, Number(pos.next), extras.due_date, extras.due_date ? new Date() : null, extras.priority, extras.tags, extras.recurrence, parentId, user.discord_id]
    );
    await conn.query('UPDATE users SET total_items_added = total_items_added + 1 WHERE discord_id = ?', [user.discord_id]);
    user.total_items_added = Number(user.total_items_added) + 1;

    const xp = await rewardAction(conn, user, 'item_add', REWARDS.ITEM_ADD, {
        dailyLimit: LIMITS.ITEM_ADD_REWARDS_PER_DAY,
        referenceId: res.insertId
    });
    const achievements = await unlockAchievements(conn, user);
    const [[item]] = await conn.query('SELECT * FROM items WHERE id = ?', [res.insertId]);
    return { item: shapeItem(item), xp, achievements };
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
            const { item } = await access.forItem(conn, discordId, id, 'editor', { lock: true });
            if (parentGiven) await assertValidParent(conn, item.list_id, fields.parent_id, id);
            // A new due date or rule starts a new monthly anchor.
            // A new due date also re-arms the task's reminder (due-day DM and any snooze).
            let cols = keys.includes('due_date') || keys.includes('recurrence') ? [...keys, 'repeat_anchor_day'] : keys;
            const dateChanged = keys.includes('due_date') && String(item.due_date || '').slice(0, 10) !== (fields.due_date || '');
            // Only a changed date restarts the 24-hour clock that early/overdue effects need (see trustedDueDate).
            if (dateChanged) {
                fields.due_date_set_at = fields.due_date ? new Date() : null;
                cols = [...cols, 'due_date_set_at'];
            }
            // A changed date also re-arms the task's reminder (due-day DM and any snooze) for the owner and every member, but at most
            // REMINDER_REARMS_PER_DAY times a day: re-saving the same date, or the fourth change today, leaves everyone's state alone.
            const rearm = rearmAllowed(item, dateChanged);
            if (rearm) {
                Object.assign(fields, rearm);
                cols = [...cols, 'reminded_at', 'remind_at', 'rearm_count', 'rearm_day'];
            }
            await conn.query(`UPDATE items SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...cols.map((k) => (k in fields ? fields[k] : null)), id]);
            if (rearm) await conn.query('DELETE FROM item_reminders WHERE item_id = ?', [id]);
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
        const { item } = await access.forItem(conn, discordId, id, 'editor', { lock: true });
        const [rows] = await conn.query('SELECT id FROM items WHERE list_id = ? ORDER BY position, id FOR UPDATE', [item.list_id]);
        const ids = rows.map((r) => r.id).filter((x) => x !== id);
        ids.splice(Math.min(position, ids.length), 0, id);
        await writePositions(conn, ids);
        return ids;
    });
}

/** Apply a full new order to a list the user can edit. `orderedIds` must be exactly the list's item ids. */
async function reorderItems(discordId, listId, orderedIds) {
    const lid = unwrap(v.id(listId));
    if (!Array.isArray(orderedIds) || orderedIds.length > 5000) throw errors.validation('Provide the task ids in their new order.');
    const wanted = orderedIds.map((x) => unwrap(v.id(x)));
    return withTransaction(async (conn) => {
        await access.forList(conn, discordId, lid, 'editor', { lock: true });
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
    await withTransaction(async (conn) => {
        await access.forItem(conn, discordId, id, 'editor', { lock: true });
        await conn.query('DELETE FROM items WHERE id = ?', [id]);
    });
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
        `INSERT INTO items (list_id, name, description, position, due_date, due_date_set_at, priority, tags, recurrence, parent_id, repeat_anchor_day, counts_for_quests, habit_streak, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [item.list_id, item.name, item.description, Number(pos.next), due, new Date(), item.priority, item.tags, item.recurrence, item.parent_id, anchor, habitStreak, item.created_by || user.discord_id]
    );
    const [[created]] = await conn.query('SELECT * FROM items WHERE id = ?', [res.insertId]);
    return shapeItem(created);
}

/**
 * The task's due date as far as early/overdue effects may believe it: only a date that was set at least
 * LIMITS.DUE_DATE_MIN_AGE_HOURS before `now`. A date typed in just now (say, last year's) completes the task
 * normally with no overdue or early extras, so backdating cannot farm them.
 * @returns {string|null} YYYY-MM-DD or null
 */
function trustedDueDate(item, now) {
    if (!item.due_date || !item.due_date_set_at) return null;
    const setAt = new Date(item.due_date_set_at).getTime();
    if (!Number.isFinite(setAt) || setAt > now.getTime() - LIMITS.DUE_DATE_MIN_AGE_HOURS * 3600e3) return null;
    return String(item.due_date).slice(0, 10);
}

/**
 * What class and skill rules may look at when a task is completed: its priority, whether it
 * repeats, its due date and how overdue it was (in the user's own time zone), and whether this
 * completion emptied a list of at least three tasks. Call after the item row is marked completed.
 */
async function completionContext(conn, item, user, now = new Date()) {
    const today = todayInZone(user.timezone);
    const dueDate = trustedDueDate(item, now);
    const [[counts]] = await conn.query(
        'SELECT COUNT(*) AS total, COALESCE(SUM(completed = 0), 0) AS open FROM items WHERE list_id = ? AND parent_id IS NULL',
        [item.list_id]
    );
    // A list that was cleared once never counts as cleared again (same rule as the list_cleared XP), so re-opening it
    // by adding or un-checking a task and finishing it again cannot repeat the Artisan's project bonus.
    const [[marked]] = await conn.query('SELECT cleared_at FROM lists WHERE id = ?', [item.list_id]);
    return {
        priority: item.priority || item.list_priority,
        recurring: Boolean(item.recurrence),
        today,
        dueDate,
        // The stored date whatever its age: habit streaks follow the schedule, not the bonuses.
        scheduledDate: item.due_date ? String(item.due_date).slice(0, 10) : null,
        overdueDays: dueDate ? Math.max(0, daysBetween(dueDate, today)) : 0,
        listCleared: !item.recurrence && !item.parent_id && Number(counts.total) >= 3 && Number(counts.open) === 0 && !(marked && marked.cleared_at)
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
        const [mark] = await conn.query('UPDATE lists SET cleared_at = ?, cleared_by = ?, updated_at = updated_at WHERE id = ? AND cleared_at IS NULL', [new Date(), user.discord_id, item.list_id]);
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
    if (ctx.scheduledDate && ctx.scheduledDate < ctx.today) return { streak: 0, counted: false };
    const early = ctx.scheduledDate ? daysBetween(ctx.today, ctx.scheduledDate) : 0;
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
        const { item } = await access.forItem(conn, user.discord_id, id, 'editor', { lock: true });

        const target = completed === undefined ? !item.completed : Boolean(completed);
        const now = new Date();
        await conn.query('UPDATE items SET completed = ?, completed_at = ?, completed_by = ? WHERE id = ?', [target ? 1 : 0, target ? now : null, target ? user.discord_id : null, id]);

        let xp = null;
        let achievements = [];
        let nextItem = null;
        let bonuses = [];
        if (target && !item.xp_awarded) {
            // first_completed_* is what quests count: set once, never rewritten by a re-check or a later priority edit.
            const dueOn = trustedDueDate(item, now);
            const todayLocal = todayInZone(user.timezone);
            await conn.query(
                `UPDATE items SET xp_awarded = TRUE, first_completed_at = ?, first_completed_by = ?, first_completed_high = ?,
                        first_completed_early = ?, first_completed_overdue = ? WHERE id = ?`,
                [now, user.discord_id, (item.priority || item.list_priority) === 'HIGH' ? 1 : 0, dueOn ? (dueOn > todayLocal ? 1 : 0) : null, dueOn ? (dueOn < todayLocal ? 1 : 0) : null, id]
            );
            await conn.query('UPDATE users SET total_items_completed = total_items_completed + 1 WHERE discord_id = ?', [user.discord_id]);
            user.total_items_completed = Number(user.total_items_completed) + 1;
            const ctx = await completionContext(conn, item, user, now);
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
        return { item: shapeItem(updated), completed: target, xp, bonuses, achievements, nextItem, firstCompletion: Boolean(target && !item.xp_awarded) };
    });
}

/** Swap two items of the same list (the user must be able to edit it) (works even on legacy lists with duplicate positions). */
async function swapItemPositions(discordId, itemIdA, itemIdB) {
    const a = unwrap(v.id(itemIdA));
    const b = unwrap(v.id(itemIdB));
    return withTransaction(async (conn) => {
        const first = await access.forItem(conn, discordId, a, 'editor', { lock: true });
        const second = await access.forItem(conn, discordId, b, 'editor', { lock: true });
        const rows = [first.item, second.item];
        if (rows[0].list_id !== rows[1].list_id) throw errors.notFound('Tasks not found.');
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
 * Lists that might need a reminder right now, one row per person who should hear about it: the owner (whose
 * state lives on the list) and every member with automation on (whose state lives in list_reminders, so each
 * member is reminded once). `discord_id` is the recipient, `owner_id` the list's owner, and the time zone and
 * reminder hour are the recipient's. This is a deliberately wide net (a day either side covers every time
 * zone); the bot decides per user, in their own local time, what to send.
 *   - snoozed lists whose snooze has ended
 *   - lists due in the next day or the last 14 days that still owe a due or overdue notice
 */
async function getReminderCandidates(now = new Date()) {
    const day = (offset) => {
        const d = new Date(now.getTime() + offset * 86400e3);
        return d.toISOString().slice(0, 10);
    };
    const counts = `(SELECT COUNT(*) FROM items i WHERE i.list_id = l.id) AS items_total,
                (SELECT COALESCE(SUM(i.completed), 0) FROM items i WHERE i.list_id = l.id) AS items_done`;
    const owners = await run(
        `SELECT l.*, l.discord_id AS owner_id, u.timezone, u.reminder_hour, ${counts}
         FROM lists l JOIN users u ON u.discord_id = l.discord_id
         WHERE u.automation_enabled = TRUE AND (
             (l.remind_at IS NOT NULL AND l.remind_at <= ?)
             OR (l.deadline IS NOT NULL AND l.deadline >= ? AND l.deadline <= ?
                 AND (l.deadline_notified = FALSE OR l.overdue_notified = FALSE))
         )`,
        [now, day(-14), day(1)]
    );
    const members = await run(
        `SELECT l.*, l.discord_id AS owner_id, m.discord_id AS recipient_id, u.timezone, u.reminder_hour,
                COALESCE(r.deadline_notified, 0) AS member_deadline_notified, COALESCE(r.overdue_notified, 0) AS member_overdue_notified,
                r.remind_at AS member_remind_at, ${counts}
         FROM list_members m
         JOIN lists l ON l.id = m.list_id
         JOIN users u ON u.discord_id = m.discord_id
         LEFT JOIN list_reminders r ON r.list_id = m.list_id AND r.discord_id = m.discord_id
         WHERE u.automation_enabled = TRUE AND (
             (r.remind_at IS NOT NULL AND r.remind_at <= ?)
             OR (l.deadline IS NOT NULL AND l.deadline >= ? AND l.deadline <= ?
                 AND (COALESCE(r.deadline_notified, 0) = 0 OR COALESCE(r.overdue_notified, 0) = 0))
         )`,
        [now, day(-14), day(1)]
    );
    const memberRows = members.map(
        ({ recipient_id: recipient, member_deadline_notified: dn, member_overdue_notified: on, member_remind_at: remindAt, ...row }) => ({
            ...row,
            discord_id: recipient,
            deadline_notified: Number(dn),
            overdue_notified: Number(on),
            remind_at: remindAt
        })
    );
    return [...owners, ...memberRows].map((r) => ({ ...r, items_total: Number(r.items_total), items_done: Number(r.items_done) }));
}

/**
 * Record that a reminder went out. `kind`: 'due' | 'overdue' | 'snooze'. Keeps updated_at: it is not an edit.
 * `late`: the deadline day is over; `pastDeadline`: the deadline is today or earlier.
 * `recipientId`: who it went to. A member's state is kept apart (list_reminders); the owner's stays on the list.
 */
async function markReminderSent(listId, kind, { late = false, pastDeadline = late, recipientId } = {}) {
    const flags = {
        due: late ? { deadline: 1, overdue: 1 } : { deadline: 1 },
        overdue: { deadline: 1, overdue: 1 },
        // A snooze that fires on/after the deadline counts as the due (and, once the day is over,
        // the overdue) notice, so another DM does not follow within the hour.
        snooze: late ? { deadline: 1, overdue: 1, clearSnooze: true } : pastDeadline ? { deadline: 1, clearSnooze: true } : { clearSnooze: true }
    }[kind];
    if (!flags) throw new Error(`Unknown reminder kind ${kind}`);
    const owner = recipientId === undefined ? null : (await run('SELECT discord_id FROM lists WHERE id = ?', [listId]))[0];
    if (recipientId !== undefined && owner && String(owner.discord_id) !== String(recipientId)) {
        await run(
            `INSERT INTO list_reminders (list_id, discord_id, deadline_notified, overdue_notified, remind_at) VALUES (?, ?, ?, ?, NULL)
             ON DUPLICATE KEY UPDATE deadline_notified = GREATEST(deadline_notified, VALUES(deadline_notified)),
                 overdue_notified = GREATEST(overdue_notified, VALUES(overdue_notified)),
                 remind_at = IF(? = 1, NULL, remind_at)`,
            [listId, String(recipientId), flags.deadline ? 1 : 0, flags.overdue ? 1 : 0, flags.clearSnooze ? 1 : 0]
        );
        return;
    }
    const sets = [];
    if (flags.deadline) sets.push('deadline_notified = TRUE');
    if (flags.overdue) sets.push('overdue_notified = TRUE');
    if (flags.clearSnooze) sets.push('remind_at = NULL');
    await run(`UPDATE lists SET ${sets.join(', ')}, updated_at = updated_at WHERE id = ?`, [listId]);
}

/** Remind the user (owner or member) about a list again at `until`. Each person's snooze is their own. */
async function snoozeList(discordId, listId, until) {
    const id = unwrap(v.id(listId));
    await withTransaction(async (conn) => {
        const { isOwner } = await access.forList(conn, discordId, id, 'viewer', { lock: true });
        if (isOwner) {
            await conn.query('UPDATE lists SET remind_at = ?, updated_at = updated_at WHERE id = ?', [until, id]);
        } else {
            await conn.query(
                'INSERT INTO list_reminders (list_id, discord_id, remind_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE remind_at = VALUES(remind_at)',
                [id, String(discordId), until]
            );
        }
    });
    return true;
}

/**
 * Open tasks with their own due date that might need a reminder right now, one row per person who should hear
 * about it (the owner, and every member with automation on), with the recipient's time zone and reminder hour
 * (a wide net; the bot decides in local time). `discord_id` is the recipient. A member's state lives in item_reminders.
 * A task due on the same day as its list's deadline is left to the list reminder.
 *   - snoozed tasks whose snooze has ended
 *   - tasks due in the next day or the last 14 days that have not been reminded yet
 */
async function getTaskReminderCandidates(now = new Date()) {
    const day = (offset) => new Date(now.getTime() + offset * 86400e3).toISOString().slice(0, 10);
    const owners = await run(
        `SELECT i.id, i.name, i.list_id, i.due_date, i.priority, i.remind_at, i.reminded_at, i.parent_id,
                l.name AS list_name, l.discord_id, l.discord_id AS owner_id, u.timezone, u.reminder_hour
         FROM items i JOIN lists l ON l.id = i.list_id JOIN users u ON u.discord_id = l.discord_id
         WHERE u.automation_enabled = TRUE AND i.completed = FALSE AND i.due_date IS NOT NULL AND (
             (i.remind_at IS NOT NULL AND i.remind_at <= ?)
             OR (i.reminded_at IS NULL AND i.remind_at IS NULL AND i.due_date >= ? AND i.due_date <= ?
                 AND (l.deadline IS NULL OR l.deadline <> i.due_date))
         )`,
        [now, day(-14), day(1)]
    );
    const members = await run(
        `SELECT i.id, i.name, i.list_id, i.due_date, i.priority, r.remind_at AS remind_at, r.reminded_at AS reminded_at, i.parent_id,
                l.name AS list_name, m.discord_id, l.discord_id AS owner_id, u.timezone, u.reminder_hour
         FROM list_members m
         JOIN lists l ON l.id = m.list_id
         JOIN items i ON i.list_id = l.id
         JOIN users u ON u.discord_id = m.discord_id
         LEFT JOIN item_reminders r ON r.item_id = i.id AND r.discord_id = m.discord_id
         WHERE u.automation_enabled = TRUE AND i.completed = FALSE AND i.due_date IS NOT NULL AND (
             (r.remind_at IS NOT NULL AND r.remind_at <= ?)
             OR (r.reminded_at IS NULL AND r.remind_at IS NULL AND i.due_date >= ? AND i.due_date <= ?
                 AND (l.deadline IS NULL OR l.deadline <> i.due_date))
         )`,
        [now, day(-14), day(1)]
    );
    return [...owners, ...members];
}

/** Record that a task's reminder went out (also ends a snooze). `recipientId` is who it went to (a member keeps their own state). */
async function markTaskReminderSent(itemId, now = new Date(), recipientId) {
    if (recipientId !== undefined) {
        const [row] = await run('SELECT l.discord_id FROM items i JOIN lists l ON l.id = i.list_id WHERE i.id = ?', [itemId]);
        if (row && String(row.discord_id) !== String(recipientId)) {
            await run(
                `INSERT INTO item_reminders (item_id, discord_id, reminded_at, remind_at) VALUES (?, ?, ?, NULL)
                 ON DUPLICATE KEY UPDATE reminded_at = VALUES(reminded_at), remind_at = NULL`,
                [itemId, String(recipientId), now]
            );
            return;
        }
    }
    // Keep updated_at: a reminder going out is not an edit (it would re-trigger the AI reindex and the cleanup timer).
    await run('UPDATE items SET reminded_at = ?, remind_at = NULL, updated_at = updated_at WHERE id = ?', [now, itemId]);
}

/** Remind the user (owner or member) about a task again at `until`. */
async function snoozeTask(discordId, itemId, until) {
    const id = unwrap(v.id(itemId));
    await withTransaction(async (conn) => {
        const { isOwner } = await access.forItem(conn, discordId, id, 'viewer', { lock: true });
        if (isOwner) {
            await conn.query('UPDATE items SET remind_at = ?, updated_at = updated_at WHERE id = ?', [until, id]);
        } else {
            await conn.query(
                'INSERT INTO item_reminders (item_id, discord_id, remind_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE remind_at = VALUES(remind_at)',
                [id, String(discordId), until]
            );
        }
    });
    return true;
}

async function markDeadlineNotified(listId) {
    // Keep updated_at: a reminder being sent is not an edit of the list.
    await run('UPDATE lists SET deadline_notified = TRUE, updated_at = updated_at WHERE id = ?', [listId]);
}

/**
 * Delete lists for users with auto_delete_old_lists on once every item is completed
 * and the last change was 5+ days ago. Unfinished lists are never deleted, even when
 * their deadline is long gone: they stay visible as overdue. A list that is shared with anyone is never
 * deleted automatically: other people's work lives there too.
 * @returns {Promise<Array<{ id: number, discord_id: string }>>} the lists that were deleted
 */
async function cleanupOldLists(days = 5, { onCandidates } = {}) {
    const eligible = `u.auto_delete_old_lists = TRUE
         AND s.total > 0 AND s.done = s.total AND s.last_change < (UTC_TIMESTAMP() - INTERVAL ? DAY)
         AND NOT EXISTS (SELECT 1 FROM list_members sm WHERE sm.list_id = l.id)`;
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

/**
 * The writing services restricted to lists the user OWNS, for callers that must never reach a list the user merely belongs to:
 * the AI service's tools (routes/internal.js) use these, so sharing never widens what the AI can read or change. A member's
 * call on someone else's list is NOT_FOUND, exactly like a stranger's.
 */
async function requireOwnedList(discordId, listId) {
    const { isOwner } = await access.forList(getPool(), discordId, listId);
    if (!isOwner) throw errors.notFound('List not found.');
}
async function requireOwnedItem(discordId, itemId) {
    const { isOwner } = await access.forItem(getPool(), discordId, itemId);
    if (!isOwner) throw errors.notFound('Task not found.');
}
const ownedList = (fn) => async (discordId, listId, ...rest) => {
    await requireOwnedList(discordId, listId);
    return fn(discordId, listId, ...rest);
};
const ownedItem = (fn) => async (discordId, itemId, ...rest) => {
    await requireOwnedItem(discordId, itemId);
    return fn(discordId, itemId, ...rest);
};
const asOwner = {
    createListWithItems: (...args) => createListWithItems(...args),
    addItem: ownedList(addItem),
    updateList: ownedList(updateList),
    updateItem: ownedItem(updateItem),
    setItemCompleted: ownedItem(setItemCompleted),
    addSubtasks: ownedItem(addSubtasks)
};

module.exports = {
    asOwner,
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
