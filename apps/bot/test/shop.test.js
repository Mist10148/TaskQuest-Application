/** /shop rendering. The buy and equip flows themselves are covered by the shared db tests. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const shop = require('../commands/shop');

const ids = (payload) => payload.components.flatMap((r) => r.toJSON().components.map((c) => c.custom_id));
const embed = (payload) => payload.embeds[0].toJSON();

const item = (over = {}) => ({ id: 'title_diligent', kind: 'title', name: 'the Diligent', cost: 300, owned: false, equipped: false, locked: false, lockedReason: null, affordable: true, ...over });
const state = (items, balance = 500) => ({ balance, items, equipped: { title: null, frame: null, accent: null }, gamificationEnabled: true });

test('/shop lists one section with tabs and a picker', () => {
    const s = state([item(), item({ id: 'title_reborn', name: 'the Reborn', cost: 2000, locked: true, lockedReason: 'Prestige once', affordable: false }), item({ id: 'frame_bronze', kind: 'frame', name: 'Bronze ring' })]);
    const view = shop.renderList(s, 'title');
    assert.deepEqual(ids(view), ['shop_tab_title', 'shop_tab_frame', 'shop_tab_accent', 'shop_pick_title']);
    const text = embed(view).description;
    assert.match(text, /500 XP/);
    assert.match(text, /the Diligent\*\*: 300 XP/);
    assert.match(text, /Prestige once/);
    assert.ok(!text.includes('Bronze ring'), 'only the chosen section');
    const options = view.components[1].toJSON().components[0].options.map((o) => o.value);
    assert.deepEqual(options, ['title_diligent', 'title_reborn']);
    assert.match(embed(shop.renderList(s, 'nonsense')).title, /Titles/, 'an unknown section falls back to titles');
});

test('the detail screen offers exactly the action that applies', () => {
    const s = state([]);
    assert.deepEqual(ids(shop.renderDetail(s, item())), ['shop_buy_title_diligent', 'shop_tab_title']);
    assert.match(embed(shop.renderDetail(s, item())).description, /Balance after: \*\*200 XP\*\*/);
    const poor = shop.renderDetail(state([], 100), item({ affordable: false }));
    assert.equal(poor.components[0].toJSON().components[0].disabled, true);
    assert.match(embed(poor).description, /200\*\* more XP/);
    assert.deepEqual(ids(shop.renderDetail(s, item({ owned: true }))), ['shop_equip_title_diligent', 'shop_tab_title']);
    assert.deepEqual(ids(shop.renderDetail(s, item({ owned: true, equipped: true }))), ['shop_unequip_title', 'shop_tab_title']);
    assert.deepEqual(ids(shop.renderDetail(s, item({ locked: true, lockedReason: 'Reach level 20', affordable: false }))), ['shop_tab_title']);
});
