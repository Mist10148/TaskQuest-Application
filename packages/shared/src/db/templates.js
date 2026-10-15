/**
 * Task templates: a saved set of tasks that becomes a new quest (or is added to one) in one step.
 * Applying a template goes through the normal creation services, so every quest and task is
 * rewarded like one created by hand and the daily XP caps still apply.
 */

'use strict';

const { getPool, withTransaction, isUniqueViolation } = require('./pool');
const { lockUser } = require('./users');
const tasks = require('./tasks');
const access = require('./access');
const { errors } = require('../errors');
const v = require('../validation');
const { LIMITS } = require('../constants');
const { todayInZone } = require('../dates');

const MAX_TEMPLATES = LIMITS.MAX_TEMPLATES_PER_USER;
const MAX_ITEMS = LIMITS.MAX_TEMPLATE_ITEMS;

function unwrap(result) {
    if (!result.ok) throw errors.validation(result.error);
    return result.value;
}

const isDuplicate = (err) => isUniqueViolation(err);

/** One template task: a name plus the optional description, priority, tags and repeat rule. Due dates are not kept. */
function parseTemplateItem(raw, index) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw errors.validation(`items[${index}]: must be an object.`);
    try {
        const item = { name: unwrap(v.itemName(raw.name)) };
        const description = unwrap(v.description(raw.description));
        const priority = unwrap(v.priority(raw.priority));
        const tags = unwrap(v.tags(raw.tags));
        const recurrence = unwrap(v.recurrence(raw.recurrence));
        if (description) item.description = description;
        if (priority) item.priority = priority;
        if (tags) item.tags = tags;
        if (recurrence) item.recurrence = recurrence;
        return item;
    } catch (err) {
        if (err.code === 'VALIDATION') throw errors.validation(`items[${index}]: ${err.message}`);
        throw err;
    }
}

function parseTemplateInput(input) {
    if (!input || typeof input !== 'object') throw errors.validation('A template needs a name and tasks.');
    const items = input.items;
    if (!Array.isArray(items) || items.length === 0) throw errors.validation('A template needs at least one task.');
    if (items.length > MAX_ITEMS) throw errors.validation(`A template can hold at most ${MAX_ITEMS} tasks.`);
    return {
        name: unwrap(v.listName(input.name)),
        description: unwrap(v.description(input.description)),
        items: items.map(parseTemplateItem)
    };
}

/** Rows come back with `items` as text (MariaDB) or already parsed (MySQL 8). */
function shape(row) {
    const items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
    return { id: row.id, name: row.name, description: row.description, items, itemCount: items.length, created_at: row.created_at };
}

async function listTemplates(discordId) {
    const [rows] = await getPool().query('SELECT * FROM task_templates WHERE discord_id = ? ORDER BY name', [String(discordId)]);
    return rows.map(shape);
}

async function getTemplate(discordId, templateId) {
    const id = unwrap(v.id(templateId));
    const [[row]] = await getPool().query('SELECT * FROM task_templates WHERE id = ? AND discord_id = ?', [id, String(discordId)]);
    if (!row) throw errors.notFound('Template not found.');
    return shape(row);
}

/** @returns {Promise<object>} the stored template */
async function createTemplate(discordId, input) {
    const t = parseTemplateInput(input);
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId); // serialises this user's template writes, so the cap can't be raced
        const [[count]] = await conn.query('SELECT COUNT(*) AS n FROM task_templates WHERE discord_id = ?', [user.discord_id]);
        if (Number(count.n) >= MAX_TEMPLATES) throw errors.validation(`You can keep at most ${MAX_TEMPLATES} templates. Delete one first.`);
        let id;
        try {
            const [res] = await conn.query('INSERT INTO task_templates (discord_id, name, description, items) VALUES (?, ?, ?, ?) RETURNING id', [
                user.discord_id,
                t.name,
                t.description,
                JSON.stringify(t.items)
            ]);
            id = res.insertId;
        } catch (err) {
            if (isDuplicate(err)) throw errors.conflict(`You already have a template called "${t.name}".`);
            throw err;
        }
        const [[row]] = await conn.query('SELECT * FROM task_templates WHERE id = ?', [id]);
        return shape(row);
    });
}

async function deleteTemplate(discordId, templateId) {
    const id = unwrap(v.id(templateId));
    const [res] = await getPool().query('DELETE FROM task_templates WHERE id = ? AND discord_id = ?', [id, String(discordId)]);
    if (!res.affectedRows) throw errors.notFound('Template not found.');
    return true;
}

/** Save a quest's tasks as a template (top-level and sub tasks become a flat list; completion and due dates are dropped). */
async function saveFromList(discordId, listId, { name } = {}) {
    // Saving copies a list's contents into the user's own template, so a shared list needs the editor role (a viewer may only look).
    const { list } = await access.forList(getPool(), discordId, listId, 'editor');
    const items = await tasks.getItems(discordId, list.id);
    if (!items.length) throw errors.validation('That quest has no tasks to save.');
    if (items.length > MAX_ITEMS) throw errors.validation(`A template can hold at most ${MAX_ITEMS} tasks, and this quest has ${items.length}.`);
    return createTemplate(discordId, {
        name: name === undefined || name === null || name === '' ? list.name : name,
        description: list.description,
        items: items.map((i) => ({ name: i.name, description: i.description, priority: i.priority, tags: i.tags, recurrence: i.recurrence }))
    });
}

/** "Name", then "Name (2030-01-05)", "Name (2030-01-05 2)", ... within the 100-character name limit. */
function freeName(base, taken, today) {
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 1; n < 1000; n++) {
        const suffix = ` (${today}${n === 1 ? '' : ` ${n}`})`;
        const candidate = `${base.slice(0, 100 - suffix.length)}${suffix}`;
        if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    throw errors.conflict('Could not find a free list name.');
}

/** Fold the XP of a created quest and its tasks into one result for the UI. */
function sumXp(parts) {
    const paid = parts.filter(Boolean);
    if (!paid.length) return null;
    const last = [...paid].reverse().find((p) => p.balanceAfter !== undefined) || paid[paid.length - 1];
    return {
        baseXP: paid.reduce((n, p) => n + (p.baseXP || 0), 0),
        finalXP: paid.reduce((n, p) => n + (p.finalXP || 0), 0),
        bonusInfo: null,
        balanceAfter: last.balanceAfter,
        level: last.level,
        leveledUp: paid.some((p) => p.leveledUp),
        capped: paid.some((p) => p.capped)
    };
}

/**
 * Apply a template. Without `listId` it creates a new quest: `listName` when given (a clash is a 409),
 * otherwise the template's name, with today's date added when that name is taken. With `listId` the
 * tasks are added to that existing quest instead.
 * @returns {Promise<{ list: object, items: object[], xp: object|null, achievements: object[], created: boolean }>}
 */
async function applyTemplate(discordId, templateId, { listName, listId } = {}) {
    if (listName !== undefined && listName !== null && listId !== undefined && listId !== null) {
        throw errors.validation('Give either a new quest name or an existing quest, not both.');
    }
    const template = await getTemplate(discordId, templateId);
    const id = String(discordId);
    const [[have]] = await getPool().query(
        'SELECT COUNT(DISTINCT l.id) AS lists, COUNT(i.id) AS items FROM lists l LEFT JOIN items i ON i.list_id = l.id WHERE l.discord_id = ?',
        [id]
    );
    if (Number(have.items) + template.itemCount > LIMITS.MAX_ITEMS_PER_USER) {
        throw errors.validation(`You can have at most ${LIMITS.MAX_ITEMS_PER_USER} tasks; this template would exceed that.`);
    }

    if (listId !== undefined && listId !== null) {
        const added = await tasks.addItems(discordId, listId, template.items);
        const list = await tasks.getList(discordId, listId);
        return {
            list,
            items: added.map((a) => a.item),
            xp: sumXp(added.map((a) => a.xp)),
            achievements: added.flatMap((a) => a.achievements),
            created: false
        };
    }

    if (Number(have.lists) >= LIMITS.MAX_LISTS_PER_USER) {
        throw errors.validation(`You can have at most ${LIMITS.MAX_LISTS_PER_USER} lists.`);
    }
    const explicit = listName !== undefined && listName !== null && listName !== '';
    const wanted = explicit ? unwrap(v.listName(listName)) : template.name;
    for (let attempt = 0; ; attempt++) {
        let name = wanted;
        if (!explicit) {
            const [existing] = await getPool().query('SELECT name FROM lists WHERE discord_id = ?', [id]);
            const [[user]] = await getPool().query('SELECT timezone FROM users WHERE discord_id = ?', [id]);
            name = freeName(wanted, new Set(existing.map((l) => l.name.toLowerCase())), todayInZone(user ? user.timezone : null));
        }
        try {
            const r = await tasks.createListWithItems(discordId, { name, description: template.description }, template.items);
            return {
                list: r.list,
                items: r.items.map((i) => i.item),
                xp: sumXp([r.xp, ...r.items.map((i) => i.xp)]),
                achievements: [...r.achievements, ...r.items.flatMap((i) => i.achievements)],
                created: true
            };
        } catch (err) {
            // A name chosen for the user was taken in the meantime: pick the next free one.
            if (!explicit && err.code === 'CONFLICT' && attempt < 3) continue;
            throw err;
        }
    }
}

module.exports = {
    MAX_TEMPLATES,
    MAX_ITEMS,
    parseTemplateInput,
    listTemplates,
    getTemplate,
    createTemplate,
    deleteTemplate,
    saveFromList,
    applyTemplate
};
