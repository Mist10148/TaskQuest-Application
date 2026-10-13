'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskQuestError, errors } = require('../src/errors');

test('each factory sets a stable code and the HTTP status the API maps it to', () => {
    const cases = [
        [errors.validation('x'), 'VALIDATION', 400],
        [errors.notFound(), 'NOT_FOUND', 404],
        [errors.conflict('x'), 'CONFLICT', 409],
        [errors.forbidden('x'), 'FORBIDDEN', 403],
        [errors.insufficientXP(10, 3), 'INSUFFICIENT_XP', 400],
        [errors.gamificationDisabled(), 'GAMIFICATION_DISABLED', 403],
        [errors.cooldown(500), 'COOLDOWN', 429]
    ];
    for (const [err, code, status] of cases) {
        assert.ok(err instanceof TaskQuestError && err instanceof Error);
        assert.deepEqual([err.name, err.code, err.status], ['TaskQuestError', code, status]);
    }
});

test('details are attached only when given', () => {
    assert.deepEqual(errors.insufficientXP(10, 3).details, { needed: 10, balance: 3 });
    assert.deepEqual(errors.cooldown(500).details, { retryAfterMs: 500 });
    assert.equal('details' in errors.validation('x'), false);
    assert.match(errors.insufficientXP(10, 3).message, /need 10, have 3/);
});
