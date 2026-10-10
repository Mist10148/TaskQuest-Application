'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuickAdd } = require('../src/quickAdd');

// 2030-03-13 is a Wednesday. The same cases run against apps/web/src/lib/quickAdd.ts.
const TODAY = '2030-03-13';
const parse = (text) => parseQuickAdd(text, TODAY);

const CASES = [
    ['Finish report fri !high #work every week', { name: 'Finish report', due_date: '2030-03-15', priority: 'HIGH', tags: ['work'], recurrence: 'weekly' }],
    ['Buy milk tomorrow', { name: 'Buy milk', due_date: '2030-03-14', priority: null, tags: [], recurrence: null }],
    ['Call mom today !m', { name: 'Call mom', due_date: '2030-03-13', priority: 'MEDIUM', tags: [], recurrence: null }],
    ['Water plants daily #home #garden', { name: 'Water plants', due_date: null, priority: null, tags: ['home', 'garden'], recurrence: 'daily' }],
    ['Pay rent every month', { name: 'Pay rent', due_date: null, priority: null, tags: [], recurrence: 'monthly' }],
    ['Review PR wed', { name: 'Review PR', due_date: '2030-03-20', priority: null, tags: [], recurrence: null }], // today is Wednesday: next one
    ['Dentist in 3 days', { name: 'Dentist', due_date: '2030-03-16', priority: null, tags: [], recurrence: null }],
    ['Plan trip in 2 weeks !low', { name: 'Plan trip', due_date: '2030-03-27', priority: 'LOW', tags: [], recurrence: null }],
    ['Taxes 2030-04-15', { name: 'Taxes', due_date: '2030-04-15', priority: null, tags: [], recurrence: null }],
    ['Birthday card apr 9', { name: 'Birthday card', due_date: '2030-04-09', priority: null, tags: [], recurrence: null }],
    ['Birthday card 9 April', { name: 'Birthday card', due_date: '2030-04-09', priority: null, tags: [], recurrence: null }],
    ['Renew passport jan 5', { name: 'Renew passport', due_date: '2031-01-05', priority: null, tags: [], recurrence: null }], // already past this year
    ['Buy sun cream', { name: 'Buy sun cream', due_date: null, priority: null, tags: [], recurrence: null }],
    ['Marketing 5 ideas', { name: 'Marketing 5 ideas', due_date: null, priority: null, tags: [], recurrence: null }],
    ['Fix bug 2030-02-30', { name: 'Fix bug 2030-02-30', due_date: null, priority: null, tags: [], recurrence: null }],
    ['Just a plain task', { name: 'Just a plain task', due_date: null, priority: null, tags: [], recurrence: null }],
    ['!high', { name: '', due_date: null, priority: 'HIGH', tags: [], recurrence: null }],
    ['  spaced   out   tomorrow  ', { name: 'spaced out', due_date: '2030-03-14', priority: null, tags: [], recurrence: null }],
    ['Email Sam tomorrow, then friday', { name: 'Email Sam then friday', due_date: '2030-03-14', priority: null, tags: [], recurrence: null }]
];

for (const [input, expected] of CASES) {
    test(`quick add: ${JSON.stringify(input)}`, () => {
        assert.deepEqual(parse(input), expected);
    });
}

test('quick add keeps at most five tags and ignores a second priority', () => {
    const r = parse('x #a #b #c #d #e #f !high !low');
    assert.deepEqual(r.tags, ['a', 'b', 'c', 'd', 'e']);
    assert.equal(r.priority, 'HIGH');
    assert.equal(r.name, 'x #f !low');
});

test('quick add handles empty and odd input', () => {
    assert.equal(parseQuickAdd('', TODAY).name, '');
    assert.equal(parseQuickAdd(undefined, TODAY).name, '');
    assert.equal(parse('constructor __proto__ toString').name, 'constructor __proto__ toString');
});
