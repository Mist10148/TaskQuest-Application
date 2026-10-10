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

test('nextOccurrence: daily, weekly and monthly with month-end clamping', () => {
    const { nextOccurrence, nextDueOnOrAfter } = require('../src/dates');
    assert.equal(nextOccurrence('2030-01-31', 'daily'), '2030-02-01');
    assert.equal(nextOccurrence('2030-12-30', 'weekly'), '2031-01-06');
    assert.equal(nextOccurrence('2030-01-31', 'monthly'), '2030-02-28');
    assert.equal(nextOccurrence('2032-01-31', 'monthly'), '2032-02-29', 'leap year');
    assert.equal(nextOccurrence('2030-12-15', 'monthly'), '2031-01-15');
    assert.equal(nextOccurrence('2030-03-31', 'monthly'), '2030-04-30');
    assert.equal(nextOccurrence('garbage', 'daily'), null);
    assert.equal(nextOccurrence('2030-01-01', 'yearly'), null);
    // finishing a weekly task three weeks late must not create an already-overdue copy
    assert.equal(nextDueOnOrAfter('2030-01-01', 'weekly', '2030-01-22'), '2030-01-22');
    assert.equal(nextDueOnOrAfter('2030-01-01', 'daily', '2030-01-01'), '2030-01-02');
});

test('hourInZone and weekdayInZone follow the zone', () => {
    const { hourInZone, weekdayInZone } = require('../src/dates');
    const instant = new Date('2030-01-13T21:30:00Z'); // Sunday 21:30 UTC (no DST in January)
    assert.equal(hourInZone(undefined, instant), 21);
    assert.equal(hourInZone('Asia/Manila', instant), 5);
    assert.equal(hourInZone('America/New_York', instant), 16);
    assert.equal(weekdayInZone(undefined, instant), 7, 'Sunday');
    assert.equal(weekdayInZone('Asia/Manila', instant), 1, 'already Monday in Manila');
    assert.equal(hourInZone('Pacific/Auckland', new Date('2030-03-10T11:00:00Z')), 0, 'midnight reads as 0, not 24');
});
