/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🎨 TASKQUEST UI (v3.7 - Clean & Professional)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { escapeDiscord, TEXT_LIMITS, CLASSES, CLASS_RULES, PRESTIGE_TITLES, validation, levelProgress, isPastDeadline, formatDeadline, todayInZone } = require('@taskquest/shared');

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
    MONK: 0x1ABC9C, ARTISAN: 0xD35400, RANGER: 0xA0764B, NECROMANCER: 0x5B2C6F, PALADIN: 0xECF0F1, WARDEN: 0xE17055, CHRONOMANCER: 0x6C5CE7, DRUID: 0x7CB342, ALCHEMIST: 0x00B894, BARD: 0xE91E8C,
    
    // Skill Colors
    skill: 0x9B59B6, locked: 0x2C3E50, unlocked: 0x27AE60
};

/** Emoji for a class key; unknown keys fall back to the Default icon. */
const classEmoji = (key) => CLASSES[key]?.emoji || '⚪';

/**
 * One line describing the equipped class's live counter (Monk rhythm, Artisan progress,
 * Necromancer souls), or '' for classes without one. The caps depend on the owner's skills.
 */
function classCounterLine(user, userSkills = [], now = Date.now()) {
    const levels = new Map((userSkills || []).map((s) => [s.skill_id, Number(s.skill_level) || 0]));
    const lvl = (id) => levels.get(id) || 0;
    switch (user.player_class) {
        case 'MONK': {
            const m = CLASS_RULES.MONK;
            const cap = m.MAX_RHYTHM + (lvl('monk_discipline') ? m.DISCIPLINE_CAP : 0);
            const rhythm = Math.min(cap, Number(user.monk_rhythm) || 0);
            const last = user.monk_day ? new Date(user.monk_day).toISOString().slice(0, 10) : null;
            const today = todayInZone(user.timezone, new Date(now)); // the user's own day, like the rule
            const gap = last ? Math.round((Date.parse(today) - Date.parse(last)) / 86400000) : null;
            const lapsed = rhythm > 0 && gap !== null && gap > (lvl('monk_serenity') ? 2 : 1);
            return `🧘 Rhythm **${rhythm}/${cap}**${lapsed ? ' (lapsed, restarts at 1)' : ''}`;
        }
        case 'ARTISAN': {
            const a = CLASS_RULES.ARTISAN;
            const cap = a.MAX_PROGRESS + lvl('artisan_blueprint') * a.BLUEPRINT_CAP;
            return `🛠️ Project **${Math.min(cap, Number(user.artisan_progress) || 0)}/${cap}**`;
        }
        case 'NECROMANCER': {
            const n = CLASS_RULES.NECROMANCER;
            const cap = n.MAX_SOULS + (lvl('necro_jar') ? n.JAR_SOULS : 0);
            return `💀 Souls **${Math.min(cap, Number(user.necro_souls) || 0)}/${cap}**`;
        }
        case 'ALCHEMIST': {
            const mix = Number(user.alchemist_mix) || 0;
            return `⚗️ Brew **${(mix & 1) + ((mix >> 1) & 1) + ((mix >> 2) & 1)}/3** ingredients`;
        }
        case 'BARD': {
            const window = lvl('bard_harmony') ? CLASS_RULES.BARD.HARMONY_WINDOW : CLASS_RULES.BARD.WINDOW;
            const recent = String(user.bard_recent || '').split(',').filter(Boolean).slice(-window);
            return `🎵 Medley **${new Set(recent).size}/${window}** lists`;
        }
        default:
            return '';
    }
}

/** Human text for a daily milestone chest, whatever shape the shared result gives it. */
function describeChest(chest) {
    if (!chest) return '';
    if (typeof chest === 'number') return `+${chest} XP`;
    if (typeof chest === 'string') return chest;
    const xp = chest.xp ?? chest.bonusXP ?? chest.amount;
    const label = chest.label ?? chest.name ?? (chest.streak ? `${chest.streak}-day streak` : '');
    return [label, xp !== undefined ? `+${xp} XP` : ''].filter(Boolean).join(': ');
}

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

/** Embed descriptions hold 4096 characters; leave room for the "and N more" note. */
const DESCRIPTION_BUDGET = 3900;

/**
 * Top-level tasks in order, each followed by its subtasks (one level). A subtask whose
 * parent is not in `items` is shown as a top-level task.
 * @returns {Array<{ item: object, nested: boolean }>}
 */
function orderItems(items) {
    const ids = new Set(items.map((i) => i.id));
    const children = new Map();
    for (const it of items) {
        if (it.parent_id && ids.has(it.parent_id)) {
            if (!children.has(it.parent_id)) children.set(it.parent_id, []);
            children.get(it.parent_id).push(it);
        }
    }
    const out = [];
    for (const it of items) {
        if (it.parent_id && ids.has(it.parent_id)) continue;
        out.push({ item: it, nested: false });
        for (const c of children.get(it.id) || []) out.push({ item: c, nested: true });
    }
    return out;
}

/** "🔴 · 📅 Mar 10 · 🔁 weekly · #home #bills" for a task's own fields ('' when it has none). */
function itemMeta(it, today = undefined) {
    const parts = [];
    if (it.priority) parts.push(PRIORITY_DOT[it.priority] || '');
    const due = validation.formatDate(it.due_date);
    if (due) parts.push(!it.completed && isPastDeadline(due, today) ? `⚠️ ${formatDeadline(due, today)}` : `📅 ${formatDeadline(due, today)}`);
    if (it.recurrence) parts.push(`🔁 ${it.recurrence}`);
    const tags = String(it.tags || '').split(',').filter(Boolean);
    if (tags.length) parts.push(tags.map((t) => `#${t}`).join(' '));
    return parts.filter(Boolean).join(' · ');
}

/** The lines for one task: name (indented when a subtask), details, description. */
function itemLines(it, nested, today) {
    const pad = nested ? '　' : '';
    const safeName = escapeDiscord(it.name, { max: 200 });
    const name = it.completed ? `~~${safeName}~~` : safeName;
    let out = `${pad}${nested ? '↳ ' : ''}${it.completed ? '✅' : '⬜'} ${name}\n`;
    const meta = itemMeta(it, today);
    if (meta) out += `${pad}-# └─ ${meta}\n`;
    if (it.description) out += `${pad}-# └─ ${escapeDiscord(it.description, { max: 50 })}\n`;
    return out;
}

/** `today` is the viewer's own date (todayInZone of their time zone): a deadline is overdue once their day has passed, not UTC's. */
function listViewEmbed(list, items, mode = 'view', filterLabel = null, today = todayInZone()) {
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
    embed.setTitle(`${catEmoji} ${list.name}${list.shared ? ' 👥' : ''}${titleSuffix}`);
    
    // Build clean description
    let desc = '';
    
    // Description if exists
    if (list.description) {
        desc += `*${escapeDiscord(list.description, { max: 300 })}*\n\n`;
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
        const ordered = orderItems(items);
        let shown = 0;
        for (const { item, nested } of ordered) {
            const lines = itemLines(item, nested, today);
            if (desc.length + lines.length > DESCRIPTION_BUDGET) break;
            desc += lines;
            shown++;
        }
        if (shown < ordered.length) desc += `-# … and ${ordered.length - shown} more tasks (open the web app to see them all)\n`;
    }
    
    embed.setDescription(desc);
    
    // Footer with metadata
    const footerParts = [];
    if (list.priority) footerParts.push(`${PRIORITY_LABEL[list.priority]} Priority`);
    if (list.deadline) {
        const dateStr = formatDeadline(list.deadline, today);
        footerParts.push(isPastDeadline(list.deadline, today) ? `⚠️ Overdue: ${dateStr}` : `Due: ${dateStr}`);
    }
    if (list.shared) footerParts.push(list.is_owner ? `👥 ${list.member_count} people` : `👥 ${list.role} · by ${escapeDiscord(list.owner_name, { max: 60 }) || 'someone'}`);
    footerParts.push(mode === 'edit' ? '✏️ Edit Mode' : list.shared && list.role === 'viewer' ? '👁️ View only' : '👁️ View Mode');
    
    embed.setFooter({ text: footerParts.join(' • ') });
    
    return embed;
}

function listsOverviewEmbed(lists, sort = '', filter = '', today = todayInZone()) {
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
    let shown = 0;
    for (let i = 0; i < lists.length; i++) {
        const l = lists[i];
        let entry = '';
        // Priority indicator
        const priorityDot = PRIORITY_DOT[l.priority] || '⚪';
        
        // Build clean list entry
        // Line 1: Priority dot + List Name
        entry += `${priorityDot} **${escapeDiscord(l.name, { max: 100 })}**${l.shared ? ' 👥' : ''}\n`;
        
        // Line 2: Metadata (category + deadline) in muted text
        const metaParts = [];
        
        // Category with emoji (free text, and on a shared list someone else wrote it, so escaped like the name)
        if (l.category && CATEGORY_EMOJI[l.category]) {
            metaParts.push(`${CATEGORY_EMOJI[l.category]} ${escapeDiscord(l.category, { max: 50 })}`);
        } else if (l.category) {
            metaParts.push(`📁 ${escapeDiscord(l.category, { max: 50 })}`);
        }
        
        // Deadline - properly formatted
        if (l.deadline) {
            const dateStr = formatDeadline(l.deadline, today);
            if (dateStr) metaParts.push(isPastDeadline(l.deadline, today) ? `⚠️ ${dateStr}` : `📅 ${dateStr}`);
        }
        
        if (l.shared) metaParts.push(l.is_owner ? `shared with ${Number(l.member_count) - 1}` : `${l.role} · by ${escapeDiscord(l.owner_name, { max: 60 }) || 'someone'}`);

        if (metaParts.length > 0) {
            entry += `-# ${metaParts.join(' · ')}\n`;
        }
        
        // Spacing between lists
        entry += '\n';
        // An embed description holds 4096 characters: stop before it overflows (about 110 lists with a category and
        // a deadline) and say how many are left, instead of letting the whole command fail.
        if (desc.length + entry.length > DESCRIPTION_BUDGET - 80) break;
        desc += entry;
        shown++;
    }
    if (shown < lists.length) desc += `\n*…and ${lists.length - shown} more. Use the menu, search or filters below.*`;

    embed.setDescription(desc.trim());
    return embed;
}

function profileEmbed(user, stats, member) {
    const xp = levelProgress(user.lifetime_xp ?? user.player_xp).current;
    const items = parseInt(stats.items.total) || 0;
    const done = parseInt(stats.items.completed) || 0;
    const rate = items > 0 ? Math.round((done / items) * 100) : 0;
    
    return new EmbedBuilder()
        .setColor(COLORS[user.player_class])
        .setTitle(`${classEmoji(user.player_class)} ${member?.displayName || 'Player'}${prestigeTitle(user) ? ` · ${prestigeTitle(user)}` : ''}`)
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
    const reward = Number(ach.xp) > 0 ? `\n**+${Number(ach.xp)} XP**` : '';
    return new EmbedBuilder().setColor(0xF1C40F).setTitle('🏆 Achievement Unlocked!').setDescription(`**${ach.name}**\n${ach.description}${reward}`);
}

/** The prestige title for a player ('' before the first prestige). */
const prestigeTitle = (user) => PRESTIGE_TITLES[Math.min(Number(user?.prestige) || 0, PRESTIGE_TITLES.length - 1)] || '';

/** The task-completion bonuses ([{ key, label, xp }]) as lines under the completion message ('' when none). */
function bonusLines(bonuses) {
    const rows = (bonuses || []).filter((b) => b && Number(b.xp) > 0);
    return rows.length ? `\n${rows.map((b) => `-# ✨ ${b.label}: +${Number(b.xp)} XP`).join('\n')}` : '';
}

function classShopEmbed(user, classes) {
    const embed = new EmbedBuilder()
        .setColor(COLORS[user.player_class] || COLORS.primary)
        .setTitle('⚔️ Class Shop')
        .setDescription(`💰 **${user.player_xp} XP** Available\n\n**Current Class:** ${classEmoji(user.player_class)} ${user.player_class}`);
    
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
            { name: 'Tasks', value: '`/list` `/quick`', inline: true },
            { name: 'Sharing', value: '`/share` `/invites` `/members` `/leave`', inline: true },
            { name: 'Party', value: '`/party` Team weekly quest', inline: true },
            { name: 'Games', value: '`/game` Mini-games', inline: true },
            { name: 'Daily', value: '`/daily` `/freeze` `/quests` `/review`', inline: true },
            { name: 'Profile', value: '`/profile` `/achievements`', inline: true },
            { name: 'Classes', value: '`/class` `/shop` `/leaderboard` `/prestige`', inline: true },
            { name: 'Settings', value: '`/toggle` `/automation` `/timezone` `/weekly`', inline: true },
            { name: 'Web App', value: '`/app` Open dashboard\n`/ping` Latency', inline: true },
            { name: 'AI', value: '`/summary` `/prioritize` `/ask` `/forget` `/ai-format`', inline: true }
        )
        .setFooter({ text: 'TaskQuest v4.0' });
}

const success = (t, d) => new EmbedBuilder().setColor(COLORS.success).setDescription(`✅ **${t}**${d ? `\n${d}` : ''}`);
const error = (t, d) => new EmbedBuilder().setColor(COLORS.error).setDescription(`❌ **${t}**${d ? `\n${d}` : ''}`);
const info = (t, d) => new EmbedBuilder().setColor(COLORS.primary).setDescription(`ℹ️ **${t}**${d ? `\n${d}` : ''}`);
const warn = (t, d) => new EmbedBuilder().setColor(COLORS.warning).setDescription(`⚠️ **${t}**${d ? `\n${d}` : ''}`);

// ═══════════════════════════════════════════════════════════════════════════════
//  🔘 BUTTONS
// ═══════════════════════════════════════════════════════════════════════════════

/** `canEdit`: false for a viewer of a shared list, who gets no Edit button. */
function viewButtons(listId, { canEdit = true } = {}) {
    const lastRow = new ActionRowBuilder();
    if (canEdit) lastRow.addComponents(new ButtonBuilder().setCustomId(`edit_${listId}`).setLabel('Edit List').setEmoji('✏️').setStyle(ButtonStyle.Primary));
    lastRow.addComponents(new ButtonBuilder().setCustomId('back').setLabel('Back').setStyle(ButtonStyle.Secondary));
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`sort_az_${listId}`).setLabel('A→Z').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`sort_za_${listId}`).setLabel('Z→A').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`sort_pri_${listId}`).setLabel('Priority').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`search_${listId}`).setEmoji('🔍').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`refresh_${listId}`).setEmoji('🔄').setStyle(ButtonStyle.Secondary)
        ),
        lastRow
    ];
}

/** `role`: viewer/editor/manager on a shared list (an own list is a manager's). The list settings are a manager's, deleting the list the owner's. */
function editButtons(listId, { role = 'manager', isOwner = true } = {}) {
    const lastRow = new ActionRowBuilder();
    if (role === 'manager') lastRow.addComponents(new ButtonBuilder().setCustomId(`list_meta_${listId}`).setLabel('List Info').setEmoji('📋').setStyle(ButtonStyle.Primary));
    if (isOwner) lastRow.addComponents(new ButtonBuilder().setCustomId(`list_del_${listId}`).setLabel('Delete List').setEmoji('🗑️').setStyle(ButtonStyle.Danger));
    lastRow.addComponents(new ButtonBuilder().setCustomId(`view_${listId}`).setLabel('Done').setStyle(ButtonStyle.Secondary));
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`item_add_${listId}`).setLabel('Add').setEmoji('➕').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`item_edit_${listId}`).setLabel('Edit').setEmoji('✏️').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`item_del_${listId}`).setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`item_done_${listId}`).setLabel('Mark Done').setEmoji('✅').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`item_swap_${listId}`).setLabel('Reorder').setEmoji('🔀').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`item_desc_${listId}`).setLabel('Description').setEmoji('📝').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`item_details_${listId}`).setLabel('Details').setEmoji('🗓️').setStyle(ButtonStyle.Secondary)
        ),
        lastRow
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
        new ButtonBuilder().setCustomId('ach_first_0').setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId(`ach_prev_${Math.max(0, page - 1)}`).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId('ach_x').setLabel(`${page + 1}/${total}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`ach_next_${Math.min(total - 1, page + 1)}`).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= total - 1),
        new ButtonBuilder().setCustomId(`ach_last_${total - 1}`).setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(page >= total - 1)
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  📋 SELECTS
// ═══════════════════════════════════════════════════════════════════════════════

const SELECT_MAX = 25;
/** Prefix of the pseudo option that jumps to another page of a select menu. */
const PAGE_VALUE = '__page_';

/**
 * Slice `rows` for a select menu. A menu holds at most 25 options, so when
 * there are more rows and `paged` is set, the first/last slots become
 * "previous page" / "next page" options (value `__page_<n>`). Without
 * `paged` the menu is capped at 25 and the placeholder says how many were
 * left out.
 */
function selectWindow(rows, { page = 0, paged = false, label = 'item' } = {}) {
    const total = rows.length;
    if (total <= SELECT_MAX) return { slice: rows, offset: 0, prev: null, next: null, note: '' };
    if (!paged) return { slice: rows.slice(0, SELECT_MAX), offset: 0, prev: null, next: null, note: ` (showing ${SELECT_MAX} of ${total})` };
    // A page loses one slot per paging option it needs (first page: next only; last: previous only).
    const pages = [];
    for (let start = 0; start < total; ) {
        const room = SELECT_MAX - (start > 0 ? 1 : 0);
        const size = total - start > room ? room - 1 : room;
        pages.push([start, start + size]);
        start += size;
    }
    const current = Math.min(Math.max(0, page), pages.length - 1);
    const [from, to] = pages[current];
    const of = `Page %n of ${pages.length}`;
    return {
        slice: rows.slice(from, to),
        offset: from,
        prev: current > 0 ? { label: `◀ Previous ${label}s`, value: `${PAGE_VALUE}${current - 1}`, description: of.replace('%n', current) } : null,
        next: current < pages.length - 1 ? { label: `▶ More ${label}s`, value: `${PAGE_VALUE}${current + 1}`, description: of.replace('%n', current + 2) } : null,
        note: ` (${from + 1}-${to} of ${total})`
    };
}

/** The page number a `__page_<n>` select value points at, or null for a normal value. */
const pageFromValue = (val) => (String(val).startsWith(PAGE_VALUE) ? Number(String(val).slice(PAGE_VALUE.length)) || 0 : null);

function listSelect(lists, id = 'sel_list', { page = 0, paged = false } = {}) {
    if (!lists.length) return null;
    const w = selectWindow(lists, { page, paged, label: 'list' });
    const options = w.slice.map((l) => {
        // Build clean description
        const descParts = [];
        if (l.category) descParts.push(l.category);
        if (l.deadline) descParts.push(formatDeadline(l.deadline));
        if (l.shared) descParts.unshift(l.is_owner ? '👥 shared' : `👥 ${l.role}`);

        return {
            label: l.name.substring(0, 100),
            value: String(l.id),
            emoji: PRIORITY_DOT[l.priority] || '📋',
            description: descParts.length > 0 ? descParts.join(' · ').substring(0, 100) : undefined
        };
    });
    if (w.prev) options.unshift(w.prev);
    if (w.next) options.push(w.next);
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(`Select a list${w.note}`.slice(0, 150)).addOptions(options)
    );
}

function itemSelect(items, id, ph = 'Select item...', { page = 0 } = {}) {
    if (!items.length) return null;
    const w = selectWindow(items, { page, paged: true, label: 'task' });
    const options = w.slice.map((it, i) => ({ label: `${w.offset + i + 1}. ${it.name.substring(0, 90)}`, value: String(it.id), emoji: it.completed ? '✅' : '⬜' }));
    if (w.prev) options.unshift(w.prev);
    if (w.next) options.push(w.next);
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(`${ph}${w.note}`.slice(0, 150)).addOptions(options)
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
    const d = new TextInputBuilder().setCustomId('desc').setLabel('Description (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(TEXT_LIMITS.DESCRIPTION);
    const dl = new TextInputBuilder().setCustomId('deadline').setLabel('Deadline YYYY-MM-DD (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMinLength(10).setMaxLength(10).setPlaceholder('2030-12-31');
    if (existing) {
        n.setValue(existing.name);
        if (existing.description) d.setValue(String(existing.description).slice(0, TEXT_LIMITS.DESCRIPTION));
        const deadline = validation.formatDate(existing.deadline);
        if (deadline) dl.setValue(deadline);
    }
    m.addComponents(new ActionRowBuilder().addComponents(n), new ActionRowBuilder().addComponents(d), new ActionRowBuilder().addComponents(dl));
    return m;
}

function itemModal(listId) {
    return new ModalBuilder().setCustomId(`m_additem_${listId}`).setTitle('Add Item').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(TEXT_LIMITS.ITEM_NAME)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel('Description (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(TEXT_LIMITS.DESCRIPTION))
    );
}

function editItemModal(item) {
    return new ModalBuilder().setCustomId(`m_edititem_${item.id}`).setTitle('Edit Item').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(TEXT_LIMITS.ITEM_NAME).setValue(item.name))
    );
}

function descModal(item) {
    const d = new TextInputBuilder().setCustomId('desc').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(TEXT_LIMITS.DESCRIPTION);
    if (item.description) d.setValue(String(item.description).slice(0, TEXT_LIMITS.DESCRIPTION));
    return new ModalBuilder().setCustomId(`m_desc_${item.id}`).setTitle(`Description: ${item.name.substring(0, 30)}`).addComponents(new ActionRowBuilder().addComponents(d));
}

/**
 * Modal for a task's own fields: due date, priority, tags and repeat. Empty clears a field.
 * Four inputs (Discord allows five per modal).
 */
function detailsModal(item) {
    const input = (id, label, placeholder, max, value) => {
        const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(max).setPlaceholder(placeholder);
        if (value) t.setValue(String(value).slice(0, max));
        return new ActionRowBuilder().addComponents(t);
    };
    // Joined without spaces: five tags of 20 characters then need 104 characters, which the input allows.
    const tags = String(item.tags || '').split(',').filter(Boolean).join(',');
    return new ModalBuilder().setCustomId(`m_details_${item.id}`).setTitle(`Details: ${item.name.substring(0, 30)}`).addComponents(
        input('due', 'Due date YYYY-MM-DD (empty clears)', '2030-12-31', 10, validation.formatDate(item.due_date)),
        input('priority', 'Priority: low, med or high (empty clears)', 'med', 6, item.priority && (item.priority === 'MEDIUM' ? 'med' : item.priority.toLowerCase())),
        input('tags', 'Tags, comma separated, max 5', 'home, bills', 120, tags),
        input('repeat', 'Repeat: none, daily, weekly or monthly', 'none', 7, item.recurrence)
    );
}

function searchModal() {
    return new ModalBuilder().setCustomId('m_search').setTitle('Search').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q').setLabel('Search').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100))
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🌳 SKILL TREE UI
// ═══════════════════════════════════════════════════════════════════════════════

/** Split text on blank lines into embed fields of at most 1024 characters (Discord's limit). */
function chunkFieldValue(text, limit = 1024) {
    const fields = [];
    let current = '';
    for (const block of text.split('\n\n').filter(Boolean)) {
        if (current && current.length + block.length + 2 > limit) {
            fields.push({ name: '​', value: current, inline: false });
            current = '';
        }
        current = current ? `${current}\n\n${block}` : block;
    }
    if (current) fields.push({ name: '​', value: current.slice(0, limit), inline: false });
    return fields;
}

function skillTreeEmbed(user, classKey, skillTree, userSkills) {
    const tree = skillTree[classKey];
    if (!tree) return error('Invalid Class', 'Skill tree not found');
    
    const userSkillMap = new Map(userSkills.map(s => [s.skill_id, s.skill_level]));
    
    const embed = new EmbedBuilder()
        .setColor(COLORS[classKey] || COLORS.primary)
        .setTitle(`${classEmoji(classKey)} ${tree.name} Skills`)
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
        
        const effectText = skill.description;
        
        skillList += `${statusIcon} ${skill.emoji} **${skill.name}**${progressDisplay}\n`;
        skillList += `└ ${effectText} • ${skill.cost} XP\n\n`;
    });
    
    embed.addFields(...chunkFieldValue(skillList || '*No skills available*'));
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
            `**Effect (per level):** ${skill.description}`,
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
    const currentClass = user.player_class;
    const currentInfo = classes[currentClass];
    
    const embed = new EmbedBuilder()
        .setColor(COLORS[currentClass] || COLORS.primary)
        .setTitle('⚔️ Class System')
        .setDescription([
            `**Current Class:** ${classEmoji(currentClass)} **${currentClass}**`,
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
function classDetailEmbed(user, classKey, classInfo, skillTree, classIndex, totalClasses, userSkills = []) {
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
        .setColor(COLORS[classKey] || COLORS.primary)
        .setTitle(`${classInfo.emoji} ${classInfo.name}`)
        .setDescription([
            `### ${statusBadge}`,
            ``,
            `*${classInfo.description}*`,
            ``
        ].join('\n'));
    
    // Playstyle and live counter come from the shared data, so new classes need no UI change.
    embed.addFields({
        name: '🎮 Playstyle',
        value: classInfo.playstyle || 'Unique gameplay mechanics.',
        inline: false
    });
    const counter = equipped ? classCounterLine(user, userSkills) : '';
    if (counter) embed.addFields({ name: '📈 Current', value: counter, inline: false });
    
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
            .slice(0, 6)
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

// Browser navigation buttons for video game style class browsing
function classBrowserButtons(user, classKey, classInfo, classIndex, totalClasses) {
    const owned = classKey === 'DEFAULT' || user[`owns_${classKey.toLowerCase()}`];
    const equipped = user.player_class === classKey;
    const canAfford = user.player_xp >= (classInfo.cost || 0);
    
    const rows = [];
    
    // Jump straight to any class (17 classes fit one select menu, the limit is 25).
    rows.push(classSelectMenu(CLASSES, user, classKey));
    
    // Navigation row: Previous / Class Count / Next. Each button names the class it leads to, so the browser keeps no state.
    const classKeys = Object.keys(CLASSES);
    const prevKey = classKeys[Math.max(0, classIndex - 1)] || classKey;
    const nextKey = classKeys[Math.min(classKeys.length - 1, classIndex + 1)] || classKey;
    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`class_prev_${prevKey}`)
            .setLabel('◀')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(classIndex === 0),
        new ButtonBuilder()
            .setCustomId('class_browse_indicator')
            .setLabel(`${classIndex + 1} / ${totalClasses}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`class_next_${nextKey}`)
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
            .setCustomId(`class_skills_${classKey}`)
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

function classSelectMenu(classes, user, browsing = null) {
    const options = [];
    
    Object.entries(classes).slice(0, 25).forEach(([k, c]) => {
        const owned = k === 'DEFAULT' || user[`owns_${k.toLowerCase()}`];
        const eq = user.player_class === k;
        
        options.push({
            label: c.name,
            value: k,
            emoji: c.emoji,
            description: eq ? 'Equipped' : owned ? 'Owned' : `${c.cost} XP to unlock`,
            default: browsing ? k === browsing : eq
        });
    });
    
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('class_select')
            .setPlaceholder('Select a class...')
            .addOptions(options)
    );
}

function skillSelectMenu(skillTree, userSkills, classKey) {
    const userSkillMap = new Map(userSkills.map(s => [s.skill_id, s.skill_level]));
    const options = [];
    
    if (!skillTree || !skillTree.skills || Object.keys(skillTree.skills).length === 0) {
        // Return a placeholder if no skills
        return new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`skill_select_${classKey}`)
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
            description: `${status} ${skill.description}`.slice(0, 100)
        });
    });
    
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`skill_select_${classKey}`)
            .setPlaceholder('Select a skill to view/unlock...')
            .addOptions(options)
    );
}

function skillActionButtons(skillId, skill, userSkillLevel, requirementMet, userXP, classKey) {
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
            .setCustomId(`skill_back_${classKey}`)
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
    );
    
    return row;
}

module.exports = {
    COLORS, classEmoji, classCounterLine, describeChest, chunkFieldValue, PRIORITY_DOT, bar, smoothBar, fancyBar, xpBar,
    // Embeds
    listViewEmbed, listsOverviewEmbed, profileEmbed, achievementsEmbed, achievementUnlockEmbed,
    classShopEmbed, leaderboardEmbed, xpEmbed, pingEmbed, helpEmbed,
    // Skill Tree
    skillTreeEmbed, skillInfoEmbed, classOverviewEmbed, classDetailEmbed,
    // Feedback
    success, error, info, warn,
    // Buttons
    viewButtons, editButtons, overviewButtons, confirmButtons, classButtons, achButtons,
    classBrowserButtons, skillActionButtons,
    // Selects
    listSelect, itemSelect, pageFromValue, SELECT_MAX, catSelect, priSelect, classSelectMenu, skillSelectMenu, categoryFilterSelect,
    // Modals
    listModal, itemModal, editItemModal, descModal, detailsModal, searchModal,
    // Task details
    orderItems, itemMeta, itemLines, prestigeTitle, bonusLines
};
