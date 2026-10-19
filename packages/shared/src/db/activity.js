/**
 * A task's history (item_activity, migration 005): who created, renamed, finished, reopened, re-prioritised, re-dated, assigned or
 * moved it, and from what to what.
 *
 * Rows are written by the services that make the change (tasks.js), inside the same transaction, and only when the value really
 * changed. The values are stored as text the way the UI shows them (a display name, a quest name, a YYYY-MM-DD date), so an entry
 * never needs a Discord ID to read. Not written: tasks created in bulk (an import, a template applied, the AI service's create-list
 * tool) and the next copy of a repeating task, so one action never writes hundreds of rows (docs/KNOWN_ISSUES.md).
 */

'use strict';

const { getPool } = require('./pool');
const access = require('./access');

const VALUE_MAX = 255;
const READ_LIMIT = 50;

const text = (value) => (value === null || value === undefined || value === '' ? null : String(value).slice(0, VALUE_MAX));

/** Record one change of task `itemId` by `actorId` (inside the caller's transaction). */
async function record(conn, itemId, actorId, kind, from = null, to = null) {
    await conn.query('INSERT INTO item_activity (item_id, actor_id, kind, from_value, to_value) VALUES (?, ?, ?, ?, ?)', [
        itemId,
        actorId === null || actorId === undefined ? null : String(actorId),
        kind,
        text(from),
        text(to)
    ]);
}

/** One row per moved task (a task and its subtasks): from one quest to another, by name. */
async function recordMoves(conn, itemIds, actorId, fromName, toName) {
    for (const id of itemIds) await record(conn, id, actorId, 'moved', fromName, toName);
}

const day = (value) => (value ? String(value).slice(0, 10) : null);

/**
 * The history rows of an edit: `before` is the locked row as it was, `fields` the validated new values (only the keys being set).
 * Name, priority and due date are recorded; other fields (description, tags, repeat, estimate, parent) are not part of the history.
 */
async function recordEdit(conn, before, fields, actorId) {
    if ('name' in fields && fields.name !== before.name) await record(conn, before.id, actorId, 'renamed', before.name, fields.name);
    if ('priority' in fields && (fields.priority || null) !== (before.priority || null)) await record(conn, before.id, actorId, 'priority', before.priority, fields.priority);
    if ('due_date' in fields && (fields.due_date || null) !== day(before.due_date)) await record(conn, before.id, actorId, 'due', day(before.due_date), fields.due_date);
}

/** An assignment changed from one person to another (Discord IDs, or null): recorded by display name. */
async function recordAssigned(conn, itemId, actorId, fromId, toId) {
    const ids = [fromId, toId].filter(Boolean).map(String);
    const names = new Map();
    if (ids.length) {
        const [rows] = await conn.query('SELECT discord_id, discord_username FROM users WHERE discord_id = ANY(?)', [ids]);
        for (const r of rows) names.set(String(r.discord_id), r.discord_username);
    }
    const name = (id) => (id ? names.get(String(id)) || null : null);
    await record(conn, itemId, actorId, 'assigned', name(fromId), name(toId));
}

/**
 * A task's history as `discordId` may see it (viewer or better on its list, else NOT_FOUND), newest first, at most 50 entries.
 * @returns {Promise<Array<{ id: number, kind: string, actor: { name: string|null, isYou: boolean }|null, from: string|null, to: string|null, createdAt: Date }>>}
 */
async function getActivity(discordId, itemId) {
    const { item } = await access.forItem(getPool(), discordId, itemId, 'viewer');
    const [rows] = await getPool().query(
        `SELECT a.id, a.kind, a.actor_id, u.discord_username AS actor_name, a.from_value, a.to_value, a.created_at
           FROM item_activity a LEFT JOIN users u ON u.discord_id = a.actor_id
          WHERE a.item_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT ${READ_LIMIT}`,
        [item.id]
    );
    const me = String(discordId);
    return rows.map((r) => ({
        id: Number(r.id),
        kind: r.kind,
        actor: r.actor_id === null ? null : { name: r.actor_name || null, isYou: String(r.actor_id) === me },
        from: r.from_value,
        to: r.to_value,
        createdAt: r.created_at
    }));
}

module.exports = { record, recordMoves, recordEdit, recordAssigned, getActivity, READ_LIMIT };
