'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, csvToImport, sniffDelimiter } = require('../src/csv');

test('parseCsv: quotes, escaped quotes, embedded newlines and commas', () => {
    const { rows } = parseCsv('a,"b, c","say ""hi""","line1\nline2"\r\nx,y,z,w\r\n');
    assert.deepEqual(rows, [['a', 'b, c', 'say "hi"', 'line1\nline2'], ['x', 'y', 'z', 'w']]);
});

test('parseCsv: BOM, CRLF, lone CR, missing final newline, blank lines', () => {
    assert.deepEqual(parseCsv('﻿a,b\r\n\r\nc,d').rows, [['a', 'b'], ['c', 'd']]);
    assert.deepEqual(parseCsv('a,b\rc,d\n').rows, [['a', 'b'], ['c', 'd']]);
    assert.deepEqual(parseCsv('').rows, []);
});

test('parseCsv: empty cells and trailing delimiters are kept', () => {
    assert.deepEqual(parseCsv('a,,c,\n,,\n').rows, [['a', '', 'c', ''], ['', '', '']]);
    assert.deepEqual(parseCsv('"",x\n').rows, [['', 'x']]);
    assert.deepEqual(parseCsv('""\n').rows, [['']], 'a quoted empty cell is data');
});

test('parseCsv: a quote in the middle of a cell is literal, an open quote throws', () => {
    assert.deepEqual(parseCsv('5" pipe,ok').rows, [['5" pipe', 'ok']]);
    assert.throws(() => parseCsv('a,"never closed\nb,c'), /never closes/);
});

test('delimiter sniffing: semicolons win only when the header uses them outside quotes', () => {
    assert.equal(sniffDelimiter('list;task;done\nx;y;no'), ';');
    assert.equal(sniffDelimiter('list,task,done'), ',');
    assert.equal(sniffDelimiter('"a;b;c",d'), ',');
    assert.deepEqual(parseCsv('a;b\n"c;d";e').rows, [['a', 'b'], ['c;d', 'e']]);
});

test('csvToImport: TaskQuest export format, including subtasks and defused formulas', () => {
    const csv = [
        'list,task,subtask_of,done,due_date,priority,tags,repeat,list_deadline,list_category',
        '"Trip, 2030",Book flights,,yes,2030-06-01,,travel,,2030-08-01,Travel',
        '"Trip, 2030",\'=HYPERLINK("x"),Book flights,no,,HIGH,,,2030-08-01,Travel',
        'Empty list,,,,,,,,,'
    ].join('\r\n');
    const r = csvToImport(csv);
    assert.deepEqual(r.errors, []);
    assert.equal(r.lists, 2);
    assert.equal(r.items, 2);
    const [trip, empty] = r.data.lists;
    assert.equal(trip.deadline, '2030-08-01');
    assert.equal(trip.category, 'Travel');
    assert.equal(trip.items[0].completed, true);
    assert.equal(trip.items[1].name, '=HYPERLINK("x")', 'the export apostrophe is removed');
    assert.equal(trip.items[1].parent_id, trip.items[0].id);
    assert.equal(trip.items[1].priority, 'HIGH');
    assert.equal(empty.items.length, 0);
});

test('csvToImport: generic headers, aliases, case, tag separators and the default list', () => {
    // Tags use a comma inside quotes in a semicolon file.
    const r = csvToImport('Title;Due;Priority;Tags;Recurrence;Done\nBuy milk;2030-01-05;low;"home,errands";weekly;1\nPay rent;;;a;;false\n');
    assert.deepEqual(r.errors, []);
    assert.equal(r.data.lists.length, 1);
    assert.equal(r.data.lists[0].name, 'Imported');
    const [a, b] = r.data.lists[0].items;
    assert.deepEqual([a.name, a.due_date, a.priority, a.tags, a.recurrence, a.completed], ['Buy milk', '2030-01-05', 'LOW', 'home,errands', 'weekly', true]);
    assert.deepEqual([b.tags, b.completed], ['a', false]);
    assert.equal(r.delimiter, ';');
});

test('csvToImport: rows are grouped by list name, case-insensitively', () => {
    const r = csvToImport('list,name\nWork,a\nwork,b\nHome,c\n');
    assert.deepEqual(r.data.lists.map((l) => [l.name, l.items.length]), [['Work', 2], ['Home', 1]]);
});

test('csvToImport: every bad row is reported with its file row number', () => {
    const r = csvToImport('list,task,due,priority,done,tags\nA,ok,,,,\nA,bad date,2030-02-30,,,\nA,bad prio,,URGENT,,\nA,bad done,,,maybe,\nA,tags,,,,"a b c d e f"\n,,,,,\n');
    assert.deepEqual(r.errors.map((e) => e.row), [3, 4, 5, 6]);
    assert.match(r.errors[0].message, /Due date/);
    assert.equal(r.errorCount, 4);
    assert.equal(r.rows, 5, 'the fully blank row is not counted');
});

test('csvToImport: structural problems', () => {
    assert.match(csvToImport('').errors[0].message, /empty/);
    assert.match(csvToImport('foo,bar\n1,2').errors[0].message, /header/);
    assert.match(csvToImport('task\n"open').errors[0].message, /never closes/);
    assert.match(csvToImport('x'.repeat(1_000_001)).errors[0].message, /1 MB/);
    const orphan = csvToImport('task,subtask_of\nchild,missing\n');
    assert.match(orphan.errors[0].message, /no such top-level task/);
    const deep = csvToImport('task,subtask_of\na,\nb,a\nc,b\n');
    assert.equal(deep.errors[0].row, 4, 'subtasks of subtasks are rejected');
    const twin = csvToImport('task,subtask_of\nask,Call mom\nCall mom,\nCall mom,\n');
    assert.match(twin.errors[0].message, /more than one top-level task/);
    assert.equal(twin.errors[0].row, 2);
    const noTask = csvToImport('list,task,due\n,,2030-01-01\n');
    assert.equal(noTask.errors[0].row, 2);
});

test('csvToImport: row numbers are file lines, after blank lines and cells with line breaks', () => {
    const r = csvToImport('task,due\n\nok,\n"two\nlines",2030-02-30\nbad,2030-13-01\n');
    assert.deepEqual(r.errors.map((e) => e.row), [4, 6]);
    assert.deepEqual(parseCsv('a\r\n\r\n"b\r\nc"\rd\n').lines, [1, 3, 5]);
});

test('csvToImport: a subtask of a repeated name belongs to the nearest such task above it', () => {
    const r = csvToImport('task,subtask_of\nShop,\nmilk,Shop\nShop,\nnails,Shop\n');
    assert.equal(r.errorCount, 0);
    const [first, milk, second, nails] = r.data.lists[0].items;
    assert.deepEqual([milk.parent_id, nails.parent_id], [first.id, second.id]);
});

test('toCsv writes subtasks under their task, so two same-named tasks with subtasks import back', () => {
    const { toCsv } = require('../src/db/transfer');
    const item = (id, name, parent_id = null) => ({ id, parent_id, name, description: null, completed: false, due_date: null, priority: null, tags: null, recurrence: null });
    const exported = { lists: [{ name: 'L', description: null, category: null, priority: null, deadline: null, items: [item(1, 'Shop'), item(2, 'Shop'), item(3, 'milk', 1), item(4, 'nails', 2)] }] };
    const back = csvToImport(toCsv(exported));
    assert.equal(back.errorCount, 0);
    const items = back.data.lists[0].items;
    assert.deepEqual(items.map((i) => i.name), ['Shop', 'milk', 'Shop', 'nails']);
    assert.deepEqual([items[1].parent_id, items[3].parent_id], [items[0].id, items[2].id]);
});

test('csvToImport: caps the reported errors but counts them all', () => {
    const rows = Array.from({ length: 150 }, () => 'x,2030-13-45').join('\n');
    const r = csvToImport(`task,due\n${rows}\n`);
    assert.equal(r.errors.length, 100);
    assert.equal(r.errorCount, 150);
});

test('toCsv and csvToImport round-trip names that start with an apostrophe, and descriptions', () => {
    const { toCsv } = require('../src/db/transfer');
    const exported = {
        lists: [{
            name: 'L', description: null, category: null, priority: null, deadline: null,
            items: [
                { id: 1, parent_id: null, name: "'=x", description: 'a note, with comma', completed: false, due_date: null, priority: null, tags: null, recurrence: null },
                { id: 2, parent_id: null, name: '=SUM(1)', description: null, completed: false, due_date: null, priority: null, tags: null, recurrence: null }
            ]
        }]
    };
    const back = csvToImport(toCsv(exported));
    assert.equal(back.errorCount, 0);
    const items = back.data.lists[0].items;
    assert.equal(items[0].name, "'=x");
    assert.equal(items[0].description, 'a note, with comma');
    assert.equal(items[1].name, '=SUM(1)');
});
