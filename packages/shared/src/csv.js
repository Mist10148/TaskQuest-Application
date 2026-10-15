/**
 * CSV reading for spreadsheet imports. Pure functions, no database: parseCsv() is a small RFC 4180
 * reader, csvToImport() turns rows into the same { lists: [...] } shape as a JSON export so the
 * import service applies its usual rules (quota, no XP, all or nothing) to both formats.
 */

'use strict';

const v = require('./validation');

/** A file this large is rejected before parsing (the API body limit is 1 MB as well). */
const MAX_CSV_CHARS = 1_000_000;
/** Per-row errors reported at once; the rest are only counted. */
const MAX_REPORTED_ERRORS = 100;
const DEFAULT_LIST = 'Imported';

/** Comma or semicolon, whichever appears more in the header line outside quotes (comma wins ties). */
function sniffDelimiter(text) {
    let inQuotes = false;
    let commas = 0;
    let semis = 0;
    for (const ch of text) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (!inQuotes) {
            if (ch === '\n' || ch === '\r') break;
            if (ch === ',') commas++;
            else if (ch === ';') semis++;
        }
    }
    return semis > commas ? ';' : ',';
}

/**
 * Parse CSV text into rows of strings. Handles a BOM, quoted cells, doubled quotes, CRLF/LF/CR line
 * ends and newlines inside quotes. Fully blank lines are skipped. Throws on an unterminated quote.
 * @returns {{ rows: string[][], delimiter: string }}
 */
function parseCsv(input, { delimiter } = {}) {
    let text = String(input ?? '');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const sep = delimiter || sniffDelimiter(text);
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    let quotedCell = false; // the cell started with a quote
    let quotedRow = false; // so a row of just "" is data, not a blank line

    const endCell = () => {
        row.push(cell);
        cell = '';
        quotedCell = false;
    };
    const endRow = () => {
        endCell();
        if (!(row.length === 1 && row[0] === '' && !quotedRow)) rows.push(row);
        row = [];
        quotedRow = false;
    };

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    cell += '"';
                    i++;
                } else inQuotes = false;
            } else cell += ch;
        } else if (ch === '"' && cell === '' && !quotedCell) {
            inQuotes = true;
            quotedCell = true;
            quotedRow = true;
        } else if (ch === sep) endCell();
        else if (ch === '\r') {
            if (text[i + 1] === '\n') i++;
            endRow();
        } else if (ch === '\n') endRow();
        else cell += ch;
    }
    if (inQuotes) throw new Error('The file has a quoted cell that never closes.');
    if (cell !== '' || row.length || quotedCell) endRow();
    return { rows, delimiter: sep };
}

// ─── CSV rows -> import data ─────────────────────────────────────────────────

const ALIASES = {
    list: ['list', 'quest', 'project'],
    task: ['task', 'name', 'title'],
    description: ['description', 'notes', 'note'],
    due: ['due_date', 'due', 'deadline', 'due date'],
    priority: ['priority'],
    tags: ['tags', 'tag', 'labels'],
    repeat: ['repeat', 'recurrence'],
    done: ['done', 'completed'],
    subtaskOf: ['subtask_of'],
    listDeadline: ['list_deadline'],
    listCategory: ['list_category', 'category']
};

/** Map each logical field to its column index from a header row (first alias present wins). */
function mapHeader(header) {
    const names = header.map((h) => v.cleanText(h).toLowerCase());
    const map = {};
    for (const [field, aliases] of Object.entries(ALIASES)) {
        for (const alias of aliases) {
            const at = names.indexOf(alias);
            if (at !== -1) {
                map[field] = at;
                break;
            }
        }
    }
    return map;
}

/** The export prefixes cells that look like formulas with an apostrophe; take it off again. */
const unquoteFormula = (s) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'done', 'x', '✓']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', '']);

function parseDone(raw) {
    const s = raw.trim().toLowerCase();
    if (TRUE_WORDS.has(s)) return { ok: true, value: true };
    if (FALSE_WORDS.has(s)) return { ok: true, value: false };
    return { ok: false, error: 'Done must be true/false, yes/no or 1/0.' };
}

/** Tags may be separated by ; or , (a header-less list in one cell). */
const normaliseTags = (raw) => raw.split(/[;,]/).join(',');

/**
 * Turn CSV text into import data plus per-row problems. Nothing is written; the caller imports
 * `data` only when `errors` is empty. Row numbers match the file: the header is row 1.
 * @returns {{ data: { lists: object[] }, errors: Array<{ row: number, message: string }>, errorCount: number,
 *             rows: number, lists: number, items: number, preview: object[], delimiter: string }}
 */
function csvToImport(text) {
    const empty = (errors) => ({ data: { lists: [] }, errors, errorCount: errors.length, rows: 0, lists: 0, items: 0, preview: [], delimiter: ',' });
    if (String(text ?? '').length > MAX_CSV_CHARS) return empty([{ row: 1, message: 'The file is larger than 1 MB.' }]);
    let parsed;
    try {
        parsed = parseCsv(text);
    } catch (err) {
        return empty([{ row: 1, message: err.message }]);
    }
    const [header, ...body] = parsed.rows;
    if (!header) return empty([{ row: 1, message: 'The file is empty.' }]);
    const col = mapHeader(header);
    if (col.task === undefined && col.list === undefined) {
        return empty([{ row: 1, message: 'The first row must be a header with a "task" (or "name"/"title") column and optionally "list".' }]);
    }

    const errors = [];
    let errorCount = 0;
    const fail = (row, message) => {
        errorCount++;
        if (errors.length < MAX_REPORTED_ERRORS) errors.push({ row, message });
    };

    const lists = new Map(); // lowercased name -> list under construction
    const preview = [];
    let rowCount = 0;

    body.forEach((cells, at) => {
        const row = at + 2;
        const get = (field) => (col[field] === undefined ? '' : unquoteFormula(String(cells[col[field]] ?? '')));
        if (cells.every((c) => !String(c).trim())) return;
        rowCount++;
        let ok = true;
        const check = (result, label) => {
            if (result.ok) return result.value;
            ok = false;
            fail(row, label ? `${label}: ${result.error}` : result.error);
            return null;
        };

        const listRaw = get('list').trim();
        const taskRaw = get('task').trim();
        const listName = check(v.listName(listRaw || DEFAULT_LIST), 'List');
        const hasTask = Boolean(taskRaw);
        if (!hasTask && !listRaw) {
            ok = false;
            fail(row, 'Task name is required.');
        }
        const listDeadline = check(v.deadline(get('listDeadline').trim()), 'List deadline');
        const listCategory = check(v.category(get('listCategory').trim()), 'List category');

        let item = null;
        if (hasTask) {
            const done = parseDone(get('done'));
            item = {
                ref: row,
                parentRef: null,
                subtaskOf: get('subtaskOf').trim(),
                name: check(v.itemName(taskRaw), 'Task'),
                description: check(v.description(get('description')), 'Description'),
                completed: check(done),
                due_date: check(v.dueDate(get('due').trim())),
                priority: check(v.priority(get('priority').trim())),
                tags: check(v.tags(normaliseTags(get('tags')))),
                recurrence: check(v.recurrence(get('repeat').trim()))
            };
        }
        if (!ok || listName === null) return;

        const key = listName.toLowerCase();
        if (!lists.has(key)) lists.set(key, { name: listName, description: null, category: null, priority: null, deadline: null, items: [] });
        const list = lists.get(key);
        if (listDeadline && !list.deadline) list.deadline = listDeadline;
        if (listCategory && !list.category) list.category = listCategory;
        if (item) list.items.push({ ...item, row });
        if (preview.length < 5) preview.push({ row, list: listName, task: item ? item.name : '', due_date: item?.due_date ?? null, priority: item?.priority ?? null, tags: item?.tags ?? null, completed: item?.completed ?? false });
    });

    // Resolve subtask_of by name among the same list's top-level tasks.
    for (const list of lists.values()) {
        const tops = new Map();
        for (const it of list.items) if (!it.subtaskOf && !tops.has(it.name.toLowerCase())) tops.set(it.name.toLowerCase(), it);
        for (const it of list.items) {
            if (!it.subtaskOf) continue;
            const parent = tops.get(it.subtaskOf.toLowerCase());
            if (!parent) fail(it.row, `Subtask of "${it.subtaskOf}": no such top-level task in the list "${list.name}".`);
            else it.parentRef = parent.ref;
        }
    }

    const listArr = [...lists.values()].map((l) => ({
        ...l,
        items: l.items.map(({ subtaskOf, row, ...rest }) => ({ ...rest, id: rest.ref, parent_id: rest.parentRef }))
    }));
    return {
        data: { lists: listArr },
        errors,
        errorCount,
        rows: rowCount,
        lists: listArr.length,
        items: listArr.reduce((n, l) => n + l.items.length, 0),
        preview,
        delimiter: parsed.delimiter
    };
}

module.exports = { parseDone, parseCsv, csvToImport, sniffDelimiter, MAX_CSV_CHARS, MAX_REPORTED_ERRORS, DEFAULT_LIST };
