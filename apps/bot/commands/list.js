/**
 * /list — view and manage lists.
 *
 *   LIST_OVERVIEW → LIST_VIEW (read-only: sort, search)
 *                 → LIST_EDIT (all mutations)
 *
 * Every lookup and mutation goes through @taskquest/shared/db tasks
 * services, which only ever match lists the clicking user owns or is a member
 * of (and check their role). A button on someone else's (public) list message
 * is also refused up front (notOwner), and otherwise just reports "not found"
 * instead of acting on their data.
 *
 * Shared lists show 👥 and the viewer's role; a viewer gets a read-only view and
 * no Edit button, an editor no list settings, and only the owner can delete.
 */

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { tasks, users } = require('@taskquest/shared/db');
const { isPastDeadline, todayInZone, escapeDiscord } = require('@taskquest/shared');
const ui = require('../utils/ui');
const aiSync = require('../utils/aiSync');
const { autocompleteChoices, findList } = require('../utils/listChoice');
const { EPHEMERAL, handleError, sendRewards, idFrom } = require('../utils/respond');

const data = new SlashCommandBuilder()
    .setName('list')
    .setDescription('📋 View and manage your lists')
    .addStringOption((opt) => opt.setName('name').setDescription('List name').setAutocomplete(true).setMaxLength(100));

// ─── Rendering helpers ───────────────────────────────────────────────────────

function overviewComponents(lists, { withCategoryFilter = false, page = 0 } = {}) {
    const components = [];
    if (withCategoryFilter) components.push(ui.categoryFilterSelect());
    const sel = ui.listSelect(lists, 'sel_list', { page, paged: true });
    if (sel) components.push(sel);
    components.push(...ui.overviewButtons());
    return components.slice(0, 5);
}

/** A viewer of a shared list never gets edit mode, whatever button was pressed. */
const canEdit = (list) => list.role !== 'viewer';

/** The user's own date, so "overdue" and "expired" agree with the web app and the reminders, not with UTC. */
const todayFor = async (userId) => todayInZone((await users.getUser(userId))?.timezone);

async function renderList(userId, listId, mode) {
    const list = await tasks.getList(userId, listId);
    if (!list) return null;
    const items = await tasks.getItems(userId, listId);
    const shown = mode === 'edit' && !canEdit(list) ? 'view' : mode;
    return {
        embeds: [ui.listViewEmbed(list, items, shown, null, await todayFor(userId))],
        components: shown === 'edit' ? ui.editButtons(list.id, { role: list.role, isOwner: list.is_owner }) : ui.viewButtons(list.id, { canEdit: canEdit(list) })
    };
}

/** A name for a reply: on a shared list another member wrote it, so it must not render as a masked link or markup. */
const safe = (name) => escapeDiscord(name, { max: 200 });

const viewOnly = (interaction) => interaction.reply({ embeds: [ui.error('View only', 'You only have view access to this list.')], ...EPHEMERAL });

const denied = (interaction) => interaction.reply({ embeds: [ui.error('Not found', 'That list no longer exists, or you no longer have access to it.')], ...EPHEMERAL });

function metaEditComponents(listId, done = false) {
    const buttons = [new ButtonBuilder().setCustomId(`rename_${listId}`).setLabel('Edit Name/Desc/Deadline').setStyle(done ? ButtonStyle.Secondary : ButtonStyle.Primary)];
    if (done) buttons.push(new ButtonBuilder().setCustomId(`metadone_${listId}`).setLabel('Done').setEmoji('✅').setStyle(ButtonStyle.Success));
    return [ui.catSelect(`cat_${listId}`), ui.priSelect(`pri_${listId}`), new ActionRowBuilder().addComponents(...buttons)];
}

/**
 * True when the clicked message belongs to a different user. /list overviews
 * are public, so without this a click from anyone else would `update` the
 * shared message with the clicker's own lists.
 */
function notOwner(interaction) {
    const m = interaction.message;
    const owner = m?.interactionMetadata?.user?.id ?? m?.interaction?.user?.id;
    return Boolean(owner) && owner !== interaction.user.id;
}

const rejectNotOwner = (interaction) =>
    interaction.reply({ embeds: [ui.error("This isn't your list view", 'Run **/list** to open your own.')], ...EPHEMERAL });

const isExpired = (list, today) => isPastDeadline(list.deadline, today);

// ─── Slash command ───────────────────────────────────────────────────────────

async function execute(interaction) {
    const userId = interaction.user.id;
    // The view is public; acknowledge first so the database reads below cannot miss Discord's 3 second window.
    await interaction.deferReply();
    await users.ensureUser(userId);
    const name = interaction.options.getString('name');

    if (name) {
        const list = await findList(userId, name);
        if (!list) {
            // Only the person who asked needs to see this: swap the public placeholder for a private note.
            await interaction.deleteReply().catch(() => {});
            return interaction.followUp({ embeds: [ui.error('Not Found', 'List not found.')], ...EPHEMERAL });
        }
        const view = await renderList(userId, list.id, 'view');
        if (!view) {
            await interaction.deleteReply().catch(() => {});
            return interaction.followUp({ embeds: [ui.error('Not Found', 'List not found.')], ...EPHEMERAL });
        }
        return interaction.editReply(view);
    }

    const lists = await tasks.getLists(userId);
    return interaction.editReply({ embeds: [ui.listsOverviewEmbed(lists, '', '', await todayFor(userId))], components: overviewComponents(lists) });
}

async function autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'name') return interaction.respond([]);
    const q = String(focused.value || '').toLowerCase();
    const lists = await tasks.getLists(interaction.user.id, { sortBy: 'name', order: 'ASC' });
    return interaction.respond(autocompleteChoices(lists, () => true, q));
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

async function handleButton(interaction) {
    try {
        if (notOwner(interaction)) return await rejectNotOwner(interaction);
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
        return interaction.update({ embeds: [ui.listsOverviewEmbed(lists, sortBy, '', await todayFor(userId))], components: overviewComponents(lists) });
    }
    if (id === 'filter_cat') {
        const lists = await tasks.getLists(userId);
        return interaction.update({ embeds: [ui.listsOverviewEmbed(lists, 'category', '', await todayFor(userId))], components: overviewComponents(lists, { withCategoryFilter: true }) });
    }
    if (['filter_all', 'filter_current', 'filter_expired', 'filter_completed', 'back'].includes(id)) {
        let lists = await tasks.getLists(userId);
        const today = await todayFor(userId);
        let label = '';
        if (id === 'filter_all') label = 'All';
        if (id === 'filter_current') (label = 'Current'), (lists = lists.filter((l) => !isExpired(l, today)));
        if (id === 'filter_expired') (label = 'Expired'), (lists = lists.filter((l) => isExpired(l, today)));
        if (id === 'filter_completed') (label = 'Completed'), (lists = lists.filter((l) => l.items_total > 0 && l.items_completed === l.items_total));
        return interaction.update({ embeds: [ui.listsOverviewEmbed(lists, '', label, today)], components: overviewComponents(lists) });
    }
    if (id === 'create') return interaction.showModal(ui.listModal());

    // LIST_VIEW (read-only)
    const viewSorts = { sort_az_: ['name', 'ASC'], sort_za_: ['name', 'DESC'], sort_pri_: ['priority', 'DESC'] };
    for (const [prefix, [sortBy, order]] of Object.entries(viewSorts)) {
        if (id.startsWith(prefix)) {
            const listId = idFrom(id, prefix);
            const list = listId && (await tasks.getList(userId, listId));
            if (!list) return denied(interaction);
            const items = await tasks.getItems(userId, listId, { sortBy, order });
            return interaction.update({ embeds: [ui.listViewEmbed(list, items, 'view', null, await todayFor(userId))], components: ui.viewButtons(listId, { canEdit: canEdit(list) }) });
        }
    }
    if (id.startsWith('search_')) return interaction.showModal(ui.searchModal());

    for (const [prefix, mode] of [['refresh_', 'view'], ['view_', 'view'], ['edit_', 'edit'], ['metadone_', 'edit']]) {
        if (id.startsWith(prefix)) {
            if (mode === 'edit') {
                const target = await tasks.getList(userId, idFrom(id, prefix));
                if (!target) return denied(interaction);
                if (!canEdit(target)) return viewOnly(interaction);
            }
            const view = await renderList(userId, idFrom(id, prefix), mode);
            if (!view) return denied(interaction);
            return interaction.update(view);
        }
    }

    // LIST_EDIT — item operations
    if (id.startsWith('item_add_')) {
        const list = await tasks.getList(userId, idFrom(id, 'item_add_'));
        if (!list) return denied(interaction);
        if (!canEdit(list)) return viewOnly(interaction);
        return interaction.showModal(ui.itemModal(list.id));
    }

    const pickers = {
        item_edit_: ['sel_edit_', 'Edit Item', 1],
        item_del_: ['sel_del_', 'Delete Item', 1],
        item_done_: ['sel_done_', 'Toggle Status', 1],
        item_desc_: ['sel_desc_', 'Edit Description', 1],
        item_details_: ['sel_details_', 'Edit Details (due date, priority, tags, repeat)', 1],
        item_swap_: ['sel_swap1_', 'Reorder — select the FIRST item', 2]
    };
    for (const [prefix, [selectId, title, min]] of Object.entries(pickers)) {
        if (id.startsWith(prefix)) {
            const listId = idFrom(id, prefix);
            const items = listId ? await tasks.getItems(userId, listId) : null;
            if (!items) return denied(interaction);
            const pickedList = await tasks.getList(userId, listId);
            if (!pickedList) return denied(interaction); // deleted, or access removed, between the two reads
            if (!canEdit(pickedList)) return viewOnly(interaction);
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
        return interaction.reply({ embeds: [ui.warn('Confirm Delete', `Delete **${safe(list.name)}** and all its tasks?`)], components: [ui.confirmButtons(list.id)], ...EPHEMERAL });
    }
    if (id.startsWith('yes_')) {
        const list = await tasks.getList(userId, idFrom(id, 'yes_'));
        if (!list) return interaction.update({ embeds: [ui.error('Not found')], components: [] });
        await tasks.deleteList(userId, list.id);
        aiSync.forget(userId, list.id);
        return interaction.update({ embeds: [ui.success('Deleted', `**${safe(list.name)}** deleted`)], components: [] });
    }
    if (id.startsWith('no_')) return interaction.update({ embeds: [ui.info('Cancelled', 'Delete cancelled')], components: [] });
}

// ─── Select menus ────────────────────────────────────────────────────────────

async function handleSelectMenu(interaction) {
    try {
        if (notOwner(interaction)) return await rejectNotOwner(interaction);
        return await routeSelect(interaction);
    } catch (err) {
        return handleError(interaction, err);
    }
}

async function routeSelect(interaction) {
    const id = interaction.customId;
    const userId = interaction.user.id;
    const val = interaction.values[0];

    // "More…" / "Previous…" option of a paged select menu.
    const page = ui.pageFromValue(val);
    if (page !== null) return pageSelect(interaction, id, page);

    if (id === 'filter_category') {
        let lists = await tasks.getLists(userId);
        if (val === 'NONE') lists = lists.filter((l) => !l.category);
        else if (val !== 'ALL') lists = lists.filter((l) => l.category === val);
        const label = val === 'ALL' ? 'All Categories' : val === 'NONE' ? 'Uncategorized' : val;
        return interaction.update({ embeds: [ui.listsOverviewEmbed(lists, `category: ${label}`, '', await todayFor(userId))], components: overviewComponents(lists, { withCategoryFilter: true }) });
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

    if (id.startsWith('sel_edit_') || id.startsWith('sel_desc_') || id.startsWith('sel_details_')) {
        const item = await tasks.getItem(userId, val);
        if (!item) return interaction.update({ embeds: [ui.error('Not Found')], components: [] });
        const modal = id.startsWith('sel_edit_') ? ui.editItemModal(item) : id.startsWith('sel_desc_') ? ui.descModal(item) : ui.detailsModal(item);
        return interaction.showModal(modal);
    }

    if (id.startsWith('sel_del_')) {
        const item = await tasks.getItem(userId, val);
        if (!item) return interaction.update({ embeds: [ui.error('Not Found')], components: [] });
        await tasks.deleteItem(userId, item.id);
        aiSync.reindex(userId, item.list_id);
        return interaction.update({ embeds: [ui.success('Deleted', `**${safe(item.name)}** deleted`)], components: [] });
    }

    if (id.startsWith('sel_done_')) {
        await interaction.deferUpdate();
        const result = await tasks.setItemCompleted(userId, val);
        aiSync.reindex(userId, result.item?.list_id);
        const note = result.completed && !result.firstCompletion ? '\n-# XP is only awarded the first time a task is completed.' : '';
        const bonuses = result.completed ? ui.bonusLines(result.bonuses) : '';
        await interaction.editReply({
            embeds: [ui.success(result.completed ? '✅ Completed' : '⬜ Uncompleted', `**${safe(result.item.name)}**${bonuses}${note}`)],
            components: []
        });
        return sendRewards(interaction, result);
    }

    if (id.startsWith('sel_swap1_')) {
        const listId = idFrom(id, 'sel_swap1_');
        const items = await tasks.getItems(userId, listId);
        if (!items) return interaction.update({ embeds: [ui.error('Not found')], components: [] });
        // The first pick travels in the second menu's custom ID, so the reorder survives a bot restart.
        return interaction.update({
            embeds: [ui.info('Reorder', 'Select the SECOND task:')],
            components: [ui.itemSelect(items.filter((i) => i.id !== Number(val)), `sel_swap2_${listId}_${Number(val)}`)]
        });
    }

    if (id.startsWith('sel_swap2_')) {
        const ids = /^sel_swap2_(\d+)_(\d+)$/.exec(id);
        const listId = ids && Number(ids[1]);
        const firstId = ids && Number(ids[2]);
        if (!firstId) return interaction.update({ embeds: [ui.error('Expired', 'Start the reorder again.')], components: [] });
        await tasks.swapItemPositions(userId, firstId, val);
        aiSync.reindex(userId, listId);
        return interaction.update({ embeds: [ui.success('Swapped', 'Positions swapped')], components: [] });
    }
}

/**
 * The sort/filter an overview message is showing, read back from its footer ("Sorted: name • Filter: Current") and
 * from whether it carries the category filter row. Unknown or missing pieces mean the default view.
 */
function overviewViewOf(message) {
    const footer = message?.embeds?.[0]?.footer?.text || '';
    let sort = '';
    let filter = '';
    for (const part of footer.split(' • ')) {
        if (part.startsWith('Sorted: ')) sort = part.slice('Sorted: '.length);
        else if (part.startsWith('Filter: ')) filter = part.slice('Filter: '.length);
    }
    const hasCategoryRow = (message?.components || []).some((row) => (row.components || []).some((c) => (c.customId ?? c.custom_id) === 'filter_category'));
    return { sort, filter, withCategoryFilter: hasCategoryRow };
}

/** The lists an overview view (see overviewViewOf) shows, sorted and filtered the way its buttons would. */
async function listsForView(userId, { sort, filter }, today) {
    const sorts = { name: { sortBy: 'name', order: 'ASC' }, created_at: { sortBy: 'created_at', order: 'DESC' }, priority: { sortBy: 'priority', order: 'DESC' } };
    let lists = await tasks.getLists(userId, sorts[sort]);
    if (sort.startsWith('category: ')) {
        const label = sort.slice('category: '.length);
        if (label === 'Uncategorized') lists = lists.filter((l) => !l.category);
        else if (label !== 'All Categories') lists = lists.filter((l) => l.category === label);
    }
    if (filter === 'Current') lists = lists.filter((l) => !isExpired(l, today));
    else if (filter === 'Expired') lists = lists.filter((l) => isExpired(l, today));
    else if (filter === 'Completed') lists = lists.filter((l) => l.items_total > 0 && l.items_completed === l.items_total);
    return lists;
}

/** Re-render a paged list/item select menu on another page. */
async function pageSelect(interaction, id, page) {
    const userId = interaction.user.id;
    if (id === 'sel_list') {
        // Paging must not reset the view: recover the sort/filter from the message's footer and its category row.
        const view = overviewViewOf(interaction.message);
        const today = await todayFor(userId);
        const lists = await listsForView(userId, view, today);
        return interaction.update({
            embeds: [ui.listsOverviewEmbed(lists, view.sort, view.filter, today)],
            components: overviewComponents(lists, { page, withCategoryFilter: view.withCategoryFilter })
        });
    }
    const m = /^(sel_(?:edit|del|done|desc|details|swap1|swap2))_(\d+)(?:_(\d+))?$/.exec(id);
    if (!m || (m[3] !== undefined) !== (m[1] === 'sel_swap2')) return interaction.deferUpdate();
    const listId = Number(m[2]);
    let items = await tasks.getItems(userId, listId);
    if (!items) return interaction.update({ embeds: [ui.error('Not found')], components: [] });
    if (m[1] === 'sel_swap2') items = items.filter((i) => i.id !== Number(m[3]));
    return interaction.update({ components: [ui.itemSelect(items, id, undefined, { page })] });
}

// ─── Modals ──────────────────────────────────────────────────────────────────

async function handleModal(interaction) {
    try {
        return await routeModal(interaction);
    } catch (err) {
        return handleError(interaction, err);
    }
}

/** Words people type for a priority, mapped to what the shared validation accepts ('' clears it). */
const PRIORITY_WORDS = { l: 'LOW', low: 'LOW', m: 'MEDIUM', med: 'MEDIUM', medium: 'MEDIUM', h: 'HIGH', high: 'HIGH', none: null, '-': null };

/**
 * The Details modal's four inputs as updateItem fields. Empty (or none) clears a field; anything else
 * unrecognised is passed through so the shared validation rejects it with its own message.
 */
function parseDetails(get) {
    const text = (name) => String(get(name) ?? '').trim();
    const pri = text('priority').toLowerCase();
    const repeat = text('repeat').toLowerCase();
    return {
        due_date: text('due') || null,
        priority: Object.hasOwn(PRIORITY_WORDS, pri) ? PRIORITY_WORDS[pri] : pri,
        tags: text('tags') || null,
        recurrence: repeat === 'none' || repeat === '-' ? null : repeat || null
    };
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
            embeds: [ui.success('Created!', `**${safe(result.list.name)}**\nPick a category and priority below (optional).`)],
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
        return interaction.reply({ embeds: [ui.success('Updated', `**${safe(list.name)}**`)], ...EPHEMERAL });
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
        return interaction.reply({ embeds: [ui.success('Updated', `**${safe(item.name)}**`)], ...EPHEMERAL });
    }

    if (id.startsWith('m_details_')) {
        const item = await tasks.updateItem(userId, idFrom(id, 'm_details_'), parseDetails((name) => field(interaction, name)));
        aiSync.reindex(userId, item?.list_id);
        return interaction.reply({ embeds: [ui.success('Updated', `**${safe(item.name)}**\n${ui.itemMeta(item, await todayFor(userId)) || 'No details set.'}`)], ...EPHEMERAL });
    }

    if (id.startsWith('m_desc_')) {
        const desc = field(interaction, 'desc');
        const item = await tasks.updateItem(userId, idFrom(id, 'm_desc_'), { description: desc || null });
        aiSync.reindex(userId, item?.list_id);
        return interaction.reply({ embeds: [ui.success('Updated', desc ? 'Description saved' : 'Description cleared')], ...EPHEMERAL });
    }

    if (id === 'm_search') {
        const q = (field(interaction, 'q') || '').trim();
        // Discord's "required" lets a lone space through, which would search for everything.
        if (!q) return interaction.reply({ embeds: [ui.info('Search', 'Enter something to search for.')], ...EPHEMERAL });
        const lists = await tasks.searchLists(userId, q);
        if (!lists.length) return interaction.reply({ embeds: [ui.info('No Results', `Nothing found for "${escapeDiscord(q, { max: 100 })}"`)], ...EPHEMERAL });
        const sel = ui.listSelect(lists);
        return interaction.reply({ embeds: [ui.listsOverviewEmbed(lists, `Search: ${q.slice(0, 100)}`, '', await todayFor(userId))], components: sel ? [sel] : [], ...EPHEMERAL });
    }
}

module.exports = { data, execute, autocomplete, handleButton, handleSelectMenu, handleModal, parseDetails, overviewViewOf };
