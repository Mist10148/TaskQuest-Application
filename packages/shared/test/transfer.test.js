'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseImport } = require('../src/db/transfer');

const doc = (items) => ({ lists: [{ name: 'L', items }] });

test('import refs are compared as strings, so a numeric id matches a string parent_id', () => {
    const [list] = parseImport(doc([{ id: 1, name: 'parent' }, { id: 2, name: 'child', parent_id: '1' }]));
    assert.deepEqual(list.items.map((i) => [i.ref, i.parentRef]), [['1', null], ['2', '1']]);
});

test('items without an id or parent_id have null refs', () => {
    const [list] = parseImport(doc([{ name: 'a' }]));
    assert.deepEqual([list.items[0].ref, list.items[0].parentRef], [null, null]);
});
