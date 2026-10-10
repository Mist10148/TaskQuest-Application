'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { todayInZone, isPastDeadline, formatDeadline, isValidTimeZone } = require('../src/dates');

test('todayInZone follows the zone, not the server clock', () => {
    const instant = new Date('2030-01-05T02:00:00Z'); // still Jan 4 in New York, already Jan 5 in Manila
    assert.equal(todayInZone('America/New_York', instant), '2030-01-04');
    assert.equal(todayInZone('Asia/Manila', instant), '2030-01-05');
    assert.equal(todayInZone(undefined, instant), '2030-01-05');
    assert.equal(todayInZone('Not/AZone', instant), '2030-01-05');
});

test('a deadline is overdue only after its day has ended', () => {
    assert.equal(isPastDeadline('2030-01-05', '2030-01-05'), false);
    assert.equal(isPastDeadline('2030-01-05', '2030-01-06'), true);
    assert.equal(isPastDeadline(null, '2030-01-06'), false);
});

test('formatDeadline reads the string parts and adds the year only when it differs', () => {
    assert.equal(formatDeadline('2030-01-05', '2030-06-01'), 'Jan 5');
    assert.equal(formatDeadline('2031-12-26', '2030-06-01'), 'Dec 26, 2031');
    assert.equal(formatDeadline('garbage', '2030-06-01'), '');
});

test('isValidTimeZone', () => {
    assert.equal(isValidTimeZone('Europe/Paris'), true);
    assert.equal(isValidTimeZone('Mars/Olympus'), false);
    assert.equal(isValidTimeZone(''), false);
});
