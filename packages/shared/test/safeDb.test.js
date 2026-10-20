'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertThrowawayDatabase } = require('./helpers/safeDb');

test('the wipe guard allows throwaway databases on this machine', () => {
    assert.doesNotThrow(() => assertThrowawayDatabase({ name: 'taskquest_test', host: '127.0.0.1' }));
    assert.doesNotThrow(() => assertThrowawayDatabase({ name: 'taskquest_e2e', host: 'localhost' }));
    assert.doesNotThrow(() => assertThrowawayDatabase({ name: 'tq_TEST', host: '' }));
});

test('the wipe guard refuses a real-looking name or a remote host', () => {
    assert.throws(() => assertThrowawayDatabase({ name: 'postgres', host: '127.0.0.1' }), /must contain/);
    assert.throws(() => assertThrowawayDatabase({ name: 'taskquest', host: 'localhost' }), /must contain/);
    assert.throws(() => assertThrowawayDatabase({ name: 'taskquest_test', host: 'db.example.supabase.co' }), /localhost/);
    assert.throws(() => assertThrowawayDatabase({ name: undefined, host: '127.0.0.1' }), /must contain/);
});
