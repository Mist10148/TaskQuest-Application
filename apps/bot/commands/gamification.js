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
const { CLASSES, SKILL_TREES, ACHIEVEMENTS, LIMITS, STREAK_FREEZE, STREAK_FREEZE_CACHE, levelProgress, describeEquipped, escapeDiscord } = require('@taskquest/shared');
const ui = require('../utils/ui');
const { EPHEMERAL, handleError, sendRewards } = require('../utils/respond');

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

const freezeData = new SlashCommandBuilder()
    .setName('freeze')
    .setDescription(`🧊 Buy a streak freeze (${STREAK_FREEZE.COST} XP, ${STREAK_FREEZE_CACHE.COST} with Freeze Cache) to save your streak`);

async function freeze(interaction) {
    await interaction.deferReply(EPHEMERAL);
    try {
        const r = await progression.buyStreakFreeze(interaction.user.id);
        await interaction.editReply({
            embeds: [ui.success('Streak freeze bought', `You now hold **${r.freezes}/${r.max}** (each costs ${r.cost} XP). It is used automatically if you miss a day. Balance: ${Number(r.balance).toLocaleString()} XP.`)]
        });
        await sendRewards(interaction, { achievements: r.achievements });
    } catch (err) {
        await handleError(interaction, err);
    }
}

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
    if (r.surpriseBonus > 0) description += `\n🎉 **Daily Surprise: +${r.surpriseBonus} XP**`;
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

    const chestText = ui.describeChest(r.chest);
    if (chestText) embed.addFields({ name: '🎁 Milestone Chest', value: chestText, inline: false });
    if (r.leveledUp) embed.addFields({ name: '🎉 Level Up!', value: `You reached **Level ${r.level}**!`, inline: false });
    if (r.streakBroken) embed.addFields({ name: '💔 Streak Lost', value: `Your ${r.previousStreak}-day streak was reset. Start again!`, inline: false });
    if (r.freezeUsed) embed.addFields({ name: '🧊 Streak Freeze Used', value: 'You missed a day, but a streak freeze saved your streak!', inline: false });
    else if (r.streakPreserved) embed.addFields({ name: '🚀 Unstoppable', value: 'You missed a day, but your streak was kept!', inline: false });
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

// Class info
const CLASS_INFO = Object.fromEntries(
    Object.entries(CLASSES).map(([key, c]) => [key, { emoji: c.emoji, color: ui.COLORS[key], name: c.name, desc: c.description, playstyle: c.playstyle }])
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
        return interaction.reply({ embeds: [ui.info('No profile yet', `${escapeDiscord(targetUser.username, { max: 60 })} hasn't used TaskQuest yet.`)], ...EPHEMERAL });
    }
    const user = stats.user;
    const userSkills = await users.getUserSkills(userId);

    // Get Discord member info
    let member = null;
    try { member = await interaction.guild?.members.fetch(userId); } catch (e) { /* not in this server: fall back to the stored name */ }
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
    const counterLine = ui.classCounterLine(user, userSkills);

    // ═══════════════════════════════════════════════════════════════════════════
    //  PRODUCTIVITY METRICS
    // ═══════════════════════════════════════════════════════════════════════════

    // Focus Rate: % of tasks completed vs created
    const focusRate = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
    const focusBar = progressBar(completedItems, totalItems, 10);

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
        `### ${classInfo.emoji} ${classInfo.name} · Level ${user.player_level}${ui.prestigeTitle(user) ? ` · ${ui.prestigeTitle(user)} ✦${user.prestige}` : ''}`,
        ...(describeEquipped(user).title ? [`*${describeEquipped(user).title}*`] : []),
        `-# ${classInfo.desc}`,
        ...(counterLine ? [counterLine] : []),
        ``
    ].join('\n'));

    // ─────────────────────────────────────────────────────────────────
    //  XP PROGRESS
    // ─────────────────────────────────────────────────────────────────
    embed.addFields({
        name: '⚡ Experience',
        value: [
            `**Balance:** ${Number(user.player_xp).toLocaleString()} XP · **Lifetime:** ${Math.max(Number(user.lifetime_xp_total) || 0, Number(user.lifetime_xp) || 0).toLocaleString()} XP`,
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

    await interaction.reply({
        embeds: [ui.achievementsEmbed(userAchs, ACHIEVEMENTS, page)],
        components: [ui.achButtons(page, total)],
        flags: MessageFlags.Ephemeral
    });
}

// The target page is part of each button's custom ID (ach_next_2), so paging needs no memory on the bot and
// survives a restart.
async function handleAchievementPagination(interaction) {
    const userId = interaction.user.id;
    const total = Math.ceil(Object.keys(ACHIEVEMENTS).length / 8) || 1;
    const m = /^ach_(?:first|prev|next|last)_(\d+)$/.exec(interaction.customId);
    if (!m) return interaction.deferUpdate();
    const page = Math.min(Number(m[1]), total - 1);

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

// The browser keeps no state on the bot: every button carries the class it shows or leads to in its custom ID
// (class_next_HERO, class_skills_TANK), so it works after a restart and for several open windows at once.

// List of all classes for browsing
const CLASS_ORDER = Object.keys(CLASSES);

/** The class key at the end of a custom ID such as `class_next_HERO`, or null when it is not a class. */
function classKeyFrom(id) {
    const key = id.slice(id.lastIndexOf('_') + 1);
    return Object.prototype.hasOwnProperty.call(CLASSES, key) ? key : null;
}

/** Embed and components of the class browser for one class (loads the user's skills for the counters). */
async function classView(userId, user, classKey) {
    const classInfo = CLASSES[classKey];
    const index = Math.max(0, CLASS_ORDER.indexOf(classKey));
    const userSkills = await users.getUserSkills(userId);
    return {
        embeds: [ui.classDetailEmbed(user, classKey, classInfo, SKILL_TREES[classKey], index, CLASS_ORDER.length, userSkills)],
        components: ui.classBrowserButtons(user, classKey, classInfo, index, CLASS_ORDER.length)
    };
}

/** Embed and components of one class's skill tree, with a way back to the class browser. */
function skillTreeView(user, userSkills, classKey) {
    const hasSkills = userSkills.some((s) => SKILL_TREES[classKey]?.skills[s.skill_id]);
    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`class_browse_${classKey}`).setLabel('Back to Classes').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`skill_respec_${classKey}`).setLabel('Reset Tree').setEmoji('🔄').setStyle(ButtonStyle.Secondary).setDisabled(!hasSkills)
    );
    return {
        embeds: [ui.skillTreeEmbed(user, classKey, SKILL_TREES, userSkills)],
        components: [ui.skillSelectMenu(SKILL_TREES[classKey], userSkills, classKey), backRow]
    };
}

/** What resetting a tree would refund, by the same rule as progression.respecSkills (levels × cost, RESPEC_REFUND_PERCENT back). */
function respecPreview(userSkills, classKey) {
    const tree = SKILL_TREES[classKey];
    const owned = userSkills.filter((s) => tree?.skills[s.skill_id]);
    const spent = owned.reduce((sum, s) => sum + tree.skills[s.skill_id].cost * Number(s.skill_level), 0);
    return { skills: owned.length, spent, refund: Math.floor((spent * LIMITS.RESPEC_REFUND_PERCENT) / 100) };
}

async function classShop(interaction) {
    const userId = interaction.user.id;
    const user = await users.ensureUser(userId);

    // Start in browse mode with the current class selected
    await interaction.reply({
        ...(await classView(userId, user, user.player_class)),
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
    //  CLASS BROWSER NAVIGATION (previous, next and back from the skill tree)
    // ═══════════════════════════════════════════════════════════════════════════

    if (id.startsWith('class_prev_') || id.startsWith('class_next_') || id.startsWith('class_browse_')) {
        const classKey = classKeyFrom(id);
        if (!classKey) return interaction.deferUpdate();
        const user = await users.getUser(userId);
        return interaction.update({ ...(await classView(userId, user, classKey)) });
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

        await interaction.update({
            ...(await classView(userId, updatedUser, 'DEFAULT'))
        });

        return interaction.followUp({
            embeds: [ui.success('Class Changed', '⚪ You are now using the **Default** class.')],
            flags: MessageFlags.Ephemeral
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  SKILL TREE VIEW (from browser)
    // ═══════════════════════════════════════════════════════════════════════════

    if (id.startsWith('class_skills_') || id.startsWith('skill_back_')) {
        const user = await users.getUser(userId);
        const userSkills = await users.getUserSkills(userId);
        const selectedClass = classKeyFrom(id) || user.player_class;

        const tree = SKILL_TREES[selectedClass];
        if (!tree) {
            const index = Math.max(0, CLASS_ORDER.indexOf(selectedClass));
            return interaction.update({
                embeds: [ui.error('No Skill Tree', `No skill tree found for ${selectedClass} class.`)],
                components: ui.classBrowserButtons(user, selectedClass, CLASSES[selectedClass], index, CLASS_ORDER.length)
            });
        }

        return interaction.update(skillTreeView(user, userSkills, selectedClass));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  SKILL TREE RESET (ask first, then refund)
    // ═══════════════════════════════════════════════════════════════════════════

    if (id.startsWith('skill_respec_yes_')) {
        const classKey = classKeyFrom(id);
        if (!classKey) return interaction.deferUpdate();
        // Ownership, the once-a-day limit and the refund are enforced atomically.
        const result = await progression.respecSkills(userId, classKey);
        const user = await users.getUser(userId);
        const userSkills = await users.getUserSkills(userId);

        await interaction.update(skillTreeView(user, userSkills, classKey));
        await interaction.followUp({
            embeds: [ui.success('Skills Reset', `Removed ${result.removed.length} skill${result.removed.length === 1 ? '' : 's'} and refunded **${result.refund.toLocaleString()} XP** (${result.percent}% of ${result.spent.toLocaleString()}). Balance: ${result.balance.toLocaleString()} XP.`)],
            ...EPHEMERAL
        });
        return;
    }

    if (id.startsWith('skill_respec_')) {
        const classKey = classKeyFrom(id);
        if (!classKey || !SKILL_TREES[classKey]) return interaction.deferUpdate();
        const preview = respecPreview(await users.getUserSkills(userId), classKey);
        if (!preview.skills) {
            return interaction.update({ embeds: [ui.error('Nothing to reset', `You have no ${SKILL_TREES[classKey].name} skills.`)], components: [] });
        }
        return interaction.update({
            embeds: [ui.warn(
                `Reset the ${SKILL_TREES[classKey].name} tree?`,
                `This removes ${preview.skills} skill${preview.skills === 1 ? '' : 's'} and refunds **${preview.refund.toLocaleString()} XP** (${LIMITS.RESPEC_REFUND_PERCENT}% of the ${preview.spent.toLocaleString()} XP they cost). The refund never counts as lifetime XP, and you can reset one tree a day.`
            )],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`skill_respec_yes_${classKey}`).setLabel('Reset and refund').setEmoji('🔄').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`skill_back_${classKey}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
            )]
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  SKILL UNLOCK/UPGRADE
    // ═══════════════════════════════════════════════════════════════════════════

    if (id.startsWith('skill_unlock_')) {
        const skillId = id.replace('skill_unlock_', '');
        // Ownership, prerequisites, max level and cost are enforced atomically.
        const result = await progression.unlockSkill(userId, skillId);
        const updatedUser = await users.getUser(userId);
        const updatedSkills = await users.getUserSkills(userId);

        await interaction.update(skillTreeView(updatedUser, updatedSkills, result.treeKey));

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

        await interaction.update({
            ...(await classView(userId, user, classKey))
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

        await interaction.update({
            ...(await classView(userId, user, classKey))
        });
        await interaction.followUp({ embeds: [ui.success('Equipped!', `Now a ${cls.emoji} **${cls.name}**!`)], ...EPHEMERAL });
    }
}

// Handle class select menu (jump straight to a class in the browser)
async function handleClassSelect(interaction) {
    const userId = interaction.user.id;
    const selectedClass = interaction.values[0];
    if (!Object.prototype.hasOwnProperty.call(CLASSES, selectedClass)) {
        return interaction.reply({ embeds: [ui.error('Unknown class', 'That class is not available.')], ...EPHEMERAL });
    }

    const user = await users.getUser(userId);
    await interaction.update({
        ...(await classView(userId, user, selectedClass))
    });
}

// Handle skill select menu (`skill_select_<CLASS>`: the menu says which tree it belongs to)
async function handleSkillSelect(interaction) {
    const userId = interaction.user.id;
    const skillId = interaction.values[0];

    const user = await users.getUser(userId);
    const userSkills = await users.getUserSkills(userId);
    const selectedClass = classKeyFrom(interaction.customId) || user.player_class;

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
        components: [ui.skillActionButtons(skillId, skill, currentLevel, reqMet, user.player_xp, selectedClass)]
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  📊 /leaderboard - Single Organized Embed
// ═══════════════════════════════════════════════════════════════════════════════

const BOARD_LABELS = {
    lifetime: { title: 'Top players by lifetime XP', unit: 'XP' },
    xp: { title: 'Top players by current XP balance', unit: 'XP' },
    weekly: { title: 'Most XP earned this week', unit: 'XP this week' },
    streak: { title: 'Longest daily streaks', unit: 'day streak' }
};

const leaderboardData = new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('📊 View top players')
    .addStringOption((o) =>
        o
            .setName('by')
            .setDescription('What to rank by (default: lifetime XP)')
            .addChoices(
                { name: 'Lifetime XP', value: 'lifetime' },
                { name: 'Earned this week', value: 'weekly' },
                { name: 'Daily streak', value: 'streak' },
                { name: 'Current XP balance', value: 'xp' }
            )
    );

async function leaderboard(interaction) {
    await interaction.deferReply();
    const by = interaction.options.getString('by') || 'lifetime';
    const label = BOARD_LABELS[by];
    const rows = await users.getLeaderboard(10, { by });

    if (!rows.length) {
        return interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0x2C2F33).setTitle('🏆 Leaderboard').setDescription(by === 'weekly' || by === 'streak' ? '*Nobody here yet this week. Be the first!*' : '*No players yet! Be the first to earn XP!*')]
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
            return { ...u, name: escapeDiscord(name || 'Adventurer', { max: 60 }), avatarURL };
        })
    );

    const embed = new EmbedBuilder().setColor(0xFFD700).setTitle('🏆 Leaderboard').setDescription(label.title);
    if (entries[0]?.avatarURL) embed.setThumbnail(entries[0].avatarURL);

    const medals = ['🥇', '🥈', '🥉'];
    const boardText = entries
        .map((e, i) => {
            const stats = [`${Number(e.score).toLocaleString()} ${label.unit}`, `Lv.${e.player_level}`];
            if (by !== 'streak' && e.streak_count > 0) stats.push(`🔥${e.streak_count}`);
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
    // Only link to a URL the operator configured; never guess a domain.
    const webAppUrl = process.env.WEB_APP_URL;
    if (!webAppUrl || !/^https?:\/\//.test(webAppUrl)) {
        return interaction.reply({ embeds: [ui.info('Web app not configured', 'Ask the bot owner to set WEB_APP_URL.')], ...EPHEMERAL });
    }

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
    pingData, dailyData, freezeData, automationData, profileData, achievementsData,
    classData, leaderboardData, toggleData, helpData, appData,
    // Command handlers
    ping, daily, freeze, automation, profile, achievements, classShop, leaderboard, toggle, help, app,
    // Button handlers
    handleClassButton, handleAchievementPagination,
    // Select menu handlers
    handleClassSelect, handleSkillSelect
};
