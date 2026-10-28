/**
 * Comments on a task (item_comments, migration 006).
 *
 * Anyone on the task's quest reads them; an editor or better writes them; the author, or a manager of the quest (the owner counts),
 * deletes one. A stranger gets NOT_FOUND for the task and for the comment alike (access.js). Authors are shown by display name and
 * `isYou`, never by Discord ID. A comment is the quest's content, not the author's progress: a progress reset keeps it (the export
 * includes the person's own comments, see transfer.exportAll).
 */

'use strict';

const { getPool, withTransaction } = require('./pool');
const access = require('./access');
const { errors } = require('../errors');
const v = require('../validation');

const READ_LIMIT = 200;

function unwrap(result) {
    if (!result.ok) throw errors.validation(result.error);
    return result.value;
}

/** A comment row (with author_name) as `me` sees it, given my role on its list. */
function shape(row, me, role) {
    const mine = row.author_id !== null && String(row.author_id) === String(me);
    return {
        id: Number(row.id),
        body: row.body,
        author: { name: row.author_name || null, isYou: mine },
        createdAt: row.created_at,
        canDelete: mine || access.atLeast(role, 'manager')
    };
}

/**
 * The comments of a task, oldest first: the latest 200 when there are more.
 * @returns {Promise<Array<{ id: number, body: string, author: { name: string|null, isYou: boolean }, createdAt: Date, canDelete: boolean }>>}
 */
async function listComments(discordId, itemId) {
    const { item, role } = await access.forItem(getPool(), discordId, itemId, 'viewer');
    const [rows] = await getPool().query(
        `SELECT c.id, c.body, c.author_id, c.created_at, u.discord_username AS author_name
           FROM item_comments c LEFT JOIN users u ON u.discord_id = c.author_id
          WHERE c.item_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT ${READ_LIMIT}`,
        [item.id]
    );
    return rows.reverse().map((r) => shape(r, discordId, role));
}

/** Add a comment (1 to TEXT_LIMITS.COMMENT characters, trimmed) to a task of a quest the user can edit. @returns the comment as listComments shapes it */
async function addComment(discordId, itemId, body) {
    const text = unwrap(v.comment(body));
    return withTransaction(async (conn) => {
        const { item, role } = await access.forItem(conn, discordId, itemId, 'editor', { lock: true });
        const [res] = await conn.query('INSERT INTO item_comments (item_id, author_id, body) VALUES (?, ?, ?) RETURNING id', [item.id, String(discordId), text]);
        const [[row]] = await conn.query(
            'SELECT c.id, c.body, c.author_id, c.created_at, u.discord_username AS author_name FROM item_comments c LEFT JOIN users u ON u.discord_id = c.author_id WHERE c.id = ?',
            [res.insertId]
        );
        return shape(row, discordId, role);
    });
}

/** Delete a comment: its author, or a manager of the task's quest. A stranger to the quest gets NOT_FOUND. */
async function deleteComment(discordId, commentId) {
    const id = v.bigId(commentId);
    if (!id.ok) throw errors.notFound('Comment not found.');
    await withTransaction(async (conn) => {
        const [[peek]] = await conn.query('SELECT item_id FROM item_comments WHERE id = ?', [id.value]);
        if (!peek) throw errors.notFound('Comment not found.');
        let role;
        try {
            ({ role } = await access.forItem(conn, discordId, peek.item_id, 'viewer', { lock: true }));
        } catch (err) {
            if (err.code === 'NOT_FOUND') throw errors.notFound('Comment not found.');
            throw err;
        }
        const [[comment]] = await conn.query('SELECT id, author_id FROM item_comments WHERE id = ? FOR UPDATE', [id.value]);
        if (!comment) throw errors.notFound('Comment not found.');
        const mine = comment.author_id !== null && String(comment.author_id) === String(discordId);
        if (!mine && !access.atLeast(role, 'manager')) throw errors.forbidden('You can delete your own comments. A manager of this quest can delete any.');
        await conn.query('DELETE FROM item_comments WHERE id = ?', [id.value]);
    });
    return true;
}

/** Add `comment_count` to item rows, in one query. */
async function withCommentCounts(conn, rows) {
    const ids = rows.filter(Boolean).map((r) => r.id);
    const counts = new Map();
    if (ids.length) {
        const [found] = await conn.query('SELECT item_id, COUNT(*) AS n FROM item_comments WHERE item_id = ANY(?) GROUP BY item_id', [ids]);
        for (const r of found) counts.set(r.item_id, Number(r.n));
    }
    return rows.map((r) => (r ? { ...r, comment_count: counts.get(r.id) || 0 } : r));
}

/**
 * The comments `discordId` wrote, on any quest, for their export: where (quest and task name), what and when. The quest and
 * task names are left out (null) for a quest the author is no longer on, since they are someone else's and may have been
 * renamed since; the comment itself is the author's.
 */
async function ownComments(discordId) {
    const me = String(discordId);
    const acc = access.accessSql('l', me);
    const [rows] = await getPool().query(
        `SELECT l.name AS list, i.name AS task, c.body, c.created_at, CASE WHEN ${acc.sql} THEN 1 ELSE 0 END AS visible
           FROM item_comments c JOIN items i ON i.id = c.item_id JOIN lists l ON l.id = i.list_id
          WHERE c.author_id = ? ORDER BY c.created_at, c.id`,
        [...acc.params, me]
    );
    return rows.map((r) => {
        const visible = Number(r.visible) === 1;
        return { list: visible ? r.list : null, task: visible ? r.task : null, body: r.body, createdAt: r.created_at };
    });
}

module.exports = { listComments, addComment, deleteComment, withCommentCounts, ownComments, READ_LIMIT };
