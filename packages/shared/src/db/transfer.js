/**
 * Export, import and calendar-feed data. Importing is deliberately reward-free:
 * it writes lists and tasks directly (no XP, no counters, no achievements), and
 * tasks that arrive completed are marked as already paid, so an export/import
 * loop can never be used to earn XP.
 */

'use strict';

const crypto = require('crypto');
const { getPool, withTransaction } = require('./pool');
const { lockUser } = require('./users');
const { errors } = require('../errors');
const v = require('../validation');

const LIMITS = { LISTS: 100, ITEMS_PER_LIST: 500, ITEMS_TOTAL: 1000 };
const FORMAT_VERSION = 1;

const isoDate = (value) => (value ? String(value).slice(0, 10) : null);

/** Everything the user owns, in a portable shape. */
async function exportAll(discordId) {
    const id = String(discordId);
    const [lists] = await getPool().query('SELECT * FROM lists WHERE discord_id = ? ORDER BY id', [id]);
    const [items] = await getPool().query(
        `SELECT i.* FROM items i JOIN lists l ON l.id = i.list_id WHERE l.discord_id = ? ORDER BY i.list_id, i.position, i.id`,
        [id]
    );
    const byList = new Map();
    for (const i of items) {
        if (!byList.has(i.list_id)) byList.set(i.list_id, []);
        byList.get(i.list_id).push({
            id: i.id,
            parent_id: i.parent_id,
            name: i.name,
            description: i.description,
            completed: Boolean(i.completed),
            due_date: isoDate(i.due_date),
            priority: i.priority,
            tags: i.tags,
            recurrence: i.recurrence
        });
    }
    return {
        app: 'TaskQuest',
        version: FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        lists: lists.map((l) => ({
            name: l.name,
            description: l.description,
            category: l.category,
            priority: l.priority,
            deadline: isoDate(l.deadline),
            items: byList.get(l.id) || []
        }))
    };
}

/** A cell that a spreadsheet could execute as a formula gets a leading apostrophe. */
function csvCell(value) {
    let s = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per task: list, task, subtask-of, done, due date, priority, tags, repeat. */
function toCsv(data) {
    const rows = [['list', 'task', 'subtask_of', 'done', 'due_date', 'priority', 'tags', 'repeat', 'list_deadline', 'list_category']];
    for (const l of data.lists) {
        const names = new Map(l.items.map((i) => [i.id, i.name]));
        if (!l.items.length) rows.push([l.name, '', '', '', '', '', '', '', l.deadline, l.category]);
        for (const i of l.items) {
            rows.push([l.name, i.name, i.parent_id ? names.get(i.parent_id) || '' : '', i.completed ? 'yes' : 'no', i.due_date, i.priority, i.tags, i.recurrence, l.deadline, l.category]);
        }
    }
    return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Validate a whole import before writing anything. Returns normalised lists. */
function parseImport(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.lists)) throw errors.validation('Import file must contain a "lists" array.');
    if (data.lists.length > LIMITS.LISTS) throw errors.validation(`An import can contain at most ${LIMITS.LISTS} lists.`);
    let total = 0;
    return data.lists.map((raw, li) => {
        const where = `lists[${li}]`;
        const fail = (msg) => {
            throw errors.validation(`${where}: ${msg}`);
        };
        const pick = (result) => (result.ok ? result.value : fail(result.error));
        if (!raw || typeof raw !== 'object') fail('must be an object.');
        const rawItems = raw.items === undefined ? [] : raw.items;
        if (!Array.isArray(rawItems)) fail('"items" must be an array.');
        if (rawItems.length > LIMITS.ITEMS_PER_LIST) fail(`at most ${LIMITS.ITEMS_PER_LIST} tasks per list.`);
        total += rawItems.length;
        if (total > LIMITS.ITEMS_TOTAL) throw errors.validation(`An import can contain at most ${LIMITS.ITEMS_TOTAL} tasks.`);

        const list = {
            name: pick(v.listName(raw.name)),
            description: pick(v.description(raw.description)),
            category: pick(v.category(raw.category)),
            priority: pick(v.priority(raw.priority)),
            deadline: pick(v.deadline(raw.deadline)),
            items: rawItems.map((it, ii) => {
                const at = (msg) => fail(`items[${ii}]: ${msg}`);
                const field = (result) => (result.ok ? result.value : at(result.error));
                if (!it || typeof it !== 'object') at('must be an object.');
                return {
                    ref: it.id,
                    parentRef: it.parent_id ?? null,
                    name: field(v.itemName(it.name)),
                    description: field(v.description(it.description)),
                    completed: Boolean(it.completed),
                    due_date: field(v.dueDate(it.due_date)),
                    priority: field(v.priority(it.priority)),
                    tags: field(v.tags(it.tags)),
                    recurrence: field(v.recurrence(it.recurrence))
                };
            })
        };
        return list;
    });
}

/** A free list name: "Name", then "Name (imported)", "Name (imported 2)", ... within the 100-character limit. */
function freeName(base, taken) {
    const fit = (suffix) => `${base.slice(0, 100 - suffix.length)}${suffix}`;
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 1; n < 1000; n++) {
        const candidate = fit(n === 1 ? ' (imported)' : ` (imported ${n})`);
        if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    throw errors.conflict('Could not find a free list name.');
}

/**
 * Import lists and tasks. All or nothing. Existing lists are never touched;
 * a name clash gets an "(imported)" suffix.
 * @returns {Promise<{ lists: number, items: number }>}
 */
async function importAll(discordId, data) {
    const lists = parseImport(data);
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        const [existing] = await conn.query('SELECT name FROM lists WHERE discord_id = ?', [user.discord_id]);
        const taken = new Set(existing.map((l) => l.name.toLowerCase()));

        let itemCount = 0;
        for (const l of lists) {
            const name = freeName(l.name, taken);
            taken.add(name.toLowerCase());
            const [res] = await conn.query(
                'INSERT INTO lists (discord_id, name, description, category, priority, deadline) VALUES (?, ?, ?, ?, ?, ?)',
                [user.discord_id, name, l.description, l.category, l.priority, l.deadline]
            );
            const listId = res.insertId;
            const idByRef = new Map();
            // Parents first, so a subtask can point at a row that already exists.
            const ordered = [...l.items.filter((i) => i.parentRef === null), ...l.items.filter((i) => i.parentRef !== null)];
            let position = 0;
            for (const it of ordered) {
                const parentId = it.parentRef !== null && idByRef.has(it.parentRef) ? idByRef.get(it.parentRef) : null;
                const [ir] = await conn.query(
                    `INSERT INTO items (list_id, name, description, completed, xp_awarded, completed_at, position, due_date, priority, tags, recurrence, parent_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [listId, it.name, it.description, it.completed ? 1 : 0, it.completed ? 1 : 0, it.completed ? new Date() : null, position++, it.due_date, it.priority, it.tags, it.recurrence, parentId]
                );
                if (it.ref !== undefined && it.ref !== null) idByRef.set(it.ref, ir.insertId);
                itemCount++;
            }
        }
        return { lists: lists.length, items: itemCount };
    });
}

// ─── Calendar feed ───────────────────────────────────────────────────────────

/** Create (or replace) the user's secret calendar feed token. */
async function regenerateCalendarToken(discordId) {
    const token = crypto.randomBytes(16).toString('hex');
    await getPool().query('INSERT IGNORE INTO users (discord_id) VALUES (?)', [String(discordId)]);
    await getPool().query('UPDATE users SET calendar_token = ? WHERE discord_id = ?', [token, String(discordId)]);
    return token;
}

async function clearCalendarToken(discordId) {
    await getPool().query('UPDATE users SET calendar_token = NULL WHERE discord_id = ?', [String(discordId)]);
}

/** The discord_id that owns a feed token, or null. */
async function findUserByCalendarToken(token) {
    if (!/^[a-f0-9]{32}$/.test(String(token))) return null;
    const [rows] = await getPool().query('SELECT discord_id FROM users WHERE calendar_token = ?', [String(token)]);
    return rows[0] ? rows[0].discord_id : null;
}

/** Lists with a deadline and tasks with a due date, for buildIcs(). */
async function getCalendarData(discordId) {
    const id = String(discordId);
    const [lists] = await getPool().query(
        `SELECT l.id, l.name, l.description, l.category, l.deadline,
                (SELECT COUNT(*) > 0 AND SUM(i.completed) = COUNT(*) FROM items i WHERE i.list_id = l.id) AS completed
         FROM lists l WHERE l.discord_id = ? AND l.deadline IS NOT NULL`,
        [id]
    );
    const [items] = await getPool().query(
        `SELECT i.id, i.name, i.description, i.due_date, i.completed, l.name AS list_name
         FROM items i JOIN lists l ON l.id = i.list_id WHERE l.discord_id = ? AND i.due_date IS NOT NULL`,
        [id]
    );
    return {
        lists: lists.map((l) => ({ ...l, deadline: isoDate(l.deadline), completed: Boolean(Number(l.completed)) })),
        items: items.map((i) => ({ ...i, due_date: isoDate(i.due_date), completed: Boolean(i.completed) }))
    };
}

module.exports = {
    LIMITS,
    exportAll,
    toCsv,
    importAll,
    parseImport,
    regenerateCalendarToken,
    clearCalendarToken,
    findUserByCalendarToken,
    getCalendarData
};
