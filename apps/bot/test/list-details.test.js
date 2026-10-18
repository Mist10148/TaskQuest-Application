/**
 * /list editor: per-task fields shown in the views, the Details modal and its parsing,
 * Discord size limits, completion bonuses and the prestige title.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ui = require('../utils/ui');
const { parseDetails } = require('../commands/list');

const list = { id: 1, name: 'Home', description: null, priority: null, deadline: null, category: null };
const item = (id, over = {}) => ({ id, name: `Task ${id}`, description: null, completed: 0, parent_id: null, due_date: null, priority: null, tags: null, recurrence: null, ...over });

test('list view shows due date, priority, tags and repeat for each task', () => {
    const embed = ui.listViewEmbed(list, [item(1, { due_date: '2031-03-10', priority: 'HIGH', tags: 'home,bills', recurrence: 'weekly' })], 'view').toJSON();
    assert.match(embed.description, /Task 1/);
    assert.match(embed.description, /🔴/);
    assert.match(embed.description, /📅 Mar 10, 2031/);
    assert.match(embed.description, /🔁 weekly/);
    assert.match(embed.description, /#home #bills/);
});

test('an open task past its due date is flagged, a completed one is not', () => {
    const open = ui.itemMeta(item(1, { due_date: '2001-01-05' }));
    const done = ui.itemMeta(item(2, { due_date: '2001-01-05', completed: 1 }));
    assert.match(open, /⚠️/);
    assert.doesNotMatch(done, /⚠️/);
});

test('subtasks are indented under their parent, whatever the sort order', () => {
    const items = [item(1, { name: 'Child B', parent_id: 3 }), item(2, { name: 'Solo' }), item(3, { name: 'Parent' }), item(4, { name: 'Child A', parent_id: 3 }), item(5, { name: 'Orphan', parent_id: 99 })];
    const order = ui.orderItems(items).map((x) => `${x.nested ? '>' : ''}${x.item.name}`);
    assert.deepEqual(order, ['Solo', 'Parent', '>Child B', '>Child A', 'Orphan']);
    const desc = ui.listViewEmbed(list, items, 'edit').toJSON().description;
    assert.match(desc, /↳ ⬜ Child B/);
    assert.ok(desc.indexOf('Parent') < desc.indexOf('Child B'));
});

test('a long list stays under the 4096 character embed limit and says how many are hidden', () => {
    const items = Array.from({ length: 200 }, (_, i) => item(i + 1, { name: 'x'.repeat(100), due_date: '2031-03-10', priority: 'LOW', tags: 'a,b,c,d,e', description: 'y'.repeat(80) }));
    const embed = ui.listViewEmbed(list, items, 'view').toJSON();
    assert.ok(embed.description.length <= 4096, `description is ${embed.description.length}`);
    assert.match(embed.description, /and \d+ more tasks/);
});

test('the edit view has a Details button and every row stays within 5 buttons', () => {
    const rows = ui.editButtons(7).map((r) => r.toJSON().components);
    assert.ok(rows.length <= 5 && rows.every((r) => r.length <= 5));
    assert.ok(rows.flat().some((b) => b.custom_id === 'item_details_7'));
});

test('the Details modal has four inputs and is pre-filled from the task', () => {
    const modal = ui.detailsModal(item(9, { due_date: '2031-03-10', priority: 'MEDIUM', tags: 'a,b', recurrence: 'daily' })).toJSON();
    assert.equal(modal.custom_id, 'm_details_9');
    const inputs = modal.components.map((r) => r.components[0]);
    assert.deepEqual(inputs.map((i) => i.custom_id), ['due', 'priority', 'tags', 'repeat']);
    assert.deepEqual(inputs.map((i) => i.value), ['2031-03-10', 'med', 'a, b', 'daily']);
    assert.ok(inputs.every((i) => i.required === false));
    assert.ok(modal.title.length <= 45);
    assert.equal(ui.detailsModal(item(1, { name: 'z'.repeat(200) })).toJSON().title.length <= 45, true);
});

test('parseDetails maps what people type to updateItem fields', () => {
    const get = (v) => (name) => v[name];
    assert.deepEqual(parseDetails(get({ due: ' 2031-03-10 ', priority: 'Med', tags: 'a, b', repeat: 'Weekly' })), { due_date: '2031-03-10', priority: 'MEDIUM', tags: 'a, b', recurrence: 'weekly' });
    assert.deepEqual(parseDetails(get({ due: '', priority: '', tags: '', repeat: 'none' })), { due_date: null, priority: '', tags: null, recurrence: null });
    assert.equal(parseDetails(get({ priority: 'h' })).priority, 'HIGH');
    assert.equal(parseDetails(get({ priority: 'urgent' })).priority, 'urgent', 'left for the shared validation to reject');
});

test('completion bonuses, achievement rewards and prestige titles render', () => {
    assert.equal(ui.bonusLines([]), '');
    assert.equal(ui.bonusLines(undefined), '');
    const lines = ui.bonusLines([{ key: 'early_finish', label: 'Finished early', xp: 5 }, { key: 'x', label: 'None', xp: 0 }]);
    assert.match(lines, /Finished early: \+5 XP/);
    assert.doesNotMatch(lines, /None/);
    assert.match(ui.achievementUnlockEmbed({ name: 'A', description: 'd', xp: 25 }).toJSON().description, /\+25 XP/);
    assert.doesNotMatch(ui.achievementUnlockEmbed({ name: 'A', description: 'd' }).toJSON().description, /XP/);
    assert.equal(ui.prestigeTitle({ prestige: 0 }), '');
    assert.equal(ui.prestigeTitle({ prestige: 1 }), 'Veteran');
    assert.equal(ui.prestigeTitle({ prestige: 99 }), 'Eternal');
});

test('a priority word that is an inherited property name is passed through, not mapped', () => {
    const get = (fields) => (k) => fields[k];
    for (const word of ['constructor', 'toString', '__proto__']) {
        assert.equal(parseDetails(get({ priority: word })).priority, word.toLowerCase());
    }
});

test('paging the list select keeps the sort, filter and category row of the message', async () => {
    const db = require('@taskquest/shared/db');
    const { overviewViewOf, handleSelectMenu } = require('../commands/list');
    const message = {
        embeds: [{ footer: { text: 'Sorted: name • Filter: Current' } }],
        components: [{ components: [{ customId: 'filter_category' }] }]
    };
    assert.deepEqual(overviewViewOf(message), { sort: 'name', filter: 'Current', withCategoryFilter: true });
    assert.deepEqual(overviewViewOf({ embeds: [{ footer: { text: 'Select a list to view' } }], components: [] }), { sort: '', filter: '', withCategoryFilter: false });

    const asked = [];
    const realGetLists = db.tasks.getLists;
    db.tasks.getLists = async (userId, opts) => {
        asked.push(opts);
        return Array.from({ length: 30 }, (_, n) => ({ id: n + 1, name: `L${n}`, category: null, items_total: 0, items_completed: 0 }));
    };
    try {
        const sent = [];
        await handleSelectMenu({
            customId: 'sel_list',
            values: ['__page_1'],
            user: { id: '1' },
            message: { ...message, interaction: { user: { id: '1' } } },
            update: async (p) => void sent.push(p)
        });
        assert.deepEqual(asked[0], { sortBy: 'name', order: 'ASC' });
        assert.match(sent[0].embeds[0].toJSON().footer.text, /Sorted: name • Filter: Current/);
        assert.equal(sent[0].components[0].toJSON().components[0].custom_id, 'filter_category');
    } finally {
        db.tasks.getLists = realGetLists;
    }
});

test('the lists overview stays under the embed limit for a user with hundreds of lists', () => {
    const lists = Array.from({ length: 200 }, (_, i) => ({
        name: `Quest number ${i} ${'x'.repeat(40)}`,
        priority: 'HIGH',
        category: 'Work',
        deadline: '2030-05-05',
        shared: false
    }));
    const embed = ui.listsOverviewEmbed(lists);
    const text = embed.toJSON().description;
    assert.ok(text.length <= 4096);
    assert.match(text, /…and \d+ more/);
    const few = ui.listsOverviewEmbed(lists.slice(0, 3)).toJSON().description;
    assert.doesNotMatch(few, /more\./);
});

test('sharing autocomplete offers a shared list that shares a name with your own by id', () => {
    const { autocompleteChoices } = require('../commands/sharing');
    const lists = [
        { id: 1, name: 'Work', is_owner: true, shared: false },
        { id: 2, name: 'Work', is_owner: false, shared: true, owner_name: 'bob' },
        { id: 3, name: 'Home', is_owner: false, shared: true, owner_name: 'amy' }
    ];
    const leave = autocompleteChoices(lists, (l) => !l.is_owner, '');
    assert.deepEqual(leave, [
        { name: 'Work (by bob)', value: '#2' },
        { name: 'Home', value: 'Home' }
    ]);
    const share = autocompleteChoices(lists, () => true, 'wor');
    assert.deepEqual(share.map((c) => c.value), ['#1', '#2']);
});
