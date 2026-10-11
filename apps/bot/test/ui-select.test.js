'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ui = require('../utils/ui');

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Item ${i + 1}`, completed: 0 }));
const options = (row) => row.toJSON().components[0].options;

test('itemSelect keeps small menus untouched', () => {
    assert.equal(options(ui.itemSelect(rows(25), 'x')).length, 25);
});

test('itemSelect pages past 25 and reaches every item', () => {
    const items = rows(60);
    const seen = new Set();
    let page = 0;
    for (let guard = 0; guard < 10; guard++) {
        const opts = options(ui.itemSelect(items, 'x', undefined, { page }));
        assert.ok(opts.length <= 25);
        for (const o of opts) if (!o.value.startsWith('__page_')) seen.add(o.value);
        const next = opts.find((o) => o.label.includes('More'));
        if (!next) break;
        page = ui.pageFromValue(next.value);
    }
    assert.equal(seen.size, 60);
    assert.equal(ui.pageFromValue('12'), null);
});

test('listSelect without paging says how many were left out', () => {
    const lists = rows(30).map((r) => ({ ...r, priority: null }));
    const row = ui.listSelect(lists, 'sel_list').toJSON().components[0];
    assert.equal(row.options.length, 25);
    assert.match(row.placeholder, /showing 25 of 30/);
});
