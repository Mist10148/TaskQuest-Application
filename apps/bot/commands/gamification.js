/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🎮 GAMIFICATION COMMANDS (v3.5 - Skill Trees & Major UI Overhaul)
 *
 *  /ping - Stateless latency check (no DB access)
 *  /daily - Daily XP reward (100 XP + streak bonus, 24h cooldown)
 *  /automation - Toggle deadline reminders (user preference only)
 *  /profile - View your stats (improved UI)
 *  /achievements - View achievements
 *  /class - Class shop with skill trees
 *  /leaderboard - Top players (fetches actual Discord users)
 *  /toggle - Toggle XP system
 *  /help - Commands list
 *
 *  ⚠️ XP & Achievements = EPHEMERAL ONLY (never public)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { users, progression } = require('@taskquest/shared/db');
const { CLASSES, SKILL_TREES, ACHIEVEMENTS, levelProgress } = require('@taskquest/shared');
const ui = require('../utils/ui');
const { EPHEMERAL, handleError, sendRewards } = require('../utils/respond');

const pageState = new Map();

// ═══════════════════════════════════════════════════════════════════════════════
//  🏓 /ping - STATELESS (No DB access, no side effects)
// ═══════════════════════════════════════════════════════════════════════════════

const pingData = new SlashCommandBuilder()
    .setName('ping')
    .setDescription('🏓 Check bot latency');

async function ping(interaction) {
    const start = Date.now();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const botLatency = Date.now() - start;
    const apiLatency = Math.round(interaction.client.ws.ping);
    await interaction.editReply({ embeds: [ui.pingEmbed(botLatency, apiLatency)] });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🎁 /daily - Daily XP reward (100 XP, TRUE 24-hour cooldown)
// ═══════════════════════════════════════════════════════════════════════════════

const dailyData = new SlashCommandBuilder()
    .setName('daily')
    .setDescription('🎁 Claim your daily 100 XP reward');

function formatTimeRemaining(ms) {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((ms % (1000 * 60)) / 1000);
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
}

async function daily(interaction) {
    await interaction.deferReply(EPHEMERAL);
    let r;
    try {
        r = await progression.claimDaily(interaction.user.id);
    } catch (err) {
        return handleError(interaction, err);
    }

    if (!r.claimed) {
        return interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(0xFEE75C)
                .setTitle('⏰ Already Claimed!')
                .setDescription("You've already claimed your daily XP.")
                .addFields(
                    { name: '⏱️ Time Remaining', value: formatTimeRemaining(r.remainingMs), inline: true },
                    { name: '🔥 Current Streak', value: `${r.streak} days`, inline: true }
                )
                .setFooter({ text: 'Come back when the timer resets!' })
            ]
        });
    }

    let description = `You received **+${r.baseXP} XP**`;
    if (r.classBonus > 0) description += ` + **+${r.classBonus} XP** class/skill bonus`;
    if (r.classBonus < 0) description += ` (**${r.classBonus} XP** bad luck)`;
    if (r.streakBonus > 0) description += ` + **+${r.streakBonus} XP** streak bonus`;
    if (r.skillDailyBonus > 0) description += ` + **+${r.skillDailyBonus} XP** Early Bird`;
    description += `!\n**Total: ${r.totalXP} XP**`;
    if (r.bonusInfo?.details) description += `\n-# ${r.bonusInfo.details}`;

    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🎁 Daily Reward Claimed!')
        .setDescription(description)
        .addFields(
            { name: '💰 Balance', value: `${Number(r.balance).toLocaleString()} XP`, inline: true },
            { name: '📊 Level', value: `${r.level}`, inline: true },
            { name: '🔥 Streak', value: `${r.streak} day${r.streak > 1 ? 's' : ''}`, inline: true }
        )
        .setFooter({ text: 'Come back in 24 hours to keep your streak!' });

    if (r.leveledUp) embed.addFields({ name: '🎉 Level Up!', value: `You reached **Level ${r.level}**!`, inline: false });
    if (r.streakBroken) embed.addFields({ name: '💔 Streak Lost', value: `Your ${r.previousStreak}-day streak was reset. Start again!`, inline: false });
    if (r.streakPreserved) embed.addFields({ name: '🚀 Unstoppable', value: 'You missed a day, but your streak was kept!', inline: false });
    if (r.streak === 7) embed.addFields({ name: '🎊 Week Streak!', value: 'Amazing! 7 days in a row!', inline: false });
    else if (r.streak === 30) embed.addFields({ name: '🏆 Month Streak!', value: 'Incredible! 30 days in a row!', inline: false });

    await interaction.editReply({ embeds: [embed] });
    await sendRewards(interaction, { achievements: r.achievements });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🔔 /automation - Toggle deadline reminders
// ═══════════════════════════════════════════════════════════════════════════════

const automationData = new SlashCommandBuilder()
    .setName('automation')
    .setDescription('🔔 Toggle deadline reminder notifications');

async function automation(interaction) {
    const newStatus = await users.toggleSetting(interaction.user.id, 'automation_enabled');

    await interaction.reply({
        embeds: [newStatus
            ? ui.success('Reminders Enabled', '🔔 I\'ll DM you when a list is due today.')
            : ui.info('Reminders Disabled', '🔕 You won\'t receive deadline reminders.')
        ],
        flags: MessageFlags.Ephemeral
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  👤 /profile - MAJOR REDESIGN (Dank Memer Style - Matching Reference)
// ═══════════════════════════════════════════════════════════════════════════════

const profileData = new SlashCommandBuilder()
    .setName('profile')
    .setDescription('👤 View your profile and stats')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('View another user\'s profile')
            .setRequired(false)
    );

// ═══════════════════════════════════════════════════════════════════════════════
//  📊 UNIFIED PROGRESS BAR SYSTEM
//  Single source of truth for all progress visualization
// ═══════════════════════════════════════════════════════════════════════════════

function progressBar(current, max, length = 20) {
    if (max === 0) return { bar: '▱'.repeat(length), percent: 0 };

    const percent = Math.min(100, Math.round((current / max) * 100));
    const filled = Math.round((percent / 100) * length);

    const filledPart = '▰'.repeat(Math.max(0, Math.min(filled, length)));
    const emptyPart = '▱'.repeat(Math.max(0, length - filled));

    return {
        bar: filledPart + emptyPart,
        percent: percent
    };
}

function bar(current, max, length = 20) {
    return progressBar(current, max, length).bar;
}

// Class info
const CLASS_COLORS = { DEFAULT: 0x95A5A6, HERO: 0xFFD700, GAMBLER: 0x9B59B6, ASSASSIN: 0x2C3E50, WIZARD: 0x3498DB, ARCHER: 0x27AE60, TANK: 0xE74C3C };
const CLASS_INFO = Object.fromEntries(
    Object.entries(CLASSES).map(([key, c]) => [key, { emoji: c.emoji, color: CLASS_COLORS[key], name: c.name, desc: c.description, playstyle: c.playstyle }])
);

// ═══════════════════════════════════════════════════════════════════════════════
//  👤 /profile - PLAYER DASHBOARD
//  Clean, informative, game-like interface
// ═══════════════════════════════════════════════════════════════════════════════

async function profile(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const userId = targetUser.id;

    // Viewing someone else never creates a record for them.
    if (userId === interaction.user.id) await users.ensureUser(userId);
    const stats = await users.getUserStats(userId);
    if (!stats) {
        return interaction.reply({ embeds: [ui.info('No profile yet', `${targetUser.username} hasn't used TaskQuest yet.`)], ...EPHEMERAL });
    }
    const user = stats.user;
    const userSkills = await users.getUserSkills(userId);

    // Get Discord member info
    let member = null;
    try { member = await interaction.guild?.members.fetch(userId); } catch (e) {}
    const discordUser = member?.user || targetUser;

    // Calculate progress values
    const xpInLevel = levelProgress(user.lifetime_xp).current;
    const xpProgress = progressBar(xpInLevel, 100, 16);

    // Extract stats safely
    const totalItems = parseInt(stats.items?.total) || 0;
    const completedItems = parseInt(stats.items?.completed) || 0;
    const totalLists = parseInt(stats.lists?.total) || 0;
    const achievementCount = stats.achievements || 0;

    // Game stats
    const gameStats = stats.games || { played: 0, won: 0, lost: 0, draws: 0 };
    // Win rate = wins / (wins + losses) - excluding draws for fair calculation
    const decisiveGames = gameStats.won + gameStats.lost;
    const winRate = decisiveGames > 0 ? Math.round((gameStats.won / decisiveGames) * 100) : 0;

    // Class info
    const classInfo = CLASS_INFO[user.player_class] || CLASS_INFO.DEFAULT;
    const skillCount = userSkills?.length || 0;

    // ═══════════════════════════════════════════════════════════════════════════
    //  PRODUCTIVITY METRICS
    // ═══════════════════════════════════════════════════════════════════════════

    // Focus Rate: % of tasks completed vs created
    const focusRate = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
    const focusBar = progressBar(completedItems, totalItems, 10);

    // Active tasks (uncompleted)
    const activeTasks = totalItems - completedItems;

    // ═══════════════════════════════════════════════════════════════════════════
    //  BUILD PLAYER DASHBOARD
    // ═══════════════════════════════════════════════════════════════════════════

    const embed = new EmbedBuilder()
        .setColor(classInfo.color)
        .setAuthor({
            name: `${discordUser.displayName || discordUser.username}`,
            iconURL: discordUser.displayAvatarURL({ extension: 'png', size: 64 })
        })
        .setThumbnail(discordUser.displayAvatarURL({ extension: 'png', size: 256 }));

    // ─────────────────────────────────────────────────────────────────
    //  HEADER: Level & Class
    // ─────────────────────────────────────────────────────────────────
    embed.setDescription([
        `### ${classInfo.emoji} ${classInfo.name} · Level ${user.player_level}`,
        `-# ${classInfo.desc}`,
        ``
    ].join('\n'));

    // ─────────────────────────────────────────────────────────────────
    //  XP PROGRESS
    // ─────────────────────────────────────────────────────────────────
    embed.addFields({
        name: '⚡ Experience',
        value: [
            `**Balance:** ${Number(user.player_xp).toLocaleString()} XP · **Lifetime:** ${Number(user.lifetime_xp).toLocaleString()} XP`,
            `\`${xpProgress.bar}\` ${xpProgress.percent}%`,
            `-# ${100 - xpInLevel} XP to Level ${Number(user.player_level) + 1}`
        ].join('\n'),
        inline: false
    });

    // ─────────────────────────────────────────────────────────────────
    //  PRODUCTIVITY STATS (Focus Rate)
    // ─────────────────────────────────────────────────────────────────
    embed.addFields({
        name: '🎯 Focus Rate',
        value: [
            `\`${focusBar.bar}\` **${focusRate}%**`,
            `-# ${completedItems} of ${totalItems} tasks completed`
        ].join('\n'),
        inline: false
    });

    // ─────────────────────────────────────────────────────────────────
    //  STATS ROW 1: Tasks
    // ─────────────────────────────────────────────────────────────────
    embed.addFields(
        {
            name: '📋 Tasks',
            value: `${completedItems}/${totalItems} done\n-# ${totalLists} lists`,
            inline: true
        },
        {
            name: '🔥 Streak',
            value: user.streak_count > 0
                ? `${user.streak_count} days`
                : `No streak`,
            inline: true
        },
        {
            name: '🌟 Skills',
            value: `${skillCount} unlocked`,
            inline: true
        }
    );

    // ─────────────────────────────────────────────────────────────────
    //  STATS ROW 2: Games & Achievements
    // ─────────────────────────────────────────────────────────────────
    embed.addFields(
        {
            name: '🎮 Games',
            value: gameStats.played > 0
                ? `${gameStats.played} played\n-# ${gameStats.won}W/${gameStats.lost}L`
                : `—`,
            inline: true
        },
        {
            name: '🏅 Wins',
            value: decisiveGames > 0
                ? `${winRate}%`
                : `—`,
            inline: true
        },
        {
            name: '🏆 Badges',
            value: achievementCount > 0
                ? `${achievementCount} earned`
                : `—`,
            inline: true
        }
    );

    // ─────────────────────────────────────────────────────────────────
    //  FOOTER
    // ─────────────────────────────────────────────────────────────────
    const statusText = user.gamification_enabled ? '✅ XP Active' : '💤 XP Disabled';
    embed.setFooter({ text: `${statusText} · /class to change class · /achievements for badges` });

    // XP details are personal, so profiles are always ephemeral.
    await interaction.reply({ embeds: [embed], ...EPHEMERAL });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🏆 /achievements - Ephemeral (user-only)
// ═══════════════════════════════════════════════════════════════════════════════

const achievementsData = new SlashCommandBuilder()
    .setName('achievements')
    .setDescription('🏆 View your achievements');

async function achievements(interaction) {
    const userId = interaction.user.id;
    const userAchs = await users.getAchievements(userId);
    const page = 0;
    const total = Math.ceil(Object.keys(ACHIEVEMENTS).length / 8) || 1;
    pageState.set(userId, page);

    await interaction.reply({
        embeds: [ui.achievementsEmbed(userAchs, ACHIEVEMENTS, page)],
        components: [ui.achButtons(page, total)],
        flags: MessageFlags.Ephemeral
    });
}

async function handleAchievementPagination(interaction) {
    const userId = interaction.user.id;
    const action = interaction.customId;
    let page = pageState.get(userId) || 0;
    const total = Math.ceil(Object.keys(ACHIEVEMENTS).length / 8) || 1;

    if (action === 'ach_first') page = 0;
    else if (action === 'ach_prev') page = Math.max(0, page - 1);
    else if (action === 'ach_next') page = Math.min(total - 1, page + 1);
    else if (action === 'ach_last') page = total - 1;

    pageState.set(userId, page);
    const userAchs = await users.getAchievements(userId);
    await interaction.update({
        embeds: [ui.achievementsEmbed(userAchs, ACHIEVEMENTS, page)],
        components: [ui.achButtons(page, total)]
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ⚔️ /class - VIDEO GAME CHARACTER BROWSER
// ═══════════════════════════════════════════════════════════════════════════════

const classData = new SlashCommandBuilder()
    .setName('class')
    .setDescription('⚔️ Browse and select classes');

// Store selected class per user for navigation
const classViewState = new Map();

// List of all classes for browsing
const CLASS_ORDER = ['DEFAULT', 'HERO', 'GAMBLER', 'ASSASSIN', 'WIZARD', 'ARCHER', 'TANK'];

async function classShop(interaction) {
    const userId = interaction.user.id;
    const user = await users.ensureUser(userId);

    // Start in browse mode with current class selected
    const currentIndex = CLASS_ORDER.indexOf(user.player_class);
    classViewState.set(userId, {
        view: 'browse',
        selectedClass: user.player_class,
        browseIndex: currentIndex >= 0 ? currentIndex : 0
    });

    const classKey = user.player_class;
    const classInfo = CLASSES[classKey];
    const skillTree = SKILL_TREES[classKey];

    await interaction.reply({
        embeds: [ui.classDetailEmbed(user, classKey, classInfo, skillTree, currentIndex >= 0 ? currentIndex : 0, CLASS_ORDER.length)],
        components: ui.classBrowserButtons(user, classKey, classInfo, currentIndex >= 0 ? currentIndex : 0, CLASS_ORDER.length),
        flags: MessageFlags.Ephemeral
    });
}

async function handleClassButton(interaction) {
    try {
        return await routeClassButton(interaction);
    } catch (err) {
        return handleError(interaction, err);
    }
}

async function routeClassButton(interaction) {
    const userId = interaction.user.id;
    const id = interaction.customId;

    // ═══════════════════════════════════════════════════════════════════════════
    //  CLASS BROWSER NAVIGATION
    // ═══════════════════════════════════════════════════════════════════════════

    if (id === 'class_prev' || id === 'class_next') {
        const user = await users.getUser(userId);
        const state = classViewState.get(userId) || { browseIndex: 0 };

        let newIndex = state.browseIndex || 0;
        if (id === 'class_prev' && newIndex > 0) newIndex--;
        if (id === 'class_next' && newIndex < CLASS_ORDER.length - 1) newIndex++;

        state.browseIndex = newIndex;
        state.selectedClass = CLASS_ORDER[newIndex];
        state.view = 'browse';
        classViewState.set(userId, state);

        const classKey = CLASS_ORDER[newIndex];
        const classInfo = CLASSES[classKey];
        const skillTree = SKILL_TREES[classKey];

        return interaction.update({
            embeds: [ui.classDetailEmbed(user, classKey, classInfo, skillTree, newIndex, CLASS_ORDER.length)],
            components: ui.classBrowserButtons(user, classKey, classInfo, newIndex, CLASS_ORDER.length)
        });
    }

    if (id === 'class_browse') {
        const user = await users.getUser(userId);
        const state = classViewState.get(userId) || { browseIndex: 0 };
        const index = state.browseIndex || 0;

        const classKey = CLASS_ORDER[index];
        const classInfo = CLASSES[classKey];
        const skillTree = SKILL_TREES[classKey];

        state.view = 'browse';
        classViewState.set(userId, state);

        return interaction.update({
            embeds: [ui.classDetailEmbed(user, classKey, classInfo, skillTree, index, CLASS_ORDER.length)],
            components: ui.classBrowserButtons(user, classKey, classInfo, index, CLASS_ORDER.length)
        });
    }

    // Return to default class
    if (id === 'class_return_default') {
        const user = await users.getUser(userId);

        if (user.player_class === 'DEFAULT') {
            return interaction.reply({
                embeds: [ui.info('Already Default', 'You\'re already using the Default class.')],
                flags: MessageFlags.Ephemeral
            });
        }

        const { user: updatedUser } = await progression.equipClass(userId, 'DEFAULT');

        // Update to show Default class
        const state = classViewState.get(userId) || {};
        state.browseIndex = 0;
        state.selectedClass = 'DEFAULT';
        classViewState.set(userId, state);

        const classInfo = CLASSES['DEFAULT'];
        const skillTree = SKILL_TREES['DEFAULT'];

        await interaction.update({
            embeds: [ui.classDetailEmbed(updatedUser, 'DEFAULT', classInfo, skillTree, 0, CLASS_ORDER.length)],
            components: ui.classBrowserButtons(updatedUser, 'DEFAULT', classInfo, 0, CLASS_ORDER.length)
        });

        return interaction.followUp({
            embeds: [ui.success('Class Changed', '⚪ You are now using the **Default** class.')],
            flags: MessageFlags.Ephemeral
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  SKILL TREE VIEW (from browser)
    // ═══════════════════════════════════════════════════════════════════════════

    if (id === 'class_skills') {
        const user = await users.getUser(userId);
        const userSkills = await users.getUserSkills(userId);
        const state = classViewState.get(userId) || { browseIndex: 0, selectedClass: user.player_class };
        state.view = 'skills';
        classViewState.set(userId, state);

        const selectedClass = state.selectedClass || CLASS_ORDER[state.browseIndex] || user.player_class;

        const tree = SKILL_TREES[selectedClass];
        if (!tree) {
            return interaction.update({
                embeds: [ui.error('No Skill Tree', `No skill tree found for ${selectedClass} class.`)],
                components: ui.classBrowserButtons(user, selectedClass, CLASSES[selectedClass], state.browseIndex || 0, CLASS_ORDER.length)
            });
        }

        // Create back button that returns to browser
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('class_browse')
                .setLabel('Back to Classes')
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Secondary)
        );

        return interaction.update({
            embeds: [ui.skillTreeEmbed(user, selectedClass, SKILL_TREES, userSkills)],
            components: [
                ui.skillSelectMenu(SKILL_TREES[selectedClass], userSkills),
                backRow
            ]
        });
    }

    if (id === 'skill_back') {
        const user = await users.getUser(userId);
        const userSkills = await users.getUserSkills(userId);
        const state = classViewState.get(userId) || { browseIndex: 0, selectedClass: user.player_class };
        const selectedClass = state.selectedClass || CLASS_ORDER[state.browseIndex] || user.player_class;

        // Create back button that returns to browser
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('class_browse')
                .setLabel('Back to Classes')
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Secondary)
        );

        return interaction.update({
            embeds: [ui.skillTreeEmbed(user, selectedClass, SKILL_TREES, userSkills)],
            components: [
                ui.skillSelectMenu(SKILL_TREES[selectedClass], userSkills),
                backRow
            ]
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  SKILL UNLOCK/UPGRADE
    // ═══════════════════════════════════════════════════════════════════════════

    if (id.startsWith('skill_unlock_')) {
        const skillId = id.replace('skill_unlock_', '');
        // Ownership, prerequisites, max level and cost are enforced atomically.
        const result = await progression.unlockSkill(userId, skillId);
        const selectedClass = result.treeKey;
        const updatedUser = await users.getUser(userId);
        const updatedSkills = await users.getUserSkills(userId);

        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('class_browse').setLabel('Back to Classes').setEmoji('◀️').setStyle(ButtonStyle.Secondary)
        );
        await interaction.update({
            embeds: [ui.skillTreeEmbed(updatedUser, selectedClass, SKILL_TREES, updatedSkills)],
            components: [ui.skillSelectMenu(SKILL_TREES[selectedClass], updatedSkills), backRow]
        });

        const { skill } = result;
        await interaction.followUp({
            embeds: [ui.success(`${skill.emoji} ${skill.name} ${result.level === 1 ? 'Unlocked' : 'Upgraded'}!`, `Now at level ${result.level}/${skill.maxLevel}\n${skill.description}`)],
            ...EPHEMERAL
        });
        return;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  CLASS BUY/EQUIP
    // ═══════════════════════════════════════════════════════════════════════════

    if (id.startsWith('cbuy_')) {
        const classKey = id.replace('cbuy_', '');
        const { user, achievements: newAchs } = await progression.buyClass(userId, classKey);
        const cls = CLASSES[classKey];
        const classIndex = Math.max(0, CLASS_ORDER.indexOf(classKey));
        classViewState.set(userId, { browseIndex: classIndex, selectedClass: classKey });

        await interaction.update({
            embeds: [ui.classDetailEmbed(user, classKey, cls, SKILL_TREES[classKey], classIndex, CLASS_ORDER.length)],
            components: ui.classBrowserButtons(user, classKey, cls, classIndex, CLASS_ORDER.length)
        });
        await interaction.followUp({ embeds: [ui.success('Purchased!', `Now a ${cls.emoji} **${cls.name}**!`)], ...EPHEMERAL });
        await sendRewards(interaction, { achievements: newAchs });
        return;
    }

    if (id.startsWith('ceq_')) {
        const classKey = id.replace('ceq_', '');
        const before = await users.getUser(userId);
        if (before && before.player_class === classKey) {
            return interaction.reply({ embeds: [ui.info('Already equipped', `You are already using ${CLASSES[classKey]?.name || classKey}.`)], ...EPHEMERAL });
        }
        const { user } = await progression.equipClass(userId, classKey);
        const cls = CLASSES[classKey];
        const classIndex = Math.max(0, CLASS_ORDER.indexOf(classKey));
        classViewState.set(userId, { browseIndex: classIndex, selectedClass: classKey });

        await interaction.update({
            embeds: [ui.classDetailEmbed(user, classKey, cls, SKILL_TREES[classKey], classIndex, CLASS_ORDER.length)],
            components: ui.classBrowserButtons(user, classKey, cls, classIndex, CLASS_ORDER.length)
        });
        await interaction.followUp({ embeds: [ui.success('Equipped!', `Now a ${cls.emoji} **${cls.name}**!`)], ...EPHEMERAL });
    }
}

// Handle class select menu (legacy - now redirects to browser)
async function handleClassSelect(interaction) {
    const userId = interaction.user.id;
    const selectedClass = interaction.values[0];

    const user = await users.getUser(userId);
    const classIndex = CLASS_ORDER.indexOf(selectedClass);

    classViewState.set(userId, { browseIndex: classIndex >= 0 ? classIndex : 0, selectedClass: selectedClass });

    const classInfo = CLASSES[selectedClass];
    const skillTree = SKILL_TREES[selectedClass];

    await interaction.update({
        embeds: [ui.classDetailEmbed(user, selectedClass, classInfo, skillTree, classIndex >= 0 ? classIndex : 0, CLASS_ORDER.length)],
        components: ui.classBrowserButtons(user, selectedClass, classInfo, classIndex >= 0 ? classIndex : 0, CLASS_ORDER.length)
    });
}

// Handle skill select menu
async function handleSkillSelect(interaction) {
    const userId = interaction.user.id;
    const skillId = interaction.values[0];

    const user = await users.getUser(userId);
    const userSkills = await users.getUserSkills(userId);
    const state = classViewState.get(userId) || { view: 'skills', selectedClass: user.player_class };
    const selectedClass = state.selectedClass || user.player_class;

    const tree = SKILL_TREES[selectedClass];
    if (!tree || !tree.skills[skillId]) {
        // Use update instead of reply to maintain message
        return interaction.update({
            embeds: [ui.error('Invalid Skill', 'This skill is no longer available.')],
            components: []
        });
    }

    const skill = tree.skills[skillId];
    const userSkillMap = new Map(userSkills.map(s => [s.skill_id, s.skill_level]));
    const currentLevel = userSkillMap.get(skillId) || 0;
    const reqMet = !skill.requires || userSkillMap.has(skill.requires);

    await interaction.update({
        embeds: [ui.skillInfoEmbed(skill, skillId, currentLevel, reqMet)],
        components: [ui.skillActionButtons(skillId, skill, currentLevel, reqMet, user.player_xp)]
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  📊 /leaderboard - Single Organized Embed
// ═══════════════════════════════════════════════════════════════════════════════

const leaderboardData = new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('📊 View top players');

async function leaderboard(interaction) {
    await interaction.deferReply();
    const rows = await users.getLeaderboard(10);

    if (!rows.length) {
        return interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0x2C2F33).setTitle('🏆 Leaderboard').setDescription('*No players yet! Be the first to earn XP!*')]
        });
    }

    // Names come from Discord's cache or the stored profile; only unknown
    // users hit the Discord API (no per-row database queries).
    const entries = await Promise.all(
        rows.map(async (u) => {
            let name = u.discord_username;
            let avatarURL = null;
            const cached = interaction.client.users.cache.get(u.discord_id);
            if (cached) {
                name = cached.displayName || cached.username;
                avatarURL = cached.displayAvatarURL({ extension: 'png', size: 64 });
            } else if (!name) {
                const fetched = await interaction.client.users.fetch(u.discord_id).catch(() => null);
                name = fetched ? fetched.displayName || fetched.username : null;
                avatarURL = fetched ? fetched.displayAvatarURL({ extension: 'png', size: 64 }) : null;
            }
            return { ...u, name: name || 'Adventurer', avatarURL };
        })
    );

    const embed = new EmbedBuilder().setColor(0xFFD700).setTitle('🏆 Leaderboard').setDescription('Top players by XP');
    if (entries[0]?.avatarURL) embed.setThumbnail(entries[0].avatarURL);

    const medals = ['🥇', '🥈', '🥉'];
    const boardText = entries
        .map((e, i) => {
            const stats = [`${Number(e.player_xp).toLocaleString()} XP`, `Lv.${e.player_level}`];
            if (e.games_played > 0) stats.push(`${e.games_played} games`);
            if (e.streak_count > 0) stats.push(`🔥${e.streak_count}`);
            return `${i < 3 ? medals[i] : `\`${e.rank}.\``} **${e.name}** ${CLASS_INFO[e.player_class]?.emoji || '⚪'}\n-# ${stats.join(' · ')}`;
        })
        .join('\n\n');

    embed.addFields({ name: '​', value: boardText.slice(0, 1024), inline: false });
    embed.setFooter({ text: `${entries.length} players · /profile for your stats` });
    await interaction.editReply({ embeds: [embed] });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ⚙️ /toggle
// ═══════════════════════════════════════════════════════════════════════════════

const toggleData = new SlashCommandBuilder()
    .setName('toggle')
    .setDescription('⚙️ Toggle XP system on/off');

async function toggle(interaction) {
    const newStatus = await users.toggleSetting(interaction.user.id, 'gamification_enabled');

    await interaction.reply({
        embeds: [newStatus ? ui.success('XP Enabled', '⚡ You will earn XP!') : ui.info('XP Disabled', '💤 XP off')],
        flags: MessageFlags.Ephemeral
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ❓ /help
// ═══════════════════════════════════════════════════════════════════════════════

const helpData = new SlashCommandBuilder()
    .setName('help')
    .setDescription('❓ View all commands');

async function help(interaction) {
    await interaction.reply({ embeds: [ui.helpEmbed()] });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🌐 /app - Web App Integration
// ═══════════════════════════════════════════════════════════════════════════════

const appData = new SlashCommandBuilder()
    .setName('app')
    .setDescription('🌐 Open the TaskQuest web app');

async function app(interaction) {
    const userId = interaction.user.id;

    // Web app URL - configured in .env or defaults
    const webAppUrl = process.env.WEB_APP_URL || 'https://taskquest.app';

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('TaskQuest Web App')
        .setDescription([
            'Access the full TaskQuest experience in your browser.',
            '',
            '**Features:**',
            '• Full profile dashboard',
            '• Visual skill trees',
            '• Advanced analytics',
            '• Task management',
            '',
            '-# Sign in with Discord to sync your data'
        ].join('\n'))
        .setFooter({ text: 'Same account, same data — real-time sync' });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Open Web App')
            .setStyle(ButtonStyle.Link)
            .setURL(webAppUrl)
            .setEmoji('🌐')
    );

    await interaction.reply({
        embeds: [embed],
        components: [row],
        flags: MessageFlags.Ephemeral
    });
}

module.exports = {
    // Command data
    pingData, dailyData, automationData, profileData, achievementsData,
    classData, leaderboardData, toggleData, helpData, appData,
    // Command handlers
    ping, daily, automation, profile, achievements, classShop, leaderboard, toggle, help, app,
    // Button handlers
    handleClassButton, handleAchievementPagination,
    // Select menu handlers
    handleClassSelect, handleSkillSelect
};
