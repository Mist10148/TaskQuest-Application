/**
 * Who a task is assigned to (items.assignee_id, migration 004): the owner of its list or one of its members, or nobody.
 *
 * The column holds a Discord ID, which never reaches a client. A person is addressed by their member key, 'owner' for the list's
 * owner and list_members.public_id for a member (the same keys as the members list), derived when the task is read. Handing a list
 * over therefore needs no rewrite: the new owner reads 'owner', the old owner the member key they got with the hand-over.
 *
 * An assignment never outlives the person's place on the list: leaving, removal, a progress reset and a move to a list they are not
 * on clear it. Internal to tasks.js and sharing.js; access is decided by the callers (through access.js).
 */

'use strict';

const { errors } = require('../errors');

const NOT_ON_QUEST = 'That person is not on this quest.';

/**
 * The Discord ID behind `key` on list `listId`, or null for null (unassign). Anything that is not 'owner' or a member key of that
 * list is a validation error.
 */
async function resolveAssignee(conn, listId, key) {
    if (key === null) return null;
    if (typeof key !== 'string' || key.length > 64) throw errors.validation(NOT_ON_QUEST);
    if (key === 'owner') {
        const [[list]] = await conn.query('SELECT discord_id FROM lists WHERE id = ?', [listId]);
        if (!list) throw errors.validation(NOT_ON_QUEST);
        return String(list.discord_id);
    }
    if (!/^[a-f0-9]{12}$/.test(key)) throw errors.validation(NOT_ON_QUEST);
    const [[member]] = await conn.query('SELECT discord_id FROM list_members WHERE list_id = ? AND public_id = ?', [listId, key]);
    if (!member) throw errors.validation(NOT_ON_QUEST);
    return String(member.discord_id);
}

/**
 * Add `assignee: { memberKey, name, isYou } | null` to raw item rows (they must still carry assignee_id), as `me` sees them.
 * One query for all the rows. An ID that no longer resolves to the owner or a member reads as unassigned.
 */
async function withAssignees(conn, rows, me) {
    const ids = rows.filter((r) => r && r.assignee_id).map((r) => r.id);
    const people = new Map();
    if (ids.length) {
        const [found] = await conn.query(
            `SELECT i.id, u.discord_username AS name, CASE WHEN i.assignee_id = l.discord_id THEN 'owner' ELSE m.public_id END AS member_key
               FROM items i JOIN lists l ON l.id = i.list_id JOIN users u ON u.discord_id = i.assignee_id
               LEFT JOIN list_members m ON m.list_id = i.list_id AND m.discord_id = i.assignee_id
              WHERE i.id = ANY(?)`,
            [ids]
        );
        for (const p of found) people.set(p.id, p);
    }
    return rows.map((r) => {
        if (!r) return r;
        const p = r.assignee_id ? people.get(r.id) : null;
        const assignee = p && p.member_key ? { memberKey: p.member_key, name: p.name || null, isYou: String(r.assignee_id) === String(me) } : null;
        return { ...r, assignee };
    });
}

/** A person left a list or was removed from it: their tasks there are nobody's. */
async function clearAssignments(conn, listId, discordId) {
    await conn.query('UPDATE items SET assignee_id = NULL WHERE list_id = ? AND assignee_id = ?', [listId, String(discordId)]);
}

/** After a move to `listId`: unassign the moved rows whose assignee is neither that list's owner nor one of its members. */
async function clearOutsiders(conn, listId, itemIds) {
    await conn.query(
        `UPDATE items SET assignee_id = NULL
          WHERE id = ANY(?) AND assignee_id IS NOT NULL
            AND assignee_id <> (SELECT discord_id FROM lists WHERE id = ?)
            AND assignee_id NOT IN (SELECT discord_id FROM list_members WHERE list_id = ?)`,
        [itemIds, listId, listId]
    );
}

module.exports = { resolveAssignee, withAssignees, clearAssignments, clearOutsiders, NOT_ON_QUEST };
