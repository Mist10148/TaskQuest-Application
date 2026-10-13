'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const tz = require('../src/tz');

const iso = (d) => d.toISOString();
const at = (s) => new Date(s);

test('UTC and unknown zones behave like UTC', () => {
    const t = at('2030-03-13T15:30:00Z');
    for (const zone of ['UTC', undefined, null, '', 'Mars/Base']) {
        assert.equal(iso(tz.dayStart(zone, t)), '2030-03-13T00:00:00.000Z');
        assert.equal(tz.dayKey(zone, t), '2030-03-13');
        assert.equal(iso(tz.nextDayStart(zone, t)), '2030-03-14T00:00:00.000Z');
        assert.equal(iso(tz.weekStart(zone, t)), '2030-03-11T00:00:00.000Z'); // Monday
        assert.equal(iso(tz.nextWeekStart(zone, t)), '2030-03-18T00:00:00.000Z');
        assert.equal(iso(tz.monthStart(zone, t)), '2030-03-01T00:00:00.000Z');
        assert.equal(iso(tz.nextMonthStart(zone, t)), '2030-04-01T00:00:00.000Z');
    }
});

test('fixed offsets: Kolkata (+5:30), Kiritimati (+14), Pago Pago (-11)', () => {
    const t = at('2030-03-13T20:00:00Z');
    assert.equal(tz.dayKey('Asia/Kolkata', t), '2030-03-14'); // 01:30 local
    assert.equal(iso(tz.dayStart('Asia/Kolkata', t)), '2030-03-13T18:30:00.000Z');
    assert.equal(iso(tz.nextDayStart('Asia/Kolkata', t)), '2030-03-14T18:30:00.000Z');
    assert.equal(tz.dayKey('Pacific/Kiritimati', t), '2030-03-14'); // 10:00 local
    assert.equal(iso(tz.dayStart('Pacific/Kiritimati', t)), '2030-03-13T10:00:00.000Z');
    assert.equal(tz.dayKey('Pacific/Pago_Pago', t), '2030-03-13'); // 09:00 local
    assert.equal(iso(tz.dayStart('Pacific/Pago_Pago', t)), '2030-03-13T11:00:00.000Z');
    assert.equal(iso(tz.weekStart('Pacific/Kiritimati', at('2030-03-17T09:59:00Z'))), '2030-03-10T10:00:00.000Z'); // still the old week there
    assert.equal(iso(tz.weekStart('Pacific/Kiritimati', at('2030-03-17T10:00:00Z'))), '2030-03-17T10:00:00.000Z'); // Monday 00:00 there
});

test('the same instant is a different day in different zones', () => {
    const t = at('2030-06-01T11:30:00Z');
    assert.equal(tz.dayKey('Pacific/Kiritimati', t), '2030-06-02');
    assert.equal(tz.dayKey('Pacific/Pago_Pago', t), '2030-06-01');
    assert.notEqual(iso(tz.dayStart('Pacific/Kiritimati', t)), iso(tz.dayStart('Pacific/Pago_Pago', t)));
});

test('America/New_York across DST', () => {
    // Spring forward 2030-03-10: that local day is 23 hours long.
    const day = at('2030-03-10T18:00:00Z');
    assert.equal(iso(tz.dayStart('America/New_York', day)), '2030-03-10T05:00:00.000Z'); // EST
    assert.equal(iso(tz.nextDayStart('America/New_York', day)), '2030-03-11T04:00:00.000Z'); // EDT
    // Fall back 2030-11-03: 25 hours.
    const fall = at('2030-11-03T18:00:00Z');
    assert.equal(iso(tz.dayStart('America/New_York', fall)), '2030-11-03T04:00:00.000Z');
    assert.equal(iso(tz.nextDayStart('America/New_York', fall)), '2030-11-04T05:00:00.000Z');
    // Week spanning the spring change starts Monday 2030-03-04 00:00 EST, the next one 2030-03-11 00:00 EDT.
    assert.equal(iso(tz.weekStart('America/New_York', at('2030-03-10T18:00:00Z'))), '2030-03-04T05:00:00.000Z');
    assert.equal(iso(tz.nextWeekStart('America/New_York', at('2030-03-10T18:00:00Z'))), '2030-03-11T04:00:00.000Z');
    // Instants right at the edges.
    assert.equal(tz.dayKey('America/New_York', at('2030-03-10T04:59:59Z')), '2030-03-09');
    assert.equal(tz.dayKey('America/New_York', at('2030-03-10T05:00:00Z')), '2030-03-10');
    // Month containing a change.
    assert.equal(iso(tz.monthStart('America/New_York', at('2030-03-31T12:00:00Z'))), '2030-03-01T05:00:00.000Z');
    assert.equal(iso(tz.nextMonthStart('America/New_York', at('2030-03-31T12:00:00Z'))), '2030-04-01T04:00:00.000Z');
});

test('a midnight that does not exist starts the day after the gap (America/Sao_Paulo 2018-11-04)', () => {
    // Clocks jumped 00:00 -> 01:00 that day (-03 -> -02).
    const t = at('2018-11-04T12:00:00Z');
    assert.equal(iso(tz.dayStart('America/Sao_Paulo', t)), '2018-11-04T03:00:00.000Z');
    assert.equal(tz.dayKey('America/Sao_Paulo', tz.dayStart('America/Sao_Paulo', t)), '2018-11-04');
});

test('week and month boundaries in the local calendar', () => {
    // Sunday 23:30 in New York is still the old week; 30 minutes later it is Monday.
    assert.equal(iso(tz.weekStart('America/New_York', at('2030-06-10T03:30:00Z'))), '2030-06-03T04:00:00.000Z');
    assert.equal(iso(tz.weekStart('America/New_York', at('2030-06-10T04:00:00Z'))), '2030-06-10T04:00:00.000Z');
    assert.equal(tz.periodKey('America/New_York', 'weekly', at('2030-06-10T03:30:00Z')), '2030-06-03');
    assert.equal(tz.periodKey('Asia/Kolkata', 'monthly', at('2030-05-31T19:00:00Z')), '2030-06-01');
    assert.equal(tz.periodKey('Asia/Kolkata', 'daily', at('2030-05-31T19:00:00Z')), '2030-06-01');
    assert.equal(iso(tz.nextMonthStart('UTC', at('2030-12-15T00:00:00Z'))), '2031-01-01T00:00:00.000Z');
});

test('a midnight that happens twice (Havana, clocks go back at 01:00) starts the day at the earlier one', () => {
    const noon = Date.UTC(2030, 10, 3, 12, 0, 0);
    assert.equal(tz.dayStart('America/Havana', noon).toISOString(), '2030-11-03T04:00:00.000Z');
    assert.equal(tz.nextDayStart('America/Havana', noon).toISOString(), '2030-11-04T05:00:00.000Z', 'that day lasted 25 hours');
});

test('an invalid instant is rejected instead of producing a wrong day', () => {
    assert.throws(() => tz.dayStart('Asia/Manila', NaN), RangeError);
});
