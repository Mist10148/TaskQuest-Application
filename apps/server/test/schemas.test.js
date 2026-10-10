/** Request schemas for task details and reordering. */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET ||= 'x'.repeat(40);
const { createItemBody, updateItemBody, reorderBody } = await import('../lib/schemas.js');

test('createItemBody accepts the per-task fields and normalises empties to null', () => {
    const body = createItemBody.parse({ name: 'Pay rent', due_date: '', priority: 'HIGH', tags: ['home', 'bills'], recurrence: 'monthly', parent_id: null });
    assert.equal(body.due_date, null);
    assert.equal(body.priority, 'HIGH');
    assert.deepEqual(body.tags, ['home', 'bills']);
    assert.throws(() => createItemBody.parse({ name: 'x', due_date: '5 May' }));
    assert.throws(() => createItemBody.parse({ name: 'x', recurrence: 'hourly' }));
    assert.throws(() => createItemBody.parse({ name: 'x', surprise: true }), 'unknown fields stay rejected');
});

test('updateItemBody needs at least one field', () => {
    assert.throws(() => updateItemBody.parse({}));
    assert.deepEqual(updateItemBody.parse({ priority: 'LOW' }), { priority: 'LOW' });
});

test('reorderBody wants a list of ids', () => {
    assert.deepEqual(reorderBody.parse({ itemIds: [3, 1, 2] }).itemIds, [3, 1, 2]);
    assert.throws(() => reorderBody.parse({ itemIds: [0] }));
    assert.throws(() => reorderBody.parse({}));
});
