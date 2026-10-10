'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildIcs, escapeText, fold } = require('../src/ics');

const NOW = new Date('2030-03-10T08:05:09Z');

test('escapeText follows RFC 5545 TEXT escaping', () => {
    assert.equal(escapeText('a, b; c\\d'), 'a\\, b\\; c\\\\d');
    assert.equal(escapeText('line1\nline2\r\nline3'), 'line1\\nline2\\nline3');
    assert.equal(escapeText(null), '');
});

test('fold wraps at 75 octets and never splits a multi-byte character', () => {
    const long = `SUMMARY:${'é'.repeat(60)}`;
    const folded = fold(long);
    for (const part of folded.split('\r\n ')) assert.ok(Buffer.byteLength(part) <= 75, 'each physical line fits');
    assert.equal(folded.replace(/\r\n /g, ''), long, 'unfolding restores the text');
    assert.equal(fold('short'), 'short');
});

test('buildIcs makes all-day events for deadlines and due dates', () => {
    const ics = buildIcs({
        now: NOW,
        lists: [{ id: 3, name: 'Taxes, 2030', deadline: '2030-12-31', description: 'Gather forms', category: 'Home', completed: false }, { id: 4, name: 'No deadline', deadline: null }],
        items: [{ id: 9, name: 'Call the bank', due_date: '2030-01-31', list_name: 'Errands', completed: true }]
    });
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
    assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
    assert.match(ics, /UID:list-3@taskquest/);
    assert.match(ics, /DTSTART;VALUE=DATE:20301231\r\nDTEND;VALUE=DATE:20310101/, 'end is the day after, across a year boundary');
    assert.match(ics, /SUMMARY:Due: Taxes\\, 2030/);
    assert.match(ics, /DTSTAMP:20300310T080509Z/);
    assert.match(ics, /UID:item-9@taskquest/);
    assert.match(ics, /SUMMARY:✓ Call the bank/);
    assert.match(ics, /DESCRIPTION:List: Errands/);
    assert.match(ics, /DTSTART;VALUE=DATE:20300131\r\nDTEND;VALUE=DATE:20300201/);
    assert.ok(!ics.includes('list-4@taskquest'), 'lists without a deadline are skipped');
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
    assert.ok(!/[^\r]\n/.test(ics), 'every line break is CRLF');
});

test('an empty calendar is still a valid calendar', () => {
    const ics = buildIcs({ now: NOW });
    assert.ok(ics.includes('BEGIN:VCALENDAR') && ics.includes('END:VCALENDAR'));
    assert.ok(!ics.includes('VEVENT'));
});
