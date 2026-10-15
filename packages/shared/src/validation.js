/**
 * Input normalisation shared by the bot (modals) and the API (JSON bodies).
 * Each helper returns { ok: true, value } or { ok: false, error }.
 */

'use strict';

const { TEXT_LIMITS, PRIORITIES, LIMITS } = require('./constants');

const LIMITS_REFLECTION_MAX = LIMITS.REFLECTION_MAX_LENGTH;

const ok = (value) => ({ ok: true, value });
const fail = (error) => ({ ok: false, error });

/** Strip control characters and trim. */
function cleanText(value) {
    // eslint-disable-next-line no-control-regex
    return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

function requiredText(value, max, label) {
    if (typeof value !== 'string') return fail(`${label} is required.`);
    const v = cleanText(value);
    if (!v) return fail(`${label} is required.`);
    if (v.length > max) return fail(`${label} must be at most ${max} characters.`);
    return ok(v);
}

function optionalText(value, max, label) {
    if (value === undefined || value === null || value === '') return ok(null);
    if (typeof value !== 'string') return fail(`${label} must be text.`);
    const v = cleanText(value);
    if (v.length > max) return fail(`${label} must be at most ${max} characters.`);
    return ok(v || null);
}

const listName = (v) => requiredText(v, TEXT_LIMITS.LIST_NAME, 'List name');
const partyName = (v) => requiredText(v, TEXT_LIMITS.PARTY_NAME, 'Party name');
const reflection = (v) => requiredText(v, LIMITS_REFLECTION_MAX, 'Reflection');
const itemName = (v) => requiredText(v, TEXT_LIMITS.ITEM_NAME, 'Task name');
const description = (v) => optionalText(v, TEXT_LIMITS.DESCRIPTION, 'Description');
const category = (v) => optionalText(v, TEXT_LIMITS.CATEGORY, 'Category');

function priority(value) {
    if (value === undefined || value === null || value === '') return ok(null);
    const v = String(value).toUpperCase();
    return PRIORITIES.includes(v) ? ok(v) : fail(`Priority must be one of ${PRIORITIES.join(', ')}.`);
}

/** Accepts YYYY-MM-DD (or a Date) and rejects impossible dates like 2024-02-30. */
function deadline(value) {
    if (value === undefined || value === null || value === '') return ok(null);
    if (value instanceof Date && !Number.isNaN(value.getTime())) return ok(value.toISOString().slice(0, 10));
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
    if (!m) return fail('Deadline must be a date in YYYY-MM-DD format.');
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
        return fail('Deadline is not a real calendar date.');
    }
    if (y < 2000 || y > 2100) return fail('Deadline year must be between 2000 and 2100.');
    return ok(`${m[1]}-${m[2]}-${m[3]}`);
}

/** An item's own due date: same rules as a list deadline. */
function dueDate(value) {
    const r = deadline(value);
    return r.ok ? r : fail(r.error.replace('Deadline', 'Due date'));
}

const RECURRENCES = ['daily', 'weekly', 'monthly'];

function recurrence(value) {
    if (value === undefined || value === null || value === '') return ok(null);
    const v = String(value).toLowerCase();
    return RECURRENCES.includes(v) ? ok(v) : fail(`Repeat must be one of ${RECURRENCES.join(', ')}.`);
}

const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 20;

/**
 * Tags arrive as an array or a comma/space separated string ("#work, home").
 * They are lower-cased, de-duplicated and stored as "work,home" (or null).
 */
function tags(value) {
    if (value === undefined || value === null || value === '') return ok(null);
    const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\s]+/) : null;
    if (!raw) return fail('Tags must be text.');
    const out = [];
    for (const t of raw) {
        if (typeof t !== 'string') return fail('Tags must be text.');
        const tag = cleanText(t).replace(/^#+/, '').toLowerCase();
        if (!tag) continue;
        if (tag.length > MAX_TAG_LENGTH) return fail(`A tag can be at most ${MAX_TAG_LENGTH} characters.`);
        if (!/^[\p{L}\p{N}_-]+$/u.test(tag)) return fail('Tags may only contain letters, numbers, - and _.');
        if (!out.includes(tag)) out.push(tag);
    }
    if (out.length > MAX_TAGS) return fail(`Use at most ${MAX_TAGS} tags.`);
    return ok(out.length ? out.join(',') : null);
}

/** Format a DATE column value (Date or string) as YYYY-MM-DD, or null. */
function formatDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
        const y = value.getFullYear();
        const m = String(value.getMonth() + 1).padStart(2, '0');
        const d = String(value.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    return String(value).slice(0, 10);
}

/** Positive integer id (for route params / custom ids). */
function id(value) {
    const n = typeof value === 'number' ? value : Number(String(value));
    return Number.isSafeInteger(n) && n > 0 ? ok(n) : fail('Invalid id.');
}

/** Escape % and _ so user input is matched literally in LIKE patterns. */
function escapeLike(value) {
    return String(value).replace(/[\\%_]/g, (c) => `\\${c}`);
}

module.exports = {
    cleanText,
    partyName,
    listName,
    itemName,
    reflection,
    description,
    category,
    priority,
    deadline,
    dueDate,
    recurrence,
    RECURRENCES,
    tags,
    formatDate,
    id,
    escapeLike
};
