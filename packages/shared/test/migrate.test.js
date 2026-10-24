'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { migrationWarnings, checksumOf, loadMigrations } = require('../src/db/migrate');

const m1 = { id: '001_a', up: async () => 'one' };
const m2 = { id: '002_b', up: async () => 'two' };

test('checksumOf: stable for one migration, different for different code', () => {
    assert.equal(checksumOf(m1), checksumOf(m1));
    assert.notEqual(checksumOf(m1), checksumOf(m2));
    assert.match(checksumOf(m1), /^[0-9a-f]{32}$/);
});

test('migrationWarnings: nothing to say when everything matches or has no checksum yet', () => {
    assert.deepEqual(migrationWarnings([m1, m2], [{ id: '001_a', checksum: checksumOf(m1) }, { id: '002_b', checksum: null }]), []);
    assert.deepEqual(migrationWarnings([m1, m2], []), []);
});

test('migrationWarnings: an unknown applied id and an edited migration are reported', () => {
    const notes = migrationWarnings([m1], [{ id: '001_a', checksum: 'deadbeef' }, { id: '009_future', checksum: 'x' }]);
    assert.equal(notes.length, 2);
    assert.match(notes[0], /001_a was changed/);
    assert.match(notes[1], /009_future.*does not know/);
});

test('every shipped migration has an id and an up function', () => {
    for (const m of loadMigrations()) {
        assert.equal(typeof m.id, 'string');
        assert.equal(typeof m.up, 'function');
    }
});
