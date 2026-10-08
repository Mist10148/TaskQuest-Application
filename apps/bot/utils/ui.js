/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🎨 TASKQUEST UI (v3.7 - Clean & Professional)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');

// ═══════════════════════════════════════════════════════════════════════════════
//  🎨 COLOR SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

const COLORS = {
    // Core UI
    primary: 0x5865F2,
    success: 0x57F287,
    warning: 0xFEE75C,
    error: 0xED4245,
    muted: 0x99AAB5,
    
    // Priority Colors (strict system)
    HIGH: 0xED4245,      // Red
    MEDIUM: 0xFEE75C,    // Yellow
    LOW: 0x57F287,       // Green
    NONE: 0x99AAB5,      // Gray
    
    // Class Colors
    DEFAULT: 0x95A5A6, HERO: 0xFFD700, GAMBLER: 0x9B59B6, ASSASSIN: 0x2C3E50,
    WIZARD: 0x3498DB, ARCHER: 0x27AE60, TANK: 0xE74C3C,
    
    // Skill Colors
    skill: 0x9B59B6, locked: 0x2C3E50, unlocked: 0x27AE60
};

// Priority indicators (minimal, clean)
const PRIORITY_DOT = { HIGH: '🔴', MEDIUM: '🟡', LOW: '🟢', NONE: '⚪', null: '⚪' };
const PRIORITY_LABEL = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low', NONE: 'Optional', null: '' };
const CATEGORY_EMOJI = { School: '📚', Work: '💼', Home: '🏠', Personal: '👤', Shopping: '🛒', Fitness: '💪' };

// ═══════════════════════════════════════════════════════════════════════════════
//  📊 PROGRESS BARS
// ═══════════════════════════════════════════════════════════════════════════════

function bar(cur, max, len = 10) {
    if (max === 0) return '▱'.repeat(len);
    const f = Math.round((cur / max) * len);
    return '▰'.repeat(Math.min(f, len)) + '▱'.repeat(Math.max(0, len - f));
}

function smoothBar(current, max, length = 12) {
    if (max === 0) return `${'▱'.repeat(length)} 0%`;
    const percent = Math.min(100, Math.round((current / max) * 100));
    const filled = Math.round((current / max) * length);
    const start = filled > 0 ? '▰' : '▱';
    const middle = '▰'.repeat(Math.max(0, filled - 1));
    const empty = '▱'.repeat(Math.max(0, length - filled));
    return `${start}${middle}${empty}`;
}

function fancyBar(current, max, length = 10, color = '🟩') {
    if (max === 0) return '⬜'.repeat(length);
    const filled = Math.round((current / max) * length);
    return color.repeat(Math.min(filled, length)) + '⬜'.repeat(Math.max(0, length - filled));
}

function xpBar(current, max, length = 15) {
    const percent = max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0;
    const filled = Math.round((current / max) * length);
    let bar = '';
    for (let i = 0; i < length; i++) {
        if (i < filled) bar += '█';
        else if (i === filled && percent > 0) bar += '▓';
        else bar += '░';
    }
    return bar;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  📋 LIST EMBEDS (Clean & Professional)
// ═══════════════════════════════════════════════════════════════════════════════

function listViewEmbed(list, items, mode = 'view', filterLabel = null) {
    const done = items.filter(i => i.completed).length;
    const total = items.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    // Color based on priority (strict system)
    let embedColor;
    if (mode === 'edit') {
        embedColor = COLORS.warning;
    } else if (list.priority) {
        embedColor = COLORS[list.priority];
    } else {
        embedColor = COLORS.muted; // Gray for no priority (optional)
    }

    const embed = new EmbedBuilder()
        .setColor(embedColor);

    // Title with category emoji if present
    const catEmoji = list.category ? (CATEGORY_EMOJI[list.category] || '📁') : '📋';
    const titleSuffix = filterLabel ? ` • ${filterLabel}` : '';
    embed.setTitle(`${catEmoji} ${list.name}${titleSuffix}`);
    
    // Build clean description
    let desc = '';
    
    // Description if exists
    if (list.description) {
        desc += `*${list.description}*\n\n`;
    }
    
    // Progress section
    const progressBar = bar(done, total, 14);
    desc += `\`${progressBar}\` **${pct}%**\n`;
    desc += `-# ${done} of ${total} tasks completed\n`;
    
    // Divider
    desc += '\n';
    
    // Items list
    if (!items.length) {
        desc += '*No tasks yet — add some!*';
    } else {
        items.forEach((it, i) => {
            const checkbox = it.completed ? '✅' : '⬜';
            const name = it.completed ? `~~${it.name}~~` : it.name;
            desc += `${checkbox} ${name}\n`;
            if (it.description) {
                desc += `-# └─ ${it.description.substring(0, 50)}${it.description.length > 50 ? '...' : ''}\n`;
            }
        });
    }
    
    embed.setDescription(desc);
    
    // Footer with metadata
    const footerParts = [];
    if (list.priority) footerParts.push(`${PRIORITY_LABEL[list.priority]} Priority`);
    if (list.deadline) {
        const d = new Date(list.deadline);
        const now = new Date();
        const isOverdue = d < now;
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        footerParts.push(isOverdue ? `⚠️ Overdue: ${dateStr}` : `Due: ${dateStr}`);
    }
    footerParts.push(mode === 'edit' ? '✏️ Edit Mode' : '👁️ View Mode');
    
    embed.setFooter({ text: footerParts.join(' • ') });
    
    return embed;
}

function listsOverviewEmbed(lists, sort = '', filter = '') {
    const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('📋 Your Lists');
    
    // Footer with sort/filter info
    let footerParts = [];
    if (sort) footerParts.push(`Sorted: ${sort}`);
    if (filter && filter !== 'ALL') footerParts.push(`Filter: ${filter}`);
    embed.setFooter({ text: footerParts.length ? footerParts.join(' • ') : 'Select a list to view' });
    
    if (!lists.length) {
        embed.setDescription('*No lists yet. Create your first one!*');
        return embed;
    }
    
    let desc = '';
    lists.forEach((l, i) => {
        // Priority indicator
        const priorityDot = PRIORITY_DOT[l.priority] || '⚪';
        
        // Build clean list entry
        // Line 1: Priority dot + List Name
        desc += `${priorityDot} **${l.name}**\n`;
        
        // Line 2: Metadata (category + deadline) in muted text
        const metaParts = [];
        
        // Category with emoji
        if (l.category && CATEGORY_EMOJI[l.category]) {
            metaParts.push(`${CATEGORY_EMOJI[l.category]} ${l.category}`);
        } else if (l.category) {
            metaParts.push(`📁 ${l.category}`);
        }
        
        // Deadline - properly formatted
        if (l.deadline) {
            try {
                const deadline = new Date(l.deadline);
                const now = new Date();
                const isOverdue = deadline < now;
                // Format: "Dec 26" or "Jan 15, 2026" if different year
                const options = { month: 'short', day: 'numeric' };
                if (deadline.getFullYear() !== now.getFullYear()) {
                    options.year = 'numeric';
                }
                const dateStr = deadline.toLocaleDateString('en-US', options);
                metaParts.push(isOverdue ? `⚠️ ${dateStr}` : `📅 ${dateStr}`);
            } catch (e) {
                // If date parsing fails, skip the deadline
            }
        }
        
        if (metaParts.length > 0) {
            desc += `-# ${metaParts.join(' · ')}\n`;
        }
        
        // Spacing between lists
        if (i < lists.length - 1) desc += '\n';
    });
    
    embed.setDescription(desc.trim());
    return embed;
}

function profileEmbed(user, stats, member) {
    const xp = user.player_xp % 100;
    const items = parseInt(stats.items.total) || 0;
    const done = parseInt(stats.items.completed) || 0;
    const rate = items > 0 ? Math.round((done / items) * 100) : 0;
    const emoji = { DEFAULT: '⚪', HERO: '⚔️', GAMBLER: '🎲', ASSASSIN: '🗡️', WIZARD: '🔮', ARCHER: '🏹', TANK: '🛡️' };
    
    return new EmbedBuilder()
        .setColor(COLORS[user.player_class])
        .setTitle(`${emoji[user.player_class]} ${member?.displayName || 'Player'}`)
        .setThumbnail(member?.user?.displayAvatarURL?.() || null)
        .setDescription(`**Level ${user.player_level}** ${user.player_class}`)
        .addFields(
            { name: '⚡ XP', value: `${bar(xp, 100)} ${xp}/100`, inline: false },
            { name: '📊 Stats', value: `📋 **${stats.lists.total}** Lists\n✅ **${done}/${items}** (${rate}%)\n🔥 **${user.streak_count}** Streak\n🏆 **${stats.achievements}** Achievements`, inline: false }
        );
}

function achievementsEmbed(userAchs, allAchs, page = 0) {
    const keys = Object.keys(allAchs);
    const pages = Math.ceil(keys.length / 8) || 1;
    const slice = keys.slice(page * 8, (page + 1) * 8);
    const unlocked = userAchs.map(a => a.achievement_key);
    
    let desc = '';
    slice.forEach(k => {
        const a = allAchs[k];
        desc += `${unlocked.includes(k) ? '🏆' : '🔒'} **${a.name}**\n${a.description}\n\n`;
    });
    
    return new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('🏆 Achievements')
        .setDescription(`${bar(unlocked.length, keys.length)} **${unlocked.length}/${keys.length}**\n\n${desc}`)
        .setFooter({ text: `Page ${page + 1}/${pages}` });
}

function achievementUnlockEmbed(ach) {
    return new EmbedBuilder().setColor(0xF1C40F).setTitle('🏆 Achievement Unlocked!').setDescription(`**${ach.name}**\n${ach.description}`);
}

function classShopEmbed(user, classes) {
    const classEmoji = { DEFAULT: '⚪', HERO: '⚔️', GAMBLER: '🎲', ASSASSIN: '🗡️', WIZARD: '🔮', ARCHER: '🏹', TANK: '🛡️' };
    const currentClass = classes[user.player_class] || classes.DEFAULT;
    
    const embed = new EmbedBuilder()
        .setColor(COLORS[user.player_class] || COLORS.primary)
        .setTitle('⚔️ Class Shop')
        .setDescription(`💰 **${user.player_xp} XP** Available\n\n**Current Class:** ${classEmoji[user.player_class]} ${user.player_class}`);
    
    Object.entries(classes).forEach(([k, c]) => {
        if (k === 'DEFAULT') return;
        const owned = user[`owns_${k.toLowerCase()}`];
        const eq = user.player_class === k;
        const statusIcon = eq ? '✅' : owned ? '🔓' : '🔒';
        const statusText = eq ? 'Equipped' : owned ? 'Owned' : `${c.cost} XP`;
        embed.addFields({ 
            name: `${statusIcon} ${c.emoji} ${c.name}`, 
            value: `*${c.description}*\n${statusText}`, 
            inline: true 
        });
    });
    
    embed.setFooter({ text: 'Buy a class to unlock special abilities!' });
    return embed;
}

function leaderboardEmbed(users) {
    const m = ['🥇', '🥈', '🥉'];
    const e = { DEFAULT: '⚪', HERO: '⚔️', GAMBLER: '🎲', ASSASSIN: '🗡️', WIZARD: '🔮', ARCHER: '🏹', TANK: '🛡️' };
    let desc = '';
    users.forEach((u, i) => { desc += `${m[i] || `#${i + 1}`} ${e[u.player_class]} Lv.${u.player_level} • ${u.player_xp}XP • 🔥${u.streak_count}\n`; });
    return new EmbedBuilder().setColor(0xF1C40F).setTitle('🏆 Leaderboard').setDescription(desc || '*No players*');
}

function xpEmbed(xp, bonus, lvlUp, newLvl) {
    return new EmbedBuilder()
        .setColor(lvlUp ? 0xF1C40F : COLORS.success)
        .setTitle(lvlUp ? '🎉 Level Up!' : '⚡ XP')
        .setDescription(`**+${xp} XP**${bonus?.details ? `\n${bonus.details}` : ''}${lvlUp ? `\n\n🎊 **Level ${newLvl}**` : ''}`);
}

function pingEmbed(botLatency, apiLatency) {
    return new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('🏓 Pong!')
        .addFields(
            { name: 'Bot Latency', value: `\`${botLatency}ms\``, inline: true },
            { name: 'API Latency', value: `\`${apiLatency}ms\``, inline: true }
        );
}

function helpEmbed() {
    return new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('TaskQuest Commands')
        .setDescription('A gamified task manager with RPG elements')
        .addFields(
            { name: 'Tasks', value: '`/list` Manage lists', inline: true },
            { name: 'Games', value: '`/game` Mini-games', inline: true },
            { name: 'Daily', value: '`/daily` Claim XP', inline: true },
            { name: 'Profile', value: '`/profile` `/achievements`', inline: true },
            { name: 'Classes', value: '`/class` `/leaderboard`', inline: true },
            { name: 'Settings', value: '`/toggle` `/automation`', inline: true },
            { name: 'Web App', value: '`/app` Open dashboard', inline: true }
        )
        .setFooter({ text: 'TaskQuest v3.8' });
}

const success = (t, d) => new EmbedBuilder().setColor(COLORS.success).setDescription(`✅ **${t}**${d ? `\n${d}` : ''}`);
const error = (t, d) => new EmbedBuilder().setColor(COLORS.error).setDescription(`❌ **${t}**${d ? `\n${d}` : ''}`);
const info = (t, d) => new EmbedBuilder().setColor(COLORS.primary).setDescription(`ℹ️ **${t}**${d ? `\n${d}` : ''}`);
const warn = (t, d) => new EmbedBuilder().setColor(COLORS.warning).setDescription(`⚠️ **${t}**${d ? `\n${d}` : ''}`);

// ═══════════════════════════════════════════════════════════════════════════════
//  🔘 BUTTONS
// ═══════════════════════════════════════════════════════════════════════════════

function viewButtons(listId) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`sort_az_${listId}`).setLabel('A→Z').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`sort_za_${listId}`).setLabel('Z→A').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`sort_pri_${listId}`).setLabel('Priority').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`search_${listId}`).setEmoji('🔍').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`refresh_${listId}`).setEmoji('🔄').setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`edit_${listId}`).setLabel('Edit List').setEmoji('✏️').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('back').setLabel('Back').setStyle(ButtonStyle.Secondary)
        )
    ];
}

function editButtons(listId) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`item_add_${listId}`).setLabel('Add').setEmoji('➕').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`item_edit_${listId}`).setLabel('Edit').setEmoji('✏️').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`item_del_${listId}`).setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`item_done_${listId}`).setLabel('Mark Done').setEmoji('✅').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`item_swap_${listId}`).setLabel('Reorder').setEmoji('🔀').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`item_desc_${listId}`).setLabel('Description').setEmoji('📝').setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`list_meta_${listId}`).setLabel('List Info').setEmoji('📋').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`list_del_${listId}`).setLabel('Delete List').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`view_${listId}`).setLabel('Done').setStyle(ButtonStyle.Secondary)
        )
    ];
}

function overviewButtons() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('sort_az').setLabel('A→Z').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('sort_date').setLabel('Date').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('sort_pri').setLabel('Priority').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('filter_cat').setLabel('Filter').setEmoji('🏷️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('create').setLabel('Create').setEmoji('➕').setStyle(ButtonStyle.Success)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('filter_all').setLabel('All').setEmoji('📋').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('filter_current').setLabel('Current').setEmoji('📝').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('filter_expired').setLabel('Expired').setEmoji('⏰').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('filter_completed').setLabel('Completed').setEmoji('✅').setStyle(ButtonStyle.Secondary)
        )
    ];
}

// Category filter select menu for list filtering
function categoryFilterSelect() {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('filter_category')
            .setPlaceholder('🏷️ Filter by category...')
            .addOptions([
                { label: 'All Categories', value: 'ALL', emoji: '📋', description: 'Show all lists' },
                { label: 'School', value: 'School', emoji: '📚' },
                { label: 'Work', value: 'Work', emoji: '💼' },
                { label: 'Home', value: 'Home', emoji: '🏠' },
                { label: 'Personal', value: 'Personal', emoji: '👤' },
                { label: 'Shopping', value: 'Shopping', emoji: '🛒' },
                { label: 'Fitness', value: 'Fitness', emoji: '💪' },
                { label: 'Uncategorized', value: 'NONE', emoji: '⚪', description: 'Lists without category' }
            ])
    );
}

function confirmButtons(listId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`yes_${listId}`).setLabel('Delete').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`no_${listId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );
}

function classButtons(user, classes) {
    const rows = [];
    let row = new ActionRowBuilder();
    let c = 0;
    Object.entries(classes).forEach(([k, v]) => {
        if (k === 'DEFAULT') return;
        const owned = user[`owns_${k.toLowerCase()}`];
        const eq = user.player_class === k;
        const can = user.player_xp >= v.cost;
        let id, label, style, dis;
        if (eq) { id = `cx_${k}`; label = `${v.name}✓`; style = ButtonStyle.Success; dis = true; }
        else if (owned) { id = `ceq_${k}`; label = `Equip`; style = ButtonStyle.Primary; dis = false; }
        else if (can) { id = `cbuy_${k}`; label = `Buy`; style = ButtonStyle.Success; dis = false; }
        else { id = `cx_${k}`; label = `${v.cost}XP`; style = ButtonStyle.Secondary; dis = true; }
        row.addComponents(new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(v.emoji).setStyle(style).setDisabled(dis));
        c++;
        if (c % 3 === 0) { rows.push(row); row = new ActionRowBuilder(); }
    });
    if (row.components.length) rows.push(row);
    
    // Add "Return to Default" button if user has a non-default class equipped
    if (user.player_class !== 'DEFAULT') {
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ceq_DEFAULT')
                .setLabel('Return to Default')
                .setEmoji('⚪')
                .setStyle(ButtonStyle.Secondary)
        ));
    }
    
    return rows;
}

function achButtons(page, total) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ach_first').setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId('ach_prev').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId('ach_x').setLabel(`${page + 1}/${total}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('ach_next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= total - 1),
        new ButtonBuilder().setCustomId('ach_last').setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(page >= total - 1)
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  📋 SELECTS
// ═══════════════════════════════════════════════════════════════════════════════

function listSelect(lists, id = 'sel_list') {
    if (!lists.length) return null;
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(id).setPlaceholder('Select a list').addOptions(
            lists.slice(0, 25).map(l => {
                // Build clean description
                const descParts = [];
                if (l.category) descParts.push(l.category);
                if (l.deadline) {
                    try {
                        const d = new Date(l.deadline);
                        descParts.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
                    } catch (e) {}
                }
                
                return {
                    label: l.name.substring(0, 100),
                    value: String(l.id),
                    emoji: PRIORITY_DOT[l.priority] || '📋',
                    description: descParts.length > 0 ? descParts.join(' · ').substring(0, 100) : undefined
                };
            })
        )
    );
}

function itemSelect(items, id, ph = 'Select item...') {
    if (!items.length) return null;
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(ph).addOptions(
            items.slice(0, 25).map((it, i) => ({ label: `${i + 1}. ${it.name.substring(0, 90)}`, value: String(it.id), emoji: it.completed ? '✅' : '⬜' }))
        )
    );
}

function catSelect(id) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(id).setPlaceholder('Category...').addOptions([
            { label: 'None', value: 'NONE', emoji: '⚪' },
            { label: 'School', value: 'School', emoji: '📚' },
            { label: 'Work', value: 'Work', emoji: '💼' },
            { label: 'Home', value: 'Home', emoji: '🏠' },
            { label: 'Personal', value: 'Personal', emoji: '👤' },
            { label: 'Shopping', value: 'Shopping', emoji: '🛒' },
            { label: 'Fitness', value: 'Fitness', emoji: '💪' }
        ])
    );
}

function priSelect(id) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(id).setPlaceholder('Priority...').addOptions([
            { label: 'None', value: 'NONE', emoji: '⚪' },
            { label: 'Low', value: 'LOW', emoji: '🟢' },
            { label: 'Medium', value: 'MEDIUM', emoji: '🟡' },
            { label: 'High', value: 'HIGH', emoji: '🔴' }
        ])
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  📝 MODALS
// ═══════════════════════════════════════════════════════════════════════════════

function listModal(existing = null) {
    const m = new ModalBuilder().setCustomId(existing ? `m_editlist_${existing.id}` : 'm_newlist').setTitle(existing ? 'Edit List' : 'Create List');
    const n = new TextInputBuilder().setCustomId('name').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100);
    const d = new TextInputBuilder().setCustomId('desc').setLabel('Description (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false);
    const dl = new TextInputBuilder().setCustomId('deadline').setLabel('Deadline YYYY-MM-DD (optional)').setStyle(TextInputStyle.Short).setRequired(false);
    if (existing) { n.setValue(existing.name); if (existing.description) d.setValue(existing.description); if (existing.deadline) dl.setValue(existing.deadline); }
    m.addComponents(new ActionRowBuilder().addComponents(n), new ActionRowBuilder().addComponents(d), new ActionRowBuilder().addComponents(dl));
    return m;
}

function itemModal(listId) {
    return new ModalBuilder().setCustomId(`m_additem_${listId}`).setTitle('Add Item').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel('Description (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false))
    );
}

function editItemModal(item) {
    return new ModalBuilder().setCustomId(`m_edititem_${item.id}`).setTitle('Edit Item').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(true).setValue(item.name))
    );
}

function descModal(item) {
    const d = new TextInputBuilder().setCustomId('desc').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(false);
    if (item.description) d.setValue(item.description);
    return new ModalBuilder().setCustomId(`m_desc_${item.id}`).setTitle(`Description: ${item.name.substring(0, 30)}`).addComponents(new ActionRowBuilder().addComponents(d));
}

function searchModal() {
    return new ModalBuilder().setCustomId('m_search').setTitle('Search').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q').setLabel('Search').setStyle(TextInputStyle.Short).setRequired(true))
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🌳 SKILL TREE UI
// ═══════════════════════════════════════════════════════════════════════════════

function skillTreeEmbed(user, classKey, skillTree, userSkills) {
    const classEmoji = { DEFAULT: '⚪', HERO: '⚔️', GAMBLER: '🎲', ASSASSIN: '🗡️', WIZARD: '🔮', ARCHER: '🏹', TANK: '🛡️' };
    const tree = skillTree[classKey];
    if (!tree) return error('Invalid Class', 'Skill tree not found');
    
    const userSkillMap = new Map(userSkills.map(s => [s.skill_id, s.skill_level]));
    
    const embed = new EmbedBuilder()
        .setColor(COLORS[classKey] || COLORS.primary)
        .setTitle(`${classEmoji[classKey]} ${tree.name} Skills`)
        .setDescription(`*${tree.description}*\n\n💰 **XP Available:** ${user.player_xp.toLocaleString()}`);
    
    // Build skill tree visualization with progress
    let skillList = '';
    Object.entries(tree.skills).forEach(([skillId, skill]) => {
        const hasSkill = userSkillMap.has(skillId);
        const skillLevel = userSkillMap.get(skillId) || 0;
        const maxed = skillLevel >= skill.maxLevel;
        const reqMet = !skill.requires || userSkillMap.has(skill.requires);
        
        // Status indicator
        let statusIcon;
        if (maxed) statusIcon = '✅';
        else if (hasSkill) statusIcon = '🔶';
        else if (reqMet) statusIcon = '🔓';
        else statusIcon = '🔒';
        
        // Progress bar for multi-level skills
        let progressDisplay = '';
        if (skill.maxLevel > 1) {
            const filled = Math.round((skillLevel / skill.maxLevel) * 5);
            progressDisplay = ` \`${'■'.repeat(filled)}${'□'.repeat(5 - filled)}\` ${skillLevel}/${skill.maxLevel}`;
        }
        
        const effectText = skill.effect(Math.max(1, skillLevel));
        
        skillList += `${statusIcon} ${skill.emoji} **${skill.name}**${progressDisplay}\n`;
        skillList += `└ ${effectText} • ${skill.cost} XP\n\n`;
    });
    
    embed.addFields({ name: '\u200B', value: skillList || '*No skills available*', inline: false });
    embed.setFooter({ text: '🔓 Available • 🔶 Upgradeable • ✅ Maxed • 🔒 Locked' });
    
    return embed;
}

function skillInfoEmbed(skill, skillId, userSkillLevel, requirementMet) {
    const currentLevel = userSkillLevel || 0;
    const maxed = currentLevel >= skill.maxLevel;
    
    // Progress bar for skill
    let progressDisplay = '';
    if (skill.maxLevel > 1) {
        const filled = Math.round((currentLevel / skill.maxLevel) * 10);
        progressDisplay = `\`${'▓'.repeat(filled)}${'░'.repeat(10 - filled)}\` ${currentLevel}/${skill.maxLevel}`;
    } else {
        progressDisplay = currentLevel > 0 ? '✅ Unlocked' : '🔒 Locked';
    }
    
    const embed = new EmbedBuilder()
        .setColor(maxed ? COLORS.success : requirementMet ? COLORS.primary : COLORS.locked)
        .setTitle(`${skill.emoji} ${skill.name}`)
        .setDescription([
            skill.description,
            ``,
            `**Progress**`,
            progressDisplay,
            ``,
            `**Effect:** ${skill.effect(Math.max(1, currentLevel))}`,
            `**Cost:** ${skill.cost} XP`
        ].join('\n'));
    
    if (skill.requires && !requirementMet) {
        embed.addFields({ name: 'Requires', value: `🔒 Unlock **${skill.requires}** first`, inline: false });
    }
    
    if (maxed) {
        embed.setFooter({ text: 'Skill maxed!' });
    }
    
    return embed;
}

function classOverviewEmbed(user, classes, skillTrees) {
    const classEmoji = { DEFAULT: '⚪', HERO: '⚔️', GAMBLER: '🎲', ASSASSIN: '🗡️', WIZARD: '🔮', ARCHER: '🏹', TANK: '🛡️' };
    const currentClass = user.player_class;
    const currentInfo = classes[currentClass];
    
    const embed = new EmbedBuilder()
        .setColor(COLORS[currentClass] || COLORS.primary)
        .setTitle('⚔️ Class System')
        .setDescription([
            `**Current Class:** ${classEmoji[currentClass]} **${currentClass}**`,
            `*${currentInfo?.description || 'No bonus'}*`,
            ``,
            `💰 **XP Available:** ${user.player_xp.toLocaleString()}`
        ].join('\n'));
    
    // Add class cards in clean format
    Object.entries(classes).forEach(([k, c]) => {
        if (k === 'DEFAULT') return;
        const owned = user[`owns_${k.toLowerCase()}`];
        const eq = currentClass === k;
        const tree = skillTrees[k];
        const skillCount = tree ? Object.keys(tree.skills).length : 0;
        
        let status;
        if (eq) status = '✅ Equipped';
        else if (owned) status = '🔓 Owned';
        else status = `🔒 ${c.cost} XP`;
        
        embed.addFields({
            name: `${c.emoji} ${c.name}`,
            value: `${status}\n${skillCount} skills`,
            inline: true
        });
    });
    
    embed.setFooter({ text: 'Select a class to view details or use the browser below' });
    return embed;
}

// Video game style class detail view - one class at a time
function classDetailEmbed(user, classKey, classInfo, skillTree, classIndex, totalClasses) {
    const classColors = {
        DEFAULT: 0x95A5A6, HERO: 0xFFD700, GAMBLER: 0x9B59B6,
        ASSASSIN: 0x2C3E50, WIZARD: 0x3498DB, ARCHER: 0x27AE60, TANK: 0xE74C3C
    };
    
    const owned = classKey === 'DEFAULT' || user[`owns_${classKey.toLowerCase()}`];
    const equipped = user.player_class === classKey;
    const canAfford = user.player_xp >= (classInfo.cost || 0);
    const skillCount = skillTree ? Object.keys(skillTree.skills).length : 0;
    
    // Status badge
    let statusBadge;
    if (equipped) statusBadge = '✅ EQUIPPED';
    else if (owned) statusBadge = '🔓 OWNED';
    else if (canAfford) statusBadge = '💰 AVAILABLE';
    else statusBadge = '🔒 LOCKED';
    
    const embed = new EmbedBuilder()
        .setColor(classColors[classKey] || 0x5865F2)
        .setTitle(`${classInfo.emoji} ${classInfo.name}`)
        .setDescription([
            `### ${statusBadge}`,
            ``,
            `*${classInfo.description}*`,
            ``
        ].join('\n'));
    
    // Playstyle summary
    const playstyles = {
        DEFAULT: 'Balanced gameplay with no bonuses or penalties. Great for learning the system.',
        HERO: 'Consistent XP gains on every action. Reliable progress for steady players.',
        GAMBLER: 'Random XP multipliers ranging from 0.5x to 2x. High risk, high reward gameplay.',
        ASSASSIN: 'Build streaks to stack bonuses. Perfect for consistent daily players.',
        WIZARD: 'Every third task gives double XP. Strategic task completion.',
        ARCHER: 'Precision-based multipliers and crits. Rewards careful planning.',
        TANK: 'Shield stacking system. Strong early game with momentum building.'
    };
    
    embed.addFields({
        name: '🎮 Playstyle',
        value: playstyles[classKey] || 'Unique gameplay mechanics.',
        inline: false
    });
    
    // Cost and skills
    embed.addFields(
        {
            name: '💰 Cost',
            value: classKey === 'DEFAULT' ? 'Free' : `${classInfo.cost} XP`,
            inline: true
        },
        {
            name: '🌳 Skills',
            value: `${skillCount} available`,
            inline: true
        },
        {
            name: '📊 Your XP',
            value: `${user.player_xp.toLocaleString()}`,
            inline: true
        }
    );
    
    // Skill preview
    if (skillTree && Object.keys(skillTree.skills).length > 0) {
        const skillPreview = Object.values(skillTree.skills)
            .slice(0, 3)
            .map(s => `${s.emoji} ${s.name}`)
            .join(' • ');
        embed.addFields({
            name: '✨ Skill Preview',
            value: skillPreview,
            inline: false
        });
    }
    
    embed.setFooter({ text: `Class ${classIndex + 1} of ${totalClasses} • Use ◀ ▶ to browse` });
    
    return embed;
}

function classNavButtons(user, currentView, selectedClass) {
    const rows = [];
    
    // Main navigation row
    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('class_overview')
            .setLabel('All Classes')
            .setEmoji('📋')
            .setStyle(currentView === 'overview' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('class_browse')
            .setLabel('Browse')
            .setEmoji('🎮')
            .setStyle(currentView === 'browse' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('class_skills')
            .setLabel('Skill Tree')
            .setEmoji('🌳')
            .setStyle(currentView === 'skills' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(!selectedClass)
    );
    rows.push(navRow);
    
    return rows;
}

// Browser navigation buttons for video game style class browsing
function classBrowserButtons(user, classKey, classInfo, classIndex, totalClasses) {
    const owned = classKey === 'DEFAULT' || user[`owns_${classKey.toLowerCase()}`];
    const equipped = user.player_class === classKey;
    const canAfford = user.player_xp >= (classInfo.cost || 0);
    
    const rows = [];
    
    // Navigation row: Previous / Class Count / Next
    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('class_prev')
            .setLabel('◀')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(classIndex === 0),
        new ButtonBuilder()
            .setCustomId('class_browse_indicator')
            .setLabel(`${classIndex + 1} / ${totalClasses}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('class_next')
            .setLabel('▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(classIndex >= totalClasses - 1)
    );
    rows.push(navRow);
    
    // Action row
    const actionRow = new ActionRowBuilder();
    
    if (equipped) {
        actionRow.addComponents(
            new ButtonBuilder()
                .setCustomId('class_equipped_indicator')
                .setLabel('Currently Equipped')
                .setEmoji('✅')
                .setStyle(ButtonStyle.Success)
                .setDisabled(true)
        );
    } else if (owned) {
        actionRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`ceq_${classKey}`)
                .setLabel('Select Class')
                .setEmoji(classInfo.emoji)
                .setStyle(ButtonStyle.Primary)
        );
    } else if (classKey !== 'DEFAULT') {
        actionRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`cbuy_${classKey}`)
                .setLabel(`Unlock (${classInfo.cost} XP)`)
                .setEmoji('🔓')
                .setStyle(canAfford ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(!canAfford)
        );
    }
    
    // View skills button
    actionRow.addComponents(
        new ButtonBuilder()
            .setCustomId('class_skills')
            .setLabel('View Skills')
            .setEmoji('🌳')
            .setStyle(ButtonStyle.Secondary)
    );
    
    // Return to default button (if not already default)
    if (user.player_class !== 'DEFAULT') {
        actionRow.addComponents(
            new ButtonBuilder()
                .setCustomId('class_return_default')
                .setLabel('Return to Default')
                .setEmoji('⚪')
                .setStyle(ButtonStyle.Secondary)
        );
    }
    
    rows.push(actionRow);
    
    return rows;
}

function classSelectMenu(classes, user) {
    const options = [];
    
    Object.entries(classes).forEach(([k, c]) => {
        if (k === 'DEFAULT') return;
        const owned = user[`owns_${k.toLowerCase()}`];
        const eq = user.player_class === k;
        
        options.push({
            label: c.name,
            value: k,
            emoji: c.emoji,
            description: eq ? 'Equipped' : owned ? 'Owned' : `${c.cost} XP to unlock`,
            default: eq
        });
    });
    
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('class_select')
            .setPlaceholder('Select a class...')
            .addOptions(options)
    );
}

function skillSelectMenu(skillTree, userSkills) {
    const userSkillMap = new Map(userSkills.map(s => [s.skill_id, s.skill_level]));
    const options = [];
    
    if (!skillTree || !skillTree.skills || Object.keys(skillTree.skills).length === 0) {
        // Return a placeholder if no skills
        return new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('skill_select')
                .setPlaceholder('No skills available')
                .addOptions([{ label: 'No Skills', value: 'none', description: 'This class has no skills yet' }])
                .setDisabled(true)
        );
    }
    
    Object.entries(skillTree.skills).forEach(([skillId, skill]) => {
        const hasSkill = userSkillMap.has(skillId);
        const skillLevel = userSkillMap.get(skillId) || 0;
        const maxed = skillLevel >= skill.maxLevel;
        const reqMet = !skill.requires || userSkillMap.has(skill.requires);
        
        let status = maxed ? '✅' : hasSkill ? '🔶' : reqMet ? '🔓' : '🔒';
        
        options.push({
            label: skill.name,
            value: skillId,
            emoji: skill.emoji,
            description: `${status} ${skill.effect(Math.max(1, skillLevel))}`
        });
    });
    
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('skill_select')
            .setPlaceholder('Select a skill to view/unlock...')
            .addOptions(options)
    );
}

function skillActionButtons(skillId, skill, userSkillLevel, requirementMet, userXP) {
    const currentLevel = userSkillLevel || 0;
    const maxed = currentLevel >= skill.maxLevel;
    const canAfford = userXP >= skill.cost;
    const canUnlock = requirementMet && canAfford && !maxed;
    
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`skill_unlock_${skillId}`)
            .setLabel(currentLevel > 0 ? 'Upgrade' : 'Unlock')
            .setEmoji(currentLevel > 0 ? '⬆️' : '🔓')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!canUnlock),
        new ButtonBuilder()
            .setCustomId('skill_back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
    );
    
    return row;
}

module.exports = {
    COLORS, bar, smoothBar, fancyBar, xpBar,
    // Embeds
    listViewEmbed, listsOverviewEmbed, profileEmbed, achievementsEmbed, achievementUnlockEmbed,
    classShopEmbed, leaderboardEmbed, xpEmbed, pingEmbed, helpEmbed,
    // Skill Tree
    skillTreeEmbed, skillInfoEmbed, classOverviewEmbed, classDetailEmbed,
    // Feedback
    success, error, info, warn,
    // Buttons
    viewButtons, editButtons, overviewButtons, confirmButtons, classButtons, achButtons,
    classNavButtons, classBrowserButtons, skillActionButtons,
    // Selects
    listSelect, itemSelect, catSelect, priSelect, classSelectMenu, skillSelectMenu, categoryFilterSelect,
    // Modals
    listModal, itemModal, editItemModal, descModal, searchModal
};
