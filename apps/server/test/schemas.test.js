/** Request schemas for task details and reordering. */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET ||= 'x'.repeat(40);
const { createItemBody, updateItemBody, reorderBody, focusStartBody, focusFinishBody, createTemplateBody, jsonImportBody, moveItemBody, commentBody } = await import('../lib/schemas.js');
const { default: shared } = await import('@taskquest/shared');

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

test('focus bodies: 10 to 90 whole minutes, a numeric session id, nothing extra', () => {
    assert.equal(focusStartBody.parse({ minutes: 10 }).minutes, 10);
    assert.equal(focusStartBody.parse({ minutes: 90 }).minutes, 90);
    for (const minutes of [9, 91, 30.5, '30', undefined]) assert.throws(() => focusStartBody.parse({ minutes }), String(minutes));
    assert.throws(() => focusStartBody.parse({ minutes: 30, xp: 999 }));
    assert.equal(focusFinishBody.parse({ sessionId: 4 }).sessionId, 4);
    assert.throws(() => focusFinishBody.parse({ sessionId: 0 }));
});

test('tag limits follow the shared service (TAG_LIMITS), not a looser copy', () => {
    const { MAX_TAGS, MAX_LENGTH } = shared.TAG_LIMITS;
    const tags = (n, len = 3) => Array.from({ length: n }, (_, i) => `${i}`.padEnd(len, 'x'));
    assert.deepEqual(createItemBody.parse({ name: 'x', tags: tags(MAX_TAGS, MAX_LENGTH) }).tags, tags(MAX_TAGS, MAX_LENGTH));
    assert.throws(() => createItemBody.parse({ name: 'x', tags: tags(MAX_TAGS + 1) }), 'one tag too many');
    assert.throws(() => createItemBody.parse({ name: 'x', tags: ['x'.repeat(MAX_LENGTH + 2)] }), 'a tag that is too long');
    assert.ok(createItemBody.parse({ name: 'x', tags: [`#${'x'.repeat(MAX_LENGTH)}`] }), 'a leading # is not counted');
    assert.throws(() => createTemplateBody.parse({ name: 't', items: [{ name: 'x', tags: tags(MAX_TAGS + 1) }] }), 'templates use the same field');
    // Whatever the schema lets through as a string, the service is what decides; but the bound is no longer 200 characters.
    assert.throws(() => createItemBody.parse({ name: 'x', tags: 'x'.repeat(200) }));
    assert.ok(shared.validation.tags(tags(MAX_TAGS, MAX_LENGTH)).ok, 'the service accepts what the schema calls the maximum');
    assert.equal(shared.validation.tags(tags(MAX_TAGS + 1)).ok, false);
});

test('jsonImportBody checks the top level of an export and leaves the lists to parseImport', () => {
    const exported = { app: 'TaskQuest', version: 1, exportedAt: '2026-10-19T00:00:00.000Z', lists: [{ name: 'A', items: [{ name: 't', bogus: 1 }] }] };
    assert.deepEqual(jsonImportBody.parse(exported), exported, 'an export goes through as it is');
    assert.deepEqual(jsonImportBody.parse({ lists: [], extra: true }), { lists: [] }, 'other top-level fields are dropped, as parseImport ignores them');
    for (const body of [{}, { lists: 'x' }, { lists: [1] }, { lists: [null] }, { lists: [[]] }, { lists: [], version: 'one' }, null]) {
        assert.throws(() => jsonImportBody.parse(body), JSON.stringify(body));
    }
    const max = shared.IMPORT_LIMITS.LISTS;
    assert.ok(jsonImportBody.parse({ lists: Array.from({ length: max }, () => ({})) }));
    assert.throws(() => jsonImportBody.parse({ lists: Array.from({ length: max + 1 }, () => ({})) }), 'more lists than an import may hold');
});

test('moveItemBody: one positive whole quest id, nothing else', () => {
    assert.deepEqual(moveItemBody.parse({ listId: 7 }), { listId: 7 });
    for (const body of [{}, { listId: '7' }, { listId: 0 }, { listId: -1 }, { listId: 1.5 }, { listId: null }, { listId: 7, position: 0 }, null]) {
        assert.throws(() => moveItemBody.parse(body), JSON.stringify(body));
    }
});

test('updateItemBody: assignee is a member key or null, and creating a task takes none', () => {
    assert.deepEqual(updateItemBody.parse({ assignee: 'owner' }), { assignee: 'owner' });
    assert.deepEqual(updateItemBody.parse({ assignee: 'a1b2c3d4e5f6' }), { assignee: 'a1b2c3d4e5f6' });
    assert.deepEqual(updateItemBody.parse({ assignee: null }), { assignee: null });
    for (const assignee of [7, true, ['owner'], { key: 'owner' }, 'x'.repeat(65)]) assert.throws(() => updateItemBody.parse({ assignee }), JSON.stringify(assignee));
    assert.throws(() => createItemBody.parse({ name: 'x', assignee: 'owner' }), 'assign after creating');
});

test('commentBody: text of 1 to TEXT_LIMITS.COMMENT characters, nothing else', () => {
    const max = shared.TEXT_LIMITS.COMMENT;
    assert.equal(max, 1000);
    assert.deepEqual(commentBody.parse({ body: 'Looks good' }), { body: 'Looks good' });
    assert.equal(commentBody.parse({ body: 'x'.repeat(max) }).body.length, max);
    for (const body of [{}, { body: '' }, { body: 'x'.repeat(max + 1) }, { body: 3 }, { body: null }, { body: 'a', author: 'me' }]) {
        assert.throws(() => commentBody.parse(body), JSON.stringify(body).slice(0, 40));
    }
    assert.equal(shared.validation.comment('  hi  ').value, 'hi', 'the service trims and strips control characters');
    assert.equal(shared.validation.comment('   ').ok, false);
});
