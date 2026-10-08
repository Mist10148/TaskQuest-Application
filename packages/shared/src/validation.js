/**
 * Input normalisation shared by the bot (modals) and the API (JSON bodies).
 * Each helper returns { ok: true, value } or { ok: false, error }.
 */

'use strict';

const { TEXT_LIMITS, PRIORITIES } = require('./constants');

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
    listName,
    itemName,
    description,
    category,
    priority,
    deadline,
    formatDate,
    id,
    escapeLike
};
