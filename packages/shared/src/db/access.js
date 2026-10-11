/**
 * The one place that decides who may touch a list or a task.
 *
 * A person may use a list when they own it (lists.discord_id) or hold a row in list_members. Everything that
 * loads a list or an item for a user goes through forList / forItem, or through the SQL fragment accessSql()
 * for queries over many lists, so there is exactly one rule to get right:
 *
 *   - a stranger (no ownership, no membership) always gets NOT_FOUND, so a list's existence never leaks;
 *   - a member whose role is too weak gets FORBIDDEN: they already know the list exists;
 *   - the owner is an implicit manager.
 *
 * Pass a transaction connection together with `lock: true` to hold a row lock while the caller writes.
 */

'use strict';

const { errors } = require('../errors');
const { LIST_ROLES } = require('../constants');
const v = require('../validation');

const RANK = Object.fromEntries(LIST_ROLES.map((role, i) => [role, i + 1]));

const NO_WRITE = {
    viewer: 'You only have view access to this list.',
    editor: 'You need the manager role on this list to do that.'
};

/** True when `role` (viewer|editor|manager) is at least `min`. */
const atLeast = (role, min) => (RANK[role] || 0) >= (RANK[min] || 0);

function checkMin(min) {
    if (!RANK[min]) throw new Error(`Unknown role ${min}`);
}

function decide(row, discordId, min, notFoundMessage) {
    if (!row) throw errors.notFound(notFoundMessage);
    const isOwner = String(row.owner_id) === String(discordId);
    const role = isOwner ? 'manager' : row.member_role;
    if (!atLeast(role, min)) throw errors.forbidden(NO_WRITE[role] || 'You cannot do that on this list.');
    return { role, isOwner };
}

/**
 * Load a list the user may use at `min` role or better.
 * @param {{ query: Function }} conn a pool or a transaction connection
 * @returns {Promise<{ list: object, role: string, isOwner: boolean }>}
 * @throws NOT_FOUND for a stranger or an unknown id, FORBIDDEN when the role is too weak
 */
async function forList(conn, discordId, listId, min = 'viewer', { lock = false } = {}) {
    checkMin(min);
    const id = v.id(listId);
    if (!id.ok) throw errors.notFound('List not found.');
    const me = String(discordId);
    const [[row]] = await conn.query(
        `SELECT l.*, l.discord_id AS owner_id, m.role AS member_role
         FROM lists l LEFT JOIN list_members m ON m.list_id = l.id AND m.discord_id = ?
         WHERE l.id = ? AND (l.discord_id = ? OR m.discord_id IS NOT NULL)${lock ? ' FOR UPDATE' : ''}`,
        [me, id.value, me]
    );
    const { role, isOwner } = decide(row, me, min, 'List not found.');
    const { owner_id: ownerId, member_role: memberRole, ...list } = row; // eslint-disable-line no-unused-vars
    return { list, role, isOwner };
}

/**
 * Load a task (with its list's name, priority and owner) the user may use at `min` role or better.
 * @returns {Promise<{ item: object, role: string, isOwner: boolean }>}
 */
async function forItem(conn, discordId, itemId, min = 'viewer', { lock = false } = {}) {
    checkMin(min);
    const id = v.id(itemId);
    if (!id.ok) throw errors.notFound('Task not found.');
    const me = String(discordId);
    const [[row]] = await conn.query(
        `SELECT i.*, l.name AS list_name, l.priority AS list_priority, l.discord_id AS owner_id, m.role AS member_role
         FROM items i JOIN lists l ON l.id = i.list_id
         LEFT JOIN list_members m ON m.list_id = l.id AND m.discord_id = ?
         WHERE i.id = ? AND (l.discord_id = ? OR m.discord_id IS NOT NULL)${lock ? ' FOR UPDATE' : ''}`,
        [me, id.value, me]
    );
    const { role, isOwner } = decide(row, me, min, 'Task not found.');
    const { owner_id: ownerId, member_role: memberRole, ...item } = row; // eslint-disable-line no-unused-vars
    return { item, role, isOwner };
}

/**
 * SQL for "list `alias` is one the user may use", for queries over many lists. `me` is bound twice.
 * @returns {{ sql: string, params: string[] }}
 */
function accessSql(alias, discordId) {
    const me = String(discordId);
    return {
        sql: `(${alias}.discord_id = ? OR EXISTS (SELECT 1 FROM list_members am WHERE am.list_id = ${alias}.id AND am.discord_id = ?))`,
        params: [me, me]
    };
}

/**
 * SQL for "the user did this", for an items column that records the actor (created_by, completed_by, first_completed_by),
 * with the item aliased `i`. It binds the user's ID twice. A row without a recorded actor (written before shared lists
 * existed and not backfilled, or by a script that skipped the column) counts for the owner of its list, the only person
 * who could have acted, so the metric never silently loses history. Both branches are served by the (actor, time) indexes.
 */
function actorSql(column) {
    return `(i.${column} = ? OR (i.${column} IS NULL AND EXISTS (SELECT 1 FROM lists ol WHERE ol.id = i.list_id AND ol.discord_id = ?)))`;
}

/** The user's role on a list, or null for a stranger. Never throws. Use forList when you also need the row. */
async function roleOn(conn, discordId, listId) {
    try {
        return (await forList(conn, discordId, listId)).role;
    } catch (err) {
        if (err.code === 'NOT_FOUND') return null;
        throw err;
    }
}

module.exports = { forList, forItem, accessSql, actorSql, roleOn, atLeast, RANK };
