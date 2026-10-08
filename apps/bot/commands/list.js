/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  📋 LIST COMMAND (v3.0 - Dank Memer Style)
 * 
 *  STATE MACHINE:
 *  LIST_OVERVIEW → LIST_VIEW (READ-ONLY: search, sort only)
 *                → LIST_EDIT (ALL mutations happen here)
 * 
 *  ⚠️ CRITICAL: VIEW = READ-ONLY | EDIT = MUTATION HUB
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../database/db');
const ui = require('../utils/ui');
const { calculateFinalXP, addXP, updateStreak, checkAchievements } = require('../utils/gameLogic');

const swapState = new Map();

const data = new SlashCommandBuilder()
    .setName('list')
    .setDescription('📋 View and manage your lists')
    .addStringOption(opt => opt.setName('name').setDescription('List name').setAutocomplete(true));

async function execute(interaction) {
    const userId = interaction.user.id;
    const listName = interaction.options.getString('name');
    await db.getOrCreateUser(userId);
    
    if (listName) {
        // Direct to VIEW mode (READ-ONLY)
        const list = await db.getListByName(userId, listName);
        if (!list) return interaction.reply({ embeds: [ui.error('Not Found', 'List not found.')], flags: MessageFlags.Ephemeral });
        
        const items = await db.getItems(list.id);
        await interaction.reply({ embeds: [ui.listViewEmbed(list, items, 'view')], components: ui.viewButtons(list.id) });
    } else {
        // LIST_OVERVIEW state
        const lists = await db.getLists(userId);
        const components = [];
        const sel = ui.listSelect(lists);
        if (sel) components.push(sel);
        components.push(...ui.overviewButtons());
        await interaction.reply({ embeds: [ui.listsOverviewEmbed(lists)], components });
    }
}

async function handleButton(interaction) {
    const id = interaction.customId;
    const userId = interaction.user.id;
    
    // ═══════════════════════════════════════════════════════════════════════════
    //  📋 LIST_OVERVIEW STATE
    // ═══════════════════════════════════════════════════════════════════════════
    
    if (id === 'sort_az' || id === 'sort_date' || id === 'sort_pri') {
        const sort = id === 'sort_az' ? 'name' : id === 'sort_date' ? 'created_at' : 'priority';
        const order = id === 'sort_az' ? 'ASC' : 'DESC';
        const lists = await db.getLists(userId, sort, order);
        const components = [];
        const sel = ui.listSelect(lists);
        if (sel) components.push(sel);
        components.push(...ui.overviewButtons());
        return interaction.update({ embeds: [ui.listsOverviewEmbed(lists, sort)], components });
    }
    
    // Category filter button - show filter select
    if (id === 'filter_cat') {
        const lists = await db.getLists(userId);
        const components = [];
        components.push(ui.categoryFilterSelect());
        const sel = ui.listSelect(lists);
        if (sel) components.push(sel);
        components.push(...ui.overviewButtons());
        return interaction.update({ embeds: [ui.listsOverviewEmbed(lists, 'category')], components });
    }

    // Filter: All lists
    if (id === 'filter_all') {
        const lists = await db.getLists(userId);
        const components = [];
        const sel = ui.listSelect(lists);
        if (sel) components.push(sel);
        components.push(...ui.overviewButtons());
        return interaction.update({ embeds: [ui.listsOverviewEmbed(lists, '', 'All')], components });
    }

    // Filter: Current (incomplete, not expired)
    if (id === 'filter_current') {
        let lists = await db.getLists(userId);
        const now = new Date();
        lists = lists.filter(list => {
            const isExpired = list.deadline && new Date(list.deadline) < now;
            return !isExpired;
        });
        const components = [];
        const sel = ui.listSelect(lists);
        if (sel) components.push(sel);
        components.push(...ui.overviewButtons());
        return interaction.update({ embeds: [ui.listsOverviewEmbed(lists, '', 'Current')], components });
    }

    // Filter: Expired (past deadline)
    if (id === 'filter_expired') {
        let lists = await db.getLists(userId);
        const now = new Date();
        lists = lists.filter(list => {
            return list.deadline && new Date(list.deadline) < now;
        });
        const components = [];
        const sel = ui.listSelect(lists);
        if (sel) components.push(sel);
        components.push(...ui.overviewButtons());
        return interaction.update({ embeds: [ui.listsOverviewEmbed(lists, '', 'Expired')], components });
    }

    // Filter: Completed (all items done)
    if (id === 'filter_completed') {
        let lists = await db.getLists(userId);
        // Get list stats to check completion
        const listsWithStats = await Promise.all(lists.map(async (list) => {
            const items = await db.getItems(list.id);
            const total = items.length;
            const completed = items.filter(i => i.completed).length;
            return { ...list, isComplete: total > 0 && total === completed };
        }));
        lists = listsWithStats.filter(list => list.isComplete);
        const components = [];
        const sel = ui.listSelect(lists);
        if (sel) components.push(sel);
        components.push(...ui.overviewButtons());
        return interaction.update({ embeds: [ui.listsOverviewEmbed(lists, '', 'Completed')], components });
    }

    if (id === 'create') {
        return interaction.showModal(ui.listModal());
    }
    
    if (id === 'back') {
        const lists = await db.getLists(userId);
        const components = [];
        const sel = ui.listSelect(lists);
        if (sel) components.push(sel);
        components.push(...ui.overviewButtons());
        return interaction.update({ embeds: [ui.listsOverviewEmbed(lists)], components });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    //  👁️ LIST_VIEW STATE (READ-ONLY - Sort & Search ONLY)
    //  ❌ No editing, deleting, reordering, marking done here
    // ═══════════════════════════════════════════════════════════════════════════
    
    // Sort A→Z
    if (id.startsWith('sort_az_')) {
        const listId = parseInt(id.replace('sort_az_', ''));
        const list = await db.getListById(listId);
        if (!list || list.discord_id !== userId) return interaction.reply({ embeds: [ui.error('Access Denied')], flags: MessageFlags.Ephemeral });
        let items = await db.getItems(listId);
        items.sort((a, b) => a.name.localeCompare(b.name));
        return interaction.update({ embeds: [ui.listViewEmbed(list, items, 'view')], components: ui.viewButtons(listId) });
    }
    
    // Sort Z→A
    if (id.startsWith('sort_za_')) {
        const listId = parseInt(id.replace('sort_za_', ''));
        const list = await db.getListById(listId);
        if (!list || list.discord_id !== userId) return interaction.reply({ embeds: [ui.error('Access Denied')], flags: MessageFlags.Ephemeral });
        let items = await db.getItems(listId);
        items.sort((a, b) => b.name.localeCompare(a.name));
        return interaction.update({ embeds: [ui.listViewEmbed(list, items, 'view')], components: ui.viewButtons(listId) });
    }
    
    // Sort by priority (incomplete first)
    if (id.startsWith('sort_pri_')) {
        const listId = parseInt(id.replace('sort_pri_', ''));
        const list = await db.getListById(listId);
        if (!list || list.discord_id !== userId) return interaction.reply({ embeds: [ui.error('Access Denied')], flags: MessageFlags.Ephemeral });
        let items = await db.getItems(listId);
        items.sort((a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0));
        return interaction.update({ embeds: [ui.listViewEmbed(list, items, 'view')], components: ui.viewButtons(listId) });
    }

    // Search (opens modal)
    if (id.startsWith('search_')) {
        return interaction.showModal(ui.searchModal());
    }
    
    // Refresh (re-render from DB)
    if (id.startsWith('refresh_')) {
        const listId = parseInt(id.replace('refresh_', ''));
        const list = await db.getListById(listId);
        if (!list || list.discord_id !== userId) return interaction.reply({ embeds: [ui.error('Access Denied')], flags: MessageFlags.Ephemeral });
        const items = await db.getItems(listId);
        return interaction.update({ embeds: [ui.listViewEmbed(list, items, 'view')], components: ui.viewButtons(listId) });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    //  🔄 STATE TRANSITION: VIEW → EDIT
    // ═══════════════════════════════════════════════════════════════════════════
    
    if (id.startsWith('edit_')) {
        const listId = parseInt(id.replace('edit_', ''));
        const list = await db.getListById(listId);
        if (!list || list.discord_id !== userId) return interaction.reply({ embeds: [ui.error('Access Denied')], flags: MessageFlags.Ephemeral });
        const items = await db.getItems(listId);
        return interaction.update({ embeds: [ui.listViewEmbed(list, items, 'edit')], components: ui.editButtons(listId) });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    //  🔄 STATE TRANSITION: EDIT → VIEW
    // ═══════════════════════════════════════════════════════════════════════════
    
    if (id.startsWith('view_')) {
        const listId = parseInt(id.replace('view_', ''));
        const list = await db.getListById(listId);
        if (!list || list.discord_id !== userId) return interaction.reply({ embeds: [ui.error('Access Denied')], flags: MessageFlags.Ephemeral });
        const items = await db.getItems(listId);
        return interaction.update({ embeds: [ui.listViewEmbed(list, items, 'view')], components: ui.viewButtons(listId) });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    //  ✏️ LIST_EDIT STATE - ITEM OPERATIONS (Single Mutation Hub)
    // ═══════════════════════════════════════════════════════════════════════════
    
    // ITEM_ADD
    if (id.startsWith('item_add_')) {
        const listId = parseInt(id.replace('item_add_', ''));
        return interaction.showModal(ui.itemModal(listId));
    }
    
    // ITEM_EDIT (select menu)
    if (id.startsWith('item_edit_')) {
        const listId = parseInt(id.replace('item_edit_', ''));
        const items = await db.getItems(listId);
        if (!items.length) return interaction.reply({ embeds: [ui.info('Empty', 'No items to edit')], flags: MessageFlags.Ephemeral });
        return interaction.reply({ embeds: [ui.info('Edit Item', 'Select item:')], components: [ui.itemSelect(items, `sel_edit_${listId}`)], flags: MessageFlags.Ephemeral });
    }
    
    // ITEM_DELETE (select menu)
    if (id.startsWith('item_del_')) {
        const listId = parseInt(id.replace('item_del_', ''));
        const items = await db.getItems(listId);
        if (!items.length) return interaction.reply({ embeds: [ui.info('Empty', 'No items')], flags: MessageFlags.Ephemeral });
        return interaction.reply({ embeds: [ui.info('Delete Item', 'Select item:')], components: [ui.itemSelect(items, `sel_del_${listId}`)], flags: MessageFlags.Ephemeral });
    }
    
    // ITEM_MARK_DONE (select menu)
    if (id.startsWith('item_done_')) {
        const listId = parseInt(id.replace('item_done_', ''));
        const items = await db.getItems(listId);
        if (!items.length) return interaction.reply({ embeds: [ui.info('Empty', 'No items')], flags: MessageFlags.Ephemeral });
        return interaction.reply({ embeds: [ui.info('Toggle Status', 'Select item:')], components: [ui.itemSelect(items, `sel_done_${listId}`)], flags: MessageFlags.Ephemeral });
    }
    
    // ITEM_REORDER (two-step swap)
    if (id.startsWith('item_swap_')) {
        const listId = parseInt(id.replace('item_swap_', ''));
        const items = await db.getItems(listId);
        if (items.length < 2) return interaction.reply({ embeds: [ui.info('Not Enough', 'Need 2+ items')], flags: MessageFlags.Ephemeral });
        return interaction.reply({ embeds: [ui.info('Reorder', 'Select FIRST item:')], components: [ui.itemSelect(items, `sel_swap1_${listId}`)], flags: MessageFlags.Ephemeral });
    }
    
    // DESCRIPTION_EDIT (select menu)
    if (id.startsWith('item_desc_')) {
        const listId = parseInt(id.replace('item_desc_', ''));
        const items = await db.getItems(listId);
        if (!items.length) return interaction.reply({ embeds: [ui.info('Empty', 'No items')], flags: MessageFlags.Ephemeral });
        return interaction.reply({ embeds: [ui.info('Edit Description', 'Select item:')], components: [ui.itemSelect(items, `sel_desc_${listId}`)], flags: MessageFlags.Ephemeral });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    //  ✏️ LIST_EDIT STATE - LIST_META_EDIT
    // ═══════════════════════════════════════════════════════════════════════════
    
    if (id.startsWith('list_meta_')) {
        const listId = parseInt(id.replace('list_meta_', ''));
        const list = await db.getListById(listId);
        if (!list || list.discord_id !== userId) return interaction.reply({ embeds: [ui.error('Access Denied')], flags: MessageFlags.Ephemeral });
        
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        await interaction.reply({
            embeds: [ui.info('Edit List Info', 'Choose category/priority or edit name/description/deadline:')],
            components: [
                ui.catSelect(`cat_${listId}`),
                ui.priSelect(`pri_${listId}`),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`rename_${listId}`).setLabel('Edit Name/Desc/Deadline').setStyle(ButtonStyle.Primary)
                )
            ],
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    
    if (id.startsWith('rename_')) {
        const listId = parseInt(id.replace('rename_', ''));
        const list = await db.getListById(listId);
        return interaction.showModal(ui.listModal(list));
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    //  ✏️ LIST_EDIT STATE - LIST_DELETE_CONFIRM
    // ═══════════════════════════════════════════════════════════════════════════
    
    if (id.startsWith('list_del_')) {
        const listId = parseInt(id.replace('list_del_', ''));
        const list = await db.getListById(listId);
        if (!list || list.discord_id !== userId) return interaction.reply({ embeds: [ui.error('Access Denied')], flags: MessageFlags.Ephemeral });
        return interaction.reply({ embeds: [ui.warn('Confirm Delete', `Delete **${list.name}** and all items?`)], components: [ui.confirmButtons(listId)], flags: MessageFlags.Ephemeral });
    }
    
    if (id.startsWith('yes_')) {
        const listId = parseInt(id.replace('yes_', ''));
        const list = await db.getListById(listId);
        if (!list || list.discord_id !== userId) return interaction.update({ embeds: [ui.error('Access Denied')], components: [] });
        await db.deleteList(listId);
        return interaction.update({ embeds: [ui.success('Deleted', `**${list.name}** deleted`)], components: [] });
    }
    
    if (id.startsWith('no_')) {
        return interaction.update({ embeds: [ui.info('Cancelled', 'Delete cancelled')], components: [] });
    }
    
    // PHASE 4: Done button for category/priority edit
    if (id.startsWith('metadone_')) {
        const listId = parseInt(id.replace('metadone_', ''));
        const list = await db.getListById(listId);
        if (!list || list.discord_id !== userId) return interaction.update({ embeds: [ui.error('Access Denied')], components: [] });
        const items = await db.getItems(listId);
        return interaction.update({ embeds: [ui.listViewEmbed(list, items, 'edit')], components: ui.editButtons(listId) });
    }
}

async function handleSelectMenu(interaction) {
    const id = interaction.customId;
    const userId = interaction.user.id;
    const val = interaction.values[0];
    
    // Category filter for overview
    if (id === 'filter_category') {
        let lists;
        if (val === 'ALL') {
            lists = await db.getLists(userId);
        } else if (val === 'NONE') {
            lists = await db.getLists(userId);
            lists = lists.filter(l => !l.category);
        } else {
            lists = await db.getLists(userId);
            lists = lists.filter(l => l.category === val);
        }
        
        const components = [];
        components.push(ui.categoryFilterSelect());
        const sel = ui.listSelect(lists);
        if (sel) components.push(sel);
        components.push(...ui.overviewButtons());
        
        const filterLabel = val === 'ALL' ? 'All Categories' : val === 'NONE' ? 'Uncategorized' : val;
        return interaction.update({ 
            embeds: [ui.listsOverviewEmbed(lists, `category: ${filterLabel}`)], 
            components 
        });
    }
    
    // List selection → VIEW mode
    if (id === 'sel_list') {
        const listId = parseInt(val);
        const list = await db.getListById(listId);
        if (!list || list.discord_id !== userId) return interaction.reply({ embeds: [ui.error('Access Denied')], flags: MessageFlags.Ephemeral });
        const items = await db.getItems(listId);
        return interaction.update({ embeds: [ui.listViewEmbed(list, items, 'view')], components: ui.viewButtons(listId) });
    }
    
    // Category select (EDIT mode) - PHASE 4 FIX: Keep UI open
    if (id.startsWith('cat_')) {
        const listId = parseInt(id.replace('cat_', ''));
        const list = await db.getListById(listId);
        if (!list || list.discord_id !== userId) return interaction.reply({ embeds: [ui.error('Access Denied')], flags: MessageFlags.Ephemeral });
        
        await db.updateList(listId, { category: val === 'NONE' ? null : val });
        
        // Refresh list to show updated values
        const updatedList = await db.getListById(listId);
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        
        return interaction.update({
            embeds: [ui.info('Edit List Info', 
                `✅ Category set to: **${val === 'NONE' ? 'None' : val}**\n\n` +
                `Current: 📁 ${updatedList.category || 'None'} • ${updatedList.priority ? `${updatedList.priority}` : 'No priority'}\n\n` +
                `Select another option or click Done.`
            )],
            components: [
                ui.catSelect(`cat_${listId}`),
                ui.priSelect(`pri_${listId}`),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`rename_${listId}`).setLabel('Edit Name/Desc').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`metadone_${listId}`).setLabel('Done').setEmoji('✅').setStyle(ButtonStyle.Success)
                )
            ]
        });
    }
    
    // Priority select (EDIT mode) - PHASE 4 FIX: Keep UI open
    if (id.startsWith('pri_')) {
        const listId = parseInt(id.replace('pri_', ''));
        const list = await db.getListById(listId);
        if (!list || list.discord_id !== userId) return interaction.reply({ embeds: [ui.error('Access Denied')], flags: MessageFlags.Ephemeral });
        
        await db.updateList(listId, { priority: val === 'NONE' ? null : val });
        
        // Refresh list to show updated values
        const updatedList = await db.getListById(listId);
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        
        return interaction.update({
            embeds: [ui.info('Edit List Info', 
                `✅ Priority set to: **${val === 'NONE' ? 'None' : val}**\n\n` +
                `Current: 📁 ${updatedList.category || 'None'} • ${updatedList.priority ? `${updatedList.priority}` : 'No priority'}\n\n` +
                `Select another option or click Done.`
            )],
            components: [
                ui.catSelect(`cat_${listId}`),
                ui.priSelect(`pri_${listId}`),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`rename_${listId}`).setLabel('Edit Name/Desc').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`metadone_${listId}`).setLabel('Done').setEmoji('✅').setStyle(ButtonStyle.Success)
                )
            ]
        });
    }
    
    // Edit item select (EDIT mode)
    if (id.startsWith('sel_edit_')) {
        const item = await db.getItemById(parseInt(val));
        if (!item) return interaction.update({ embeds: [ui.error('Not Found')], components: [] });
        return interaction.showModal(ui.editItemModal(item));
    }
    
    // Delete item select (EDIT mode)
    if (id.startsWith('sel_del_')) {
        const item = await db.getItemById(parseInt(val));
        if (!item) return interaction.update({ embeds: [ui.error('Not Found')], components: [] });
        await db.deleteItem(parseInt(val));
        return interaction.update({ embeds: [ui.success('Deleted', `**${item.name}** deleted`)], components: [] });
    }
    
    // Mark done select (EDIT mode) - Awards XP
    // FIX: Must deferUpdate() FIRST, then followUp() for XP notifications
    if (id.startsWith('sel_done_')) {
        // Step 1: Acknowledge the interaction IMMEDIATELY
        await interaction.deferUpdate();
        
        const itemId = parseInt(val);
        const item = await db.getItemById(itemId);
        if (!item) return interaction.editReply({ embeds: [ui.error('Not Found')], components: [] });
        
        const newStatus = await db.toggleItemComplete(itemId, userId);
        
        // Step 2: Update the message with result
        await interaction.editReply({ embeds: [ui.success(newStatus ? '✅ Completed' : '⬜ Uncompleted', `**${item.name}**`)], components: [] });
        
        // Step 3: XP notifications via followUp (ephemeral, never public)
        // NOW followUp() is valid because we already deferred
        if (newStatus) {
            let user = await db.getUser(userId);
            if (user.gamification_enabled) {
                const userSkills = await db.getUserSkills(userId);
                const { finalXP, bonusInfo, userUpdates } = calculateFinalXP(user, userSkills, 8);
                const xpResult = addXP(user, finalXP);
                const streakResult = updateStreak(user);
                await db.updateUser(userId, { player_xp: user.player_xp, player_level: user.player_level, ...userUpdates, ...streakResult.updates });
                
                user = await db.getUser(userId);
                const achs = await db.getAchievements(userId);
                const newAchs = checkAchievements(user, achs.map(a => a.achievement_key)) || [];
                for (const a of newAchs) await db.unlockAchievement(userId, a.key);
                
                // Private XP notification (ephemeral)
                if (xpResult.xpGained) await interaction.followUp({ embeds: [ui.xpEmbed(xpResult.xpGained, bonusInfo, xpResult.leveledUp, xpResult.newLevel)], flags: MessageFlags.Ephemeral });
                for (const a of newAchs) await interaction.followUp({ embeds: [ui.achievementUnlockEmbed(a)], flags: MessageFlags.Ephemeral });
            }
        }
        return;
    }
    
    // Swap step 1
    if (id.startsWith('sel_swap1_')) {
        const listId = parseInt(id.replace('sel_swap1_', ''));
        swapState.set(`${userId}_${listId}`, parseInt(val));
        const items = await db.getItems(listId);
        return interaction.update({ embeds: [ui.info('Reorder', 'Select SECOND item:')], components: [ui.itemSelect(items.filter(i => i.id !== parseInt(val)), `sel_swap2_${listId}`)] });
    }
    
    // Swap step 2
    if (id.startsWith('sel_swap2_')) {
        const listId = parseInt(id.replace('sel_swap2_', ''));
        const firstId = swapState.get(`${userId}_${listId}`);
        if (!firstId) return interaction.update({ embeds: [ui.error('Expired')], components: [] });
        await db.swapItemPositions(firstId, parseInt(val));
        swapState.delete(`${userId}_${listId}`);
        return interaction.update({ embeds: [ui.success('Swapped', 'Positions swapped')], components: [] });
    }
    
    // Description edit
    if (id.startsWith('sel_desc_')) {
        const item = await db.getItemById(parseInt(val));
        if (!item) return interaction.update({ embeds: [ui.error('Not Found')], components: [] });
        return interaction.showModal(ui.descModal(item));
    }
}

async function handleModal(interaction) {
    const id = interaction.customId;
    const userId = interaction.user.id;
    
    // Create list
    if (id === 'm_newlist') {
        const name = interaction.fields.getTextInputValue('name').trim();
        const desc = interaction.fields.getTextInputValue('desc')?.trim() || null;
        let deadline = interaction.fields.getTextInputValue('deadline')?.trim() || null;
        if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) deadline = null;
        
        if (!name) return interaction.reply({ embeds: [ui.error('Required', 'Name required')], flags: MessageFlags.Ephemeral });
        
        const existing = await db.getListByName(userId, name);
        if (existing) return interaction.reply({ embeds: [ui.error('Exists', 'List already exists')], flags: MessageFlags.Ephemeral });
        
        const listId = await db.createList(userId, name, desc, null, null, deadline);
        
        // Award XP (ephemeral)
        let user = await db.getUser(userId);
        if (user.gamification_enabled) {
            const userSkills = await db.getUserSkills(userId);
            const { finalXP, bonusInfo, userUpdates } = calculateFinalXP(user, userSkills, 10);
            const xpResult = addXP(user, finalXP);
            const streakResult = updateStreak(user);
            await db.updateUser(userId, { player_xp: user.player_xp, player_level: user.player_level, ...userUpdates, ...streakResult.updates });
            
            user = await db.getUser(userId);
            const achs = await db.getAchievements(userId);
            const newAchs = checkAchievements(user, achs.map(a => a.achievement_key)) || [];
            for (const a of newAchs) await db.unlockAchievement(userId, a.key);

            await interaction.reply({ embeds: [ui.success('Created!', `**${name}**`)], components: [ui.catSelect(`cat_${listId}`), ui.priSelect(`pri_${listId}`)], flags: MessageFlags.Ephemeral });
            if (xpResult.xpGained) await interaction.followUp({ embeds: [ui.xpEmbed(xpResult.xpGained, bonusInfo, xpResult.leveledUp, xpResult.newLevel)], flags: MessageFlags.Ephemeral });
            for (const a of newAchs) await interaction.followUp({ embeds: [ui.achievementUnlockEmbed(a)], flags: MessageFlags.Ephemeral });
        } else {
            await interaction.reply({ embeds: [ui.success('Created!', `**${name}**`)], components: [ui.catSelect(`cat_${listId}`), ui.priSelect(`pri_${listId}`)], flags: MessageFlags.Ephemeral });
        }
        return;
    }
    
    // Edit list
    if (id.startsWith('m_editlist_')) {
        const listId = parseInt(id.replace('m_editlist_', ''));
        const name = interaction.fields.getTextInputValue('name').trim();
        const desc = interaction.fields.getTextInputValue('desc')?.trim() || null;
        let deadline = interaction.fields.getTextInputValue('deadline')?.trim() || null;
        if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) deadline = null;
        
        if (!name) return interaction.reply({ embeds: [ui.error('Required', 'Name required')], flags: MessageFlags.Ephemeral });
        await db.updateList(listId, { name, description: desc, deadline, deadline_notified: false });
        return interaction.reply({ embeds: [ui.success('Updated', `**${name}**`)], flags: MessageFlags.Ephemeral });
    }
    
    // Add item
    if (id.startsWith('m_additem_')) {
        const listId = parseInt(id.replace('m_additem_', ''));
        const name = interaction.fields.getTextInputValue('name').trim();
        const desc = interaction.fields.getTextInputValue('desc')?.trim() || null;
        
        if (!name) return interaction.reply({ embeds: [ui.error('Required', 'Name required')], flags: MessageFlags.Ephemeral });
        await db.addItem(listId, name, desc);
        
        // Award XP (ephemeral)
        let user = await db.getUser(userId);
        if (user.gamification_enabled) {
            const userSkills = await db.getUserSkills(userId);
            const { finalXP, bonusInfo, userUpdates } = calculateFinalXP(user, userSkills, 5);
            const xpResult = addXP(user, finalXP);
            const streakResult = updateStreak(user);
            await db.updateUser(userId, { player_xp: user.player_xp, player_level: user.player_level, ...userUpdates, ...streakResult.updates });
            
            user = await db.getUser(userId);
            const achs = await db.getAchievements(userId);
            const newAchs = checkAchievements(user, achs.map(a => a.achievement_key)) || [];
            for (const a of newAchs) await db.unlockAchievement(userId, a.key);
            
            const list = await db.getListById(listId);
            const items = await db.getItems(listId);
            await interaction.reply({ embeds: [ui.listViewEmbed(list, items, 'edit')], components: ui.editButtons(listId) });
            if (xpResult.xpGained) await interaction.followUp({ embeds: [ui.xpEmbed(xpResult.xpGained, bonusInfo, xpResult.leveledUp, xpResult.newLevel)], flags: MessageFlags.Ephemeral });
            for (const a of newAchs) await interaction.followUp({ embeds: [ui.achievementUnlockEmbed(a)], flags: MessageFlags.Ephemeral });
        } else {
            const list = await db.getListById(listId);
            const items = await db.getItems(listId);
            await interaction.reply({ embeds: [ui.listViewEmbed(list, items, 'edit')], components: ui.editButtons(listId) });
        }
        return;
    }
    
    // Edit item name
    if (id.startsWith('m_edititem_')) {
        const itemId = parseInt(id.replace('m_edititem_', ''));
        const name = interaction.fields.getTextInputValue('name').trim();
        if (!name) return interaction.reply({ embeds: [ui.error('Required', 'Name required')], flags: MessageFlags.Ephemeral });
        await db.updateItem(itemId, { name });
        return interaction.reply({ embeds: [ui.success('Updated', `**${name}**`)], flags: MessageFlags.Ephemeral });
    }
    
    // Item description
    if (id.startsWith('m_desc_')) {
        const itemId = parseInt(id.replace('m_desc_', ''));
        const desc = interaction.fields.getTextInputValue('desc')?.trim() || null;
        await db.updateItem(itemId, { description: desc });
        return interaction.reply({ embeds: [ui.success('Updated', desc ? 'Description saved' : 'Description cleared')], flags: MessageFlags.Ephemeral });
    }
    
    // Search
    if (id === 'm_search') {
        const q = interaction.fields.getTextInputValue('q').trim();
        const lists = await db.searchLists(userId, q);
        if (!lists.length) return interaction.reply({ embeds: [ui.info('No Results', `Nothing for "${q}"`)], flags: MessageFlags.Ephemeral });
        const sel = ui.listSelect(lists);
        await interaction.reply({ embeds: [ui.listsOverviewEmbed(lists, `Search: ${q}`)], components: sel ? [sel] : [] });
    }
}

module.exports = { data, execute, handleButton, handleSelectMenu, handleModal };
