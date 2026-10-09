/**
 * /list — view and manage lists.
 *
 *   LIST_OVERVIEW → LIST_VIEW (read-only: sort, search)
 *                 → LIST_EDIT (all mutations)
 *
 * Every lookup and mutation goes through @taskquest/shared/db tasks
 * services, which only ever match rows owned by the clicking user. A
 * button on someone else's (public) list message therefore just reports
 * "not found" instead of acting on their data.
 */

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { tasks, users } = require('@taskquest/shared/db');
const ui = require('../utils/ui');
const aiSync = require('../utils/aiSync');
const { EPHEMERAL, handleError, sendRewards, idFrom } = require('../utils/respond');

/** Pending two-step reorder selections: `${userId}_${listId}` → first item id. */
const swapState = new Map();

const data = new SlashCommandBuilder()
    .setName('list')
    .setDescription('📋 View and manage your lists')
    .addStringOption((opt) => opt.setName('name').setDescription('List name').setAutocomplete(true).setMaxLength(100));

// ─── Rendering helpers ───────────────────────────────────────────────────────

function overviewComponents(lists, { withCategoryFilter = false } = {}) {
    const components = [];
    if (withCategoryFilter) components.push(ui.categoryFilterSelect());
    const sel = ui.listSelect(lists);
    if (sel) components.push(sel);
    components.push(...ui.overviewButtons());
    return components.slice(0, 5);
}

async function renderList(userId, listId, mode) {
    const list = await tasks.getList(userId, listId);
    if (!list) return null;
    const items = await tasks.getItems(userId, listId);
    return {
        embeds: [ui.listViewEmbed(list, items, mode)],
        components: mode === 'edit' ? ui.editButtons(list.id) : ui.viewButtons(list.id)
    };
}

const denied = (interaction) => interaction.reply({ embeds: [ui.error('Not found', 'That list no longer exists or is not yours.')], ...EPHEMERAL });

function metaEditComponents(listId, done = false) {
    const buttons = [new ButtonBuilder().setCustomId(`rename_${listId}`).setLabel('Edit Name/Desc/Deadline').setStyle(done ? ButtonStyle.Secondary : ButtonStyle.Primary)];
    if (done) buttons.push(new ButtonBuilder().setCustomId(`metadone_${listId}`).setLabel('Done').setEmoji('✅').setStyle(ButtonStyle.Success));
    return [ui.catSelect(`cat_${listId}`), ui.priSelect(`pri_${listId}`), new ActionRowBuilder().addComponents(...buttons)];
}

const isExpired = (list) => Boolean(list.deadline) && list.deadline < new Date().toISOString().slice(0, 10);

// ─── Slash command ───────────────────────────────────────────────────────────

async function execute(interaction) {
    const userId = interaction.user.id;
    await users.ensureUser(userId);
    const name = interaction.options.getString('name');

    if (name) {
        const list = await tasks.getListByName(userId, name);
        if (!list) return interaction.reply({ embeds: [ui.error('Not Found', 'List not found.')], ...EPHEMERAL });
        return interaction.reply(await renderList(userId, list.id, 'view'));
    }

    const lists = await tasks.getLists(userId);
    return interaction.reply({ embeds: [ui.listsOverviewEmbed(lists)], components: overviewComponents(lists) });
}

async function autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'name') return interaction.respond([]);
    const q = String(focused.value || '').toLowerCase();
    const lists = await tasks.getLists(interaction.user.id, { sortBy: 'name', order: 'ASC' });
    return interaction.respond(
        lists
            .filter((l) => l.name.toLowerCase().includes(q))
            .slice(0, 25)
            .map((l) => ({ name: l.name.slice(0, 100), value: l.name.slice(0, 100) }))
    );
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

async function handleButton(interaction) {
    try {
        return await routeButton(interaction);
    } catch (err) {
        return handleError(interaction, err);
    }
}

async function routeButton(interaction) {
    const id = interaction.customId;
    const userId = interaction.user.id;

    // LIST_OVERVIEW
    if (id === 'sort_az' || id === 'sort_date' || id === 'sort_pri') {
        const sortBy = id === 'sort_az' ? 'name' : id === 'sort_date' ? 'created_at' : 'priority';
        const lists = await tasks.getLists(userId, { sortBy, order: id === 'sort_az' ? 'ASC' : 'DESC' });
        return interaction.update({ embeds: [ui.listsOverviewEmbed(lists, sortBy)], components: overviewComponents(lists) });
    }
    if (id === 'filter_cat') {
        const lists = await tasks.getLists(userId);
        return interaction.update({ embeds: [ui.listsOverviewEmbed(lists, 'category')], components: overviewComponents(lists, { withCategoryFilter: true }) });
    }
    if (['filter_all', 'filter_current', 'filter_expired', 'filter_completed', 'back'].includes(id)) {
        let lists = await tasks.getLists(userId);
        let label = '';
        if (id === 'filter_all') label = 'All';
        if (id === 'filter_current') (label = 'Current'), (lists = lists.filter((l) => !isExpired(l)));
        if (id === 'filter_expired') (label = 'Expired'), (lists = lists.filter(isExpired));
        if (id === 'filter_completed') (label = 'Completed'), (lists = lists.filter((l) => l.items_total > 0 && l.items_completed === l.items_total));
        return interaction.update({ embeds: [ui.listsOverviewEmbed(lists, '', label)], components: overviewComponents(lists) });
    }
    if (id === 'create') return interaction.showModal(ui.listModal());

    // LIST_VIEW (read-only)
    const viewSorts = { sort_az_: ['name', 'ASC'], sort_za_: ['name', 'DESC'], sort_pri_: ['completed', 'ASC'] };
    for (const [prefix, [sortBy, order]] of Object.entries(viewSorts)) {
        if (id.startsWith(prefix)) {
            const listId = idFrom(id, prefix);
            const list = listId && (await tasks.getList(userId, listId));
            if (!list) return denied(interaction);
            const items = await tasks.getItems(userId, listId, { sortBy, order });
            return interaction.update({ embeds: [ui.listViewEmbed(list, items, 'view')], components: ui.viewButtons(listId) });
        }
    }
    if (id.startsWith('search_')) return interaction.showModal(ui.searchModal());

    for (const [prefix, mode] of [['refresh_', 'view'], ['view_', 'view'], ['edit_', 'edit'], ['metadone_', 'edit']]) {
        if (id.startsWith(prefix)) {
            const view = await renderList(userId, idFrom(id, prefix), mode);
            if (!view) return denied(interaction);
            return interaction.update(view);
        }
    }

    // LIST_EDIT — item operations
    if (id.startsWith('item_add_')) {
        const list = await tasks.getList(userId, idFrom(id, 'item_add_'));
        if (!list) return denied(interaction);
        return interaction.showModal(ui.itemModal(list.id));
    }

    const pickers = {
        item_edit_: ['sel_edit_', 'Edit Item', 1],
        item_del_: ['sel_del_', 'Delete Item', 1],
        item_done_: ['sel_done_', 'Toggle Status', 1],
        item_desc_: ['sel_desc_', 'Edit Description', 1],
        item_swap_: ['sel_swap1_', 'Reorder — select the FIRST item', 2]
    };
    for (const [prefix, [selectId, title, min]] of Object.entries(pickers)) {
        if (id.startsWith(prefix)) {
            const listId = idFrom(id, prefix);
            const items = listId ? await tasks.getItems(userId, listId) : null;
            if (!items) return denied(interaction);
            if (items.length < min) {
                return interaction.reply({ embeds: [ui.info('Not enough tasks', min > 1 ? 'You need at least 2 tasks.' : 'This list has no tasks.')], ...EPHEMERAL });
            }
            return interaction.reply({ embeds: [ui.info(title, 'Select a task:')], components: [ui.itemSelect(items, `${selectId}${listId}`)], ...EPHEMERAL });
        }
    }

    // LIST_EDIT — list metadata
    if (id.startsWith('list_meta_')) {
        const list = await tasks.getList(userId, idFrom(id, 'list_meta_'));
        if (!list) return denied(interaction);
        return interaction.reply({
            embeds: [ui.info('Edit List Info', 'Choose category/priority or edit name/description/deadline:')],
            components: metaEditComponents(list.id),
            ...EPHEMERAL
        });
    }
    if (id.startsWith('rename_')) {
        const list = await tasks.getList(userId, idFrom(id, 'rename_'));
        if (!list) return denied(interaction);
        return interaction.showModal(ui.listModal(list));
    }

    // LIST_EDIT — delete with confirmation
    if (id.startsWith('list_del_')) {
        const list = await tasks.getList(userId, idFrom(id, 'list_del_'));
        if (!list) return denied(interaction);
        return interaction.reply({ embeds: [ui.warn('Confirm Delete', `Delete **${list.name}** and all its tasks?`)], components: [ui.confirmButtons(list.id)], ...EPHEMERAL });
    }
    if (id.startsWith('yes_')) {
        const list = await tasks.getList(userId, idFrom(id, 'yes_'));
        if (!list) return interaction.update({ embeds: [ui.error('Not found')], components: [] });
        await tasks.deleteList(userId, list.id);
        aiSync.forget(userId, list.id);
        return interaction.update({ embeds: [ui.success('Deleted', `**${list.name}** deleted`)], components: [] });
    }
    if (id.startsWith('no_')) return interaction.update({ embeds: [ui.info('Cancelled', 'Delete cancelled')], components: [] });
}

// ─── Select menus ────────────────────────────────────────────────────────────

async function handleSelectMenu(interaction) {
    try {
        return await routeSelect(interaction);
    } catch (err) {
        return handleError(interaction, err);
    }
}

async function routeSelect(interaction) {
    const id = interaction.customId;
    const userId = interaction.user.id;
    const val = interaction.values[0];

    if (id === 'filter_category') {
        let lists = await tasks.getLists(userId);
        if (val === 'NONE') lists = lists.filter((l) => !l.category);
        else if (val !== 'ALL') lists = lists.filter((l) => l.category === val);
        const label = val === 'ALL' ? 'All Categories' : val === 'NONE' ? 'Uncategorized' : val;
        return interaction.update({ embeds: [ui.listsOverviewEmbed(lists, `category: ${label}`)], components: overviewComponents(lists, { withCategoryFilter: true }) });
    }

    if (id === 'sel_list') {
        const view = await renderList(userId, Number(val), 'view');
        if (!view) return denied(interaction);
        return interaction.update(view);
    }

    if (id.startsWith('cat_') || id.startsWith('pri_')) {
        const isCat = id.startsWith('cat_');
        const listId = idFrom(id, isCat ? 'cat_' : 'pri_');
        const value = val === 'NONE' ? null : val;
        const list = await tasks.updateList(userId, listId, isCat ? { category: value } : { priority: value });
        aiSync.reindex(userId, listId);
        return interaction.update({
            embeds: [
                ui.info(
                    'Edit List Info',
                    `✅ ${isCat ? 'Category' : 'Priority'} set to: **${value || 'None'}**\n\n` +
                        `Current: 📁 ${list.category || 'None'} • ${list.priority || 'No priority'}\n\nSelect another option or click Done.`
                )
            ],
            components: metaEditComponents(listId, true)
        });
    }

    if (id.startsWith('sel_edit_') || id.startsWith('sel_desc_')) {
        const item = await tasks.getItem(userId, val);
        if (!item) return interaction.update({ embeds: [ui.error('Not Found')], components: [] });
        return interaction.showModal(id.startsWith('sel_edit_') ? ui.editItemModal(item) : ui.descModal(item));
    }

    if (id.startsWith('sel_del_')) {
        const item = await tasks.getItem(userId, val);
        if (!item) return interaction.update({ embeds: [ui.error('Not Found')], components: [] });
        await tasks.deleteItem(userId, item.id);
        aiSync.reindex(userId, item.list_id);
        return interaction.update({ embeds: [ui.success('Deleted', `**${item.name}** deleted`)], components: [] });
    }

    if (id.startsWith('sel_done_')) {
        await interaction.deferUpdate();
        const result = await tasks.setItemCompleted(userId, val);
        aiSync.reindex(userId, result.item?.list_id);
        const note = result.completed && !result.firstCompletion ? '\n-# XP is only awarded the first time a task is completed.' : '';
        await interaction.editReply({
            embeds: [ui.success(result.completed ? '✅ Completed' : '⬜ Uncompleted', `**${result.item.name}**${note}`)],
            components: []
        });
        return sendRewards(interaction, result);
    }

    if (id.startsWith('sel_swap1_')) {
        const listId = idFrom(id, 'sel_swap1_');
        const items = await tasks.getItems(userId, listId);
        if (!items) return interaction.update({ embeds: [ui.error('Not found')], components: [] });
        swapState.set(`${userId}_${listId}`, Number(val));
        return interaction.update({
            embeds: [ui.info('Reorder', 'Select the SECOND task:')],
            components: [ui.itemSelect(items.filter((i) => i.id !== Number(val)), `sel_swap2_${listId}`)]
        });
    }

    if (id.startsWith('sel_swap2_')) {
        const listId = idFrom(id, 'sel_swap2_');
        const firstId = swapState.get(`${userId}_${listId}`);
        swapState.delete(`${userId}_${listId}`);
        if (!firstId) return interaction.update({ embeds: [ui.error('Expired', 'Start the reorder again.')], components: [] });
        await tasks.swapItemPositions(userId, firstId, val);
        aiSync.reindex(userId, listId);
        return interaction.update({ embeds: [ui.success('Swapped', 'Positions swapped')], components: [] });
    }
}

// ─── Modals ──────────────────────────────────────────────────────────────────

async function handleModal(interaction) {
    try {
        return await routeModal(interaction);
    } catch (err) {
        return handleError(interaction, err);
    }
}

const field = (interaction, name) => {
    try {
        return interaction.fields.getTextInputValue(name);
    } catch {
        return undefined;
    }
};

async function routeModal(interaction) {
    const id = interaction.customId;
    const userId = interaction.user.id;

    if (id === 'm_newlist') {
        const result = await tasks.createList(userId, {
            name: field(interaction, 'name'),
            description: field(interaction, 'desc'),
            deadline: field(interaction, 'deadline')
        });
        aiSync.reindex(userId, result.list.id);
        await interaction.reply({
            embeds: [ui.success('Created!', `**${result.list.name}**\nPick a category and priority below (optional).`)],
            components: [ui.catSelect(`cat_${result.list.id}`), ui.priSelect(`pri_${result.list.id}`)],
            ...EPHEMERAL
        });
        return sendRewards(interaction, result);
    }

    if (id.startsWith('m_editlist_')) {
        const list = await tasks.updateList(userId, idFrom(id, 'm_editlist_'), {
            name: field(interaction, 'name'),
            description: field(interaction, 'desc'),
            deadline: field(interaction, 'deadline')
        });
        aiSync.reindex(userId, list.id);
        return interaction.reply({ embeds: [ui.success('Updated', `**${list.name}**`)], ...EPHEMERAL });
    }

    if (id.startsWith('m_additem_')) {
        const listId = idFrom(id, 'm_additem_');
        const result = await tasks.addItem(userId, listId, { name: field(interaction, 'name'), description: field(interaction, 'desc') });
        aiSync.reindex(userId, listId);
        await interaction.reply({ ...(await renderList(userId, listId, 'edit')), ...EPHEMERAL });
        return sendRewards(interaction, result);
    }

    if (id.startsWith('m_edititem_')) {
        const item = await tasks.updateItem(userId, idFrom(id, 'm_edititem_'), { name: field(interaction, 'name') });
        aiSync.reindex(userId, item?.list_id);
        return interaction.reply({ embeds: [ui.success('Updated', `**${item.name}**`)], ...EPHEMERAL });
    }

    if (id.startsWith('m_desc_')) {
        const desc = field(interaction, 'desc');
        const item = await tasks.updateItem(userId, idFrom(id, 'm_desc_'), { description: desc || null });
        aiSync.reindex(userId, item?.list_id);
        return interaction.reply({ embeds: [ui.success('Updated', desc ? 'Description saved' : 'Description cleared')], ...EPHEMERAL });
    }

    if (id === 'm_search') {
        const q = (field(interaction, 'q') || '').trim();
        const lists = await tasks.searchLists(userId, q);
        if (!lists.length) return interaction.reply({ embeds: [ui.info('No Results', `Nothing found for "${q.slice(0, 100)}"`)], ...EPHEMERAL });
        const sel = ui.listSelect(lists);
        return interaction.reply({ embeds: [ui.listsOverviewEmbed(lists, `Search: ${q.slice(0, 100)}`)], components: sel ? [sel] : [], ...EPHEMERAL });
    }
}

module.exports = { data, execute, autocomplete, handleButton, handleSelectMenu, handleModal };
