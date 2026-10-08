/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🎮 GAMIFICATION COMMANDS (v3.5 - Skill Trees & Major UI Overhaul)
 * 
 *  /ping - Stateless latency check (no DB access)
 *  /daily - Daily XP reward (100 XP, resets 4AM)
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
const db = require('../database/db');
const ui = require('../utils/ui');
const { CLASSES, SKILL_TREES, ACHIEVEMENTS, checkAchievements, getSkillBonuses, calculateFinalXP } = require('../utils/gameLogic');

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

const DAILY_XP = 100;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

function formatTimeRemaining(ms) {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((ms % (1000 * 60)) / 1000);
    
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
}

async function daily(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    const userId = interaction.user.id;
    const user = await db.getOrCreateUser(userId);
    
    const now = Date.now();
    const lastClaim = user.last_daily_claim ? new Date(user.last_daily_claim).getTime() : 0;
    const timeSinceClaim = now - lastClaim;
    
    // Check if 24 hours have passed
    if (lastClaim && timeSinceClaim < DAILY_COOLDOWN_MS) {
        const timeRemaining = DAILY_COOLDOWN_MS - timeSinceClaim;
        
        return interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(0xFEE75C)
                .setTitle('⏰ Already Claimed!')
                .setDescription(`You've already claimed your daily XP.`)
                .addFields(
                    { name: '⏱️ Time Remaining', value: formatTimeRemaining(timeRemaining), inline: true },
                    { name: '🔥 Current Streak', value: `${user.streak_count || 0} days`, inline: true }
                )
                .setFooter({ text: 'Come back when the timer resets!' })
            ]
        });
    }
    
    // Calculate streak
    const STREAK_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours to maintain streak
    let newStreak;
    let streakBroken = false;
    
    if (!lastClaim) {
        newStreak = 1;
    } else if (timeSinceClaim <= STREAK_WINDOW_MS) {
        newStreak = (user.streak_count || 0) + 1;
    } else {
        newStreak = 1;
        streakBroken = user.streak_count > 1;
    }
    
    // Calculate streak bonus (5 XP per streak day, max +50)
    const streakBonus = Math.min((newStreak - 1) * 5, 50);
    
    // Get user skills
    const userSkills = await db.getUserSkills(userId);
    
    // Apply class and skill bonuses to base daily XP
    let classBonus = 0;
    let bonusInfo = { type: null, details: '' };
    let userUpdates = {};
    
    if (user.gamification_enabled) {
        const result = calculateFinalXP(user, userSkills, DAILY_XP);
        classBonus = result.finalXP - DAILY_XP; // Extra XP from class/skill multipliers
        bonusInfo = result.bonusInfo;
        userUpdates = result.userUpdates;
    }
    
    // Get skill daily bonus (Early Bird adds +10 daily XP per level)
    const skillBonuses = getSkillBonuses(userSkills, user.player_class);
    const skillDailyBonus = skillBonuses.dailyBonus || 0;
    
    // Calculate total XP: base + class bonus + streak + skill daily bonus
    const totalXP = DAILY_XP + classBonus + streakBonus + skillDailyBonus;
    
    // Award daily XP
    const newXP = user.player_xp + totalXP;
    const newLevel = Math.floor(newXP / 100) + 1;
    const leveledUp = newLevel > user.player_level;
    
    await db.updateUser(userId, {
        player_xp: newXP,
        player_level: newLevel,
        streak_count: newStreak,
        last_daily_claim: new Date().toISOString(),
        ...userUpdates // Update class counters (assassin_streak, wizard_counter, etc.)
    });
    
    // Log transaction
    try {
        const pool = await db.getPool();
        await pool.execute(
            `INSERT INTO xp_transactions (discord_id, amount, source, balance_before, balance_after)
             VALUES (?, ?, 'daily', ?, ?)`,
            [userId, totalXP, user.player_xp, newXP]
        );
    } catch (e) { /* Table might not exist yet */ }
    
    // Build description
    let description = `You received **+${DAILY_XP} XP**`;
    if (classBonus > 0) description += ` + **+${classBonus} XP** class bonus`;
    if (streakBonus > 0) description += ` + **+${streakBonus} XP** streak bonus`;
    if (skillDailyBonus > 0) description += ` + **+${skillDailyBonus} XP** skill bonus`;
    description += '!';
    
    // Add class bonus details if applicable
    if (bonusInfo.details) {
        description += `\n${bonusInfo.details}`;
    }
    
    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🎁 Daily Reward Claimed!')
        .setDescription(description)
        .addFields(
            { name: '💰 Balance', value: `${newXP.toLocaleString()} XP`, inline: true },
            { name: '📊 Level', value: `${newLevel}`, inline: true },
            { name: '🔥 Streak', value: `${newStreak} day${newStreak > 1 ? 's' : ''}`, inline: true }
        )
        .setFooter({ text: 'Come back in 24 hours to keep your streak!' });
    
    if (leveledUp) {
        embed.addFields({ name: '🎉 Level Up!', value: `You reached **Level ${newLevel}**!`, inline: false });
    }
    
    if (streakBroken) {
        embed.addFields({ name: '💔 Streak Lost', value: `Your ${user.streak_count}-day streak was reset. Start again!`, inline: false });
    }
    
    if (newStreak === 7) {
        embed.addFields({ name: '🎊 Week Streak!', value: `Amazing! 7 days in a row!`, inline: false });
    } else if (newStreak === 30) {
        embed.addFields({ name: '🏆 Month Streak!', value: `Incredible! 30 days in a row!`, inline: false });
    }
    
    await interaction.editReply({ embeds: [embed] });
    
    // Check achievements
    const updatedUser = await db.getUser(userId);
    const achs = await db.getAchievements(userId);
    const newAchs = checkAchievements(updatedUser, achs.map(a => a.achievement_key));
    for (const a of newAchs) {
        await db.unlockAchievement(userId, a.key);
        await interaction.followUp({ embeds: [ui.achievementUnlockEmbed(a)], flags: MessageFlags.Ephemeral });
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🔔 /automation - Toggle deadline reminders
// ═══════════════════════════════════════════════════════════════════════════════

const automationData = new SlashCommandBuilder()
    .setName('automation')
    .setDescription('🔔 Toggle deadline reminder notifications');

async function automation(interaction) {
    const userId = interaction.user.id;
    await db.getOrCreateUser(userId);
    const newStatus = await db.toggleAutomation(userId);
    
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
const CLASS_INFO = {
    DEFAULT: { emoji: '⚪', color: 0x95A5A6, name: 'Default', desc: 'Balanced starter class', playstyle: 'Standard XP gains with no modifiers' },
    HERO:    { emoji: '⚔️', color: 0xFFD700, name: 'Hero', desc: '+20% XP on all tasks', playstyle: 'Consistent bonus XP on everything' },
    GAMBLER: { emoji: '🎲', color: 0x9B59B6, name: 'Gambler', desc: 'Variable XP (0.5x-2x)', playstyle: 'High risk, high reward gameplay' },
    ASSASSIN:{ emoji: '🗡️', color: 0x2C3E50, name: 'Assassin', desc: 'Streak bonuses stack', playstyle: 'Rewards consistent daily activity' },
    WIZARD:  { emoji: '🔮', color: 0x3498DB, name: 'Wizard', desc: 'Every 3rd task = 2x XP', playstyle: 'Strategic task completion timing' },
    ARCHER:  { emoji: '🏹', color: 0x27AE60, name: 'Archer', desc: 'Precision multipliers', playstyle: 'Focus on accuracy and streaks' },
    TANK:    { emoji: '🛡️', color: 0xE74C3C, name: 'Tank', desc: 'Steady XP stacking', playstyle: 'Slow but unstoppable progression' }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  👤 /profile - PLAYER DASHBOARD
//  Clean, informative, game-like interface
// ═══════════════════════════════════════════════════════════════════════════════

async function profile(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const userId = targetUser.id;
    
    await db.getOrCreateUser(userId);
    const stats = await db.getUserStats(userId);
    const user = stats.user;
    const userSkills = await db.getUserSkills(userId);
    
    // Get Discord member info
    let member = null;
    try { member = await interaction.guild?.members.fetch(userId); } catch (e) {}
    const discordUser = member?.user || targetUser;
    
    // Calculate progress values
    const xpInLevel = user.player_xp % 100;
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
            `**Total:** ${user.player_xp.toLocaleString()} XP`,
            `\`${xpProgress.bar}\` ${xpProgress.percent}%`,
            `-# ${100 - xpInLevel} XP to Level ${user.player_level + 1}`
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
    
    await interaction.reply({ embeds: [embed] });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🏆 /achievements - Ephemeral (user-only)
// ═══════════════════════════════════════════════════════════════════════════════

const achievementsData = new SlashCommandBuilder()
    .setName('achievements')
    .setDescription('🏆 View your achievements');

async function achievements(interaction) {
    const userId = interaction.user.id;
    await db.getOrCreateUser(userId);
    const userAchs = await db.getAchievements(userId);
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
    const userAchs = await db.getAchievements(userId);
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
    const user = await db.getOrCreateUser(userId);
    
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
    const userId = interaction.user.id;
    const id = interaction.customId;
    
    // ═══════════════════════════════════════════════════════════════════════════
    //  CLASS BROWSER NAVIGATION
    // ═══════════════════════════════════════════════════════════════════════════
    
    if (id === 'class_prev' || id === 'class_next') {
        const user = await db.getUser(userId);
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
        const user = await db.getUser(userId);
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
        const user = await db.getUser(userId);
        
        if (user.player_class === 'DEFAULT') {
            return interaction.reply({ 
                embeds: [ui.info('Already Default', 'You\'re already using the Default class.')],
                flags: MessageFlags.Ephemeral 
            });
        }
        
        await db.updateUser(userId, { player_class: 'DEFAULT' });
        const updatedUser = await db.getUser(userId);
        
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
        const user = await db.getUser(userId);
        const userSkills = await db.getUserSkills(userId);
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
        const user = await db.getUser(userId);
        const userSkills = await db.getUserSkills(userId);
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
        const user = await db.getUser(userId);
        const state = classViewState.get(userId) || { browseIndex: 0, selectedClass: user.player_class };
        const selectedClass = state.selectedClass || CLASS_ORDER[state.browseIndex] || user.player_class;
        
        const tree = SKILL_TREES[selectedClass];
        if (!tree || !tree.skills[skillId]) {
            return interaction.reply({ embeds: [ui.error('Invalid Skill')], flags: MessageFlags.Ephemeral });
        }
        
        const skill = tree.skills[skillId];
        const userSkills = await db.getUserSkills(userId);
        const existingSkill = await db.hasSkill(userId, skillId);
        const currentLevel = existingSkill?.skill_level || 0;
        
        // CLASS-LOCKING: Only allow DEFAULT skills for everyone, or class-specific skills if owned
        if (selectedClass !== 'DEFAULT') {
            const ownsClass = user[`owns_${selectedClass.toLowerCase()}`];
            if (!ownsClass) {
                return interaction.reply({ embeds: [ui.error('Class Required', `You must own the ${selectedClass} class to unlock this skill!`)], flags: MessageFlags.Ephemeral });
            }
        }
        
        // Check requirements
        if (skill.requires) {
            const hasReq = await db.hasSkill(userId, skill.requires);
            if (!hasReq) {
                return interaction.reply({ embeds: [ui.error('Locked', 'You need to unlock the required skill first!')], flags: MessageFlags.Ephemeral });
            }
        }
        
        // Check max level
        if (currentLevel >= skill.maxLevel) {
            return interaction.reply({ embeds: [ui.error('Maxed', 'This skill is already at maximum level!')], flags: MessageFlags.Ephemeral });
        }
        
        // Check XP
        if (user.player_xp < skill.cost) {
            return interaction.reply({ embeds: [ui.error('Not Enough XP', `You need ${skill.cost} XP!`)], flags: MessageFlags.Ephemeral });
        }
        
        // Deduct XP
        await db.updateUser(userId, { player_xp: user.player_xp - skill.cost });
        
        // Unlock or upgrade skill
        if (currentLevel === 0) {
            await db.unlockSkill(userId, skillId);
        } else {
            await db.upgradeSkill(userId, skillId);
        }
        
        // Refresh view
        const updatedUser = await db.getUser(userId);
        const updatedSkills = await db.getUserSkills(userId);
        
        // Create back button that returns to browser
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('class_browse')
                .setLabel('Back to Classes')
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Secondary)
        );
        
        await interaction.update({
            embeds: [ui.skillTreeEmbed(updatedUser, selectedClass, SKILL_TREES, updatedSkills)],
            components: [
                ui.skillSelectMenu(SKILL_TREES[selectedClass], updatedSkills),
                backRow
            ]
        });
        
        const action = currentLevel === 0 ? 'Unlocked' : 'Upgraded';
        await interaction.followUp({ 
            embeds: [ui.success(`${skill.emoji} ${skill.name} ${action}!`, `Now at level ${currentLevel + 1}/${skill.maxLevel}\n${skill.effect(currentLevel + 1)}`)], 
            flags: MessageFlags.Ephemeral 
        });
        return;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    //  CLASS BUY/EQUIP
    // ═══════════════════════════════════════════════════════════════════════════
    
    if (id.startsWith('cbuy_')) {
        const classKey = id.replace('cbuy_', '');
        const cls = CLASSES[classKey];
        if (!cls) return interaction.reply({ embeds: [ui.error('Invalid')], flags: MessageFlags.Ephemeral });
        
        let user = await db.getUser(userId);
        if (user[`owns_${classKey.toLowerCase()}`]) return interaction.reply({ embeds: [ui.info('Owned', 'Already owned')], flags: MessageFlags.Ephemeral });
        if (user.player_xp < cls.cost) return interaction.reply({ embeds: [ui.error('Not Enough XP', `Need ${cls.cost}`)], flags: MessageFlags.Ephemeral });
        
        await db.updateUser(userId, {
            player_xp: user.player_xp - cls.cost,
            [`owns_${classKey.toLowerCase()}`]: true,
            player_class: classKey,
            assassin_streak: 0, assassin_stacks: 0, wizard_counter: 0, archer_streak: 0, tank_stacks: 0
        });
        
        user = await db.getUser(userId);
        const achs = await db.getAchievements(userId);
        const newAchs = checkAchievements(user, achs.map(a => a.achievement_key));
        for (const a of newAchs) await db.unlockAchievement(userId, a.key);
        
        // Update browser state
        const classIndex = CLASS_ORDER.indexOf(classKey);
        classViewState.set(userId, { browseIndex: classIndex >= 0 ? classIndex : 0, selectedClass: classKey });
        
        await interaction.update({ 
            embeds: [ui.classDetailEmbed(user, classKey, cls, SKILL_TREES[classKey], classIndex >= 0 ? classIndex : 0, CLASS_ORDER.length)],
            components: ui.classBrowserButtons(user, classKey, cls, classIndex >= 0 ? classIndex : 0, CLASS_ORDER.length)
        });
        await interaction.followUp({ embeds: [ui.success('Purchased!', `Now a ${cls.emoji} **${cls.name}**!`)], flags: MessageFlags.Ephemeral });
        for (const a of newAchs) await interaction.followUp({ embeds: [ui.achievementUnlockEmbed(a)], flags: MessageFlags.Ephemeral });
        return;
    }
    
    if (id.startsWith('ceq_')) {
        const classKey = id.replace('ceq_', '');
        
        if (classKey === 'DEFAULT') {
            let user = await db.getUser(userId);
            if (user.player_class === 'DEFAULT') {
                return interaction.reply({ embeds: [ui.info('Already Default', 'You are already using the default class.')], flags: MessageFlags.Ephemeral });
            }
            
            await db.updateUser(userId, {
                player_class: 'DEFAULT',
                assassin_streak: 0, assassin_stacks: 0, wizard_counter: 0, archer_streak: 0, tank_stacks: 0
            });
            
            user = await db.getUser(userId);
            classViewState.set(userId, { browseIndex: 0, selectedClass: 'DEFAULT' });
            
            const classInfo = CLASSES['DEFAULT'];
            await interaction.update({ 
                embeds: [ui.classDetailEmbed(user, 'DEFAULT', classInfo, SKILL_TREES['DEFAULT'], 0, CLASS_ORDER.length)],
                components: ui.classBrowserButtons(user, 'DEFAULT', classInfo, 0, CLASS_ORDER.length)
            });
            await interaction.followUp({ embeds: [ui.success('Class Reset', 'Returned to ⚪ **Default** class!')], flags: MessageFlags.Ephemeral });
            return;
        }
        
        const cls = CLASSES[classKey];
        if (!cls) return interaction.reply({ embeds: [ui.error('Invalid')], flags: MessageFlags.Ephemeral });
        
        let user = await db.getUser(userId);
        if (!user[`owns_${classKey.toLowerCase()}`]) return interaction.reply({ embeds: [ui.error('Not Owned')], flags: MessageFlags.Ephemeral });
        
        await db.updateUser(userId, {
            player_class: classKey,
            assassin_streak: 0, assassin_stacks: 0, wizard_counter: 0, archer_streak: 0, tank_stacks: 0
        });
        
        user = await db.getUser(userId);
        const classIndex = CLASS_ORDER.indexOf(classKey);
        classViewState.set(userId, { browseIndex: classIndex >= 0 ? classIndex : 0, selectedClass: classKey });
        
        await interaction.update({ 
            embeds: [ui.classDetailEmbed(user, classKey, cls, SKILL_TREES[classKey], classIndex >= 0 ? classIndex : 0, CLASS_ORDER.length)],
            components: ui.classBrowserButtons(user, classKey, cls, classIndex >= 0 ? classIndex : 0, CLASS_ORDER.length)
        });
        await interaction.followUp({ embeds: [ui.success('Equipped!', `Now a ${cls.emoji} **${cls.name}**!`)], flags: MessageFlags.Ephemeral });
        return;
    }
}

// Handle class select menu (legacy - now redirects to browser)
async function handleClassSelect(interaction) {
    const userId = interaction.user.id;
    const selectedClass = interaction.values[0];
    
    const user = await db.getUser(userId);
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
    
    const user = await db.getUser(userId);
    const userSkills = await db.getUserSkills(userId);
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
    
    const users = await db.getLeaderboard(10);
    
    if (!users.length) {
        return interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(0x2C2F33)
                .setTitle('🏆 Leaderboard')
                .setDescription('*No players yet! Be the first to earn XP!*')
            ]
        });
    }
    
    // Fetch Discord user data for each user
    const leaderboardEntries = [];
    
    for (let i = 0; i < users.length; i++) {
        const u = users[i];
        let displayName = 'Unknown User';
        let avatarURL = null;
        
        try {
            if (interaction.guild) {
                const member = await interaction.guild.members.fetch(u.discord_id).catch(() => null);
                if (member) {
                    displayName = member.displayName;
                    avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 32 });
                }
            }
            
            if (displayName === 'Unknown User') {
                const discordUser = await interaction.client.users.fetch(u.discord_id).catch(() => null);
                if (discordUser) {
                    displayName = discordUser.displayName || discordUser.username;
                    avatarURL = discordUser.displayAvatarURL({ extension: 'png', size: 32 });
                }
            }
        } catch (e) {}
        
        // Calculate stats
        const stats = await db.getUserStats(u.discord_id);
        const totalItems = parseInt(stats?.items?.total) || 0;
        const completedItems = parseInt(stats?.items?.completed) || 0;
        const focusRate = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
        
        // Game stats - win rate excludes draws
        const gameStats = stats?.games || { played: 0, won: 0, lost: 0 };
        const decisiveGames = gameStats.won + gameStats.lost;
        const winRate = decisiveGames > 0 ? Math.round((gameStats.won / decisiveGames) * 100) : 0;
        
        leaderboardEntries.push({
            rank: i + 1,
            name: displayName,
            avatarURL,
            xp: u.player_xp,
            level: u.player_level,
            playerClass: u.player_class,
            streak: u.streak_count,
            focusRate,
            completed: completedItems,
            total: totalItems,
            gamesPlayed: gameStats.played,
            winRate
        });
    }
    
    // Build SINGLE embed with #1's avatar as thumbnail
    const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('🏆 Leaderboard')
        .setDescription('Top players by XP');
    
    // Set #1's avatar as thumbnail
    if (leaderboardEntries[0]?.avatarURL) {
        embed.setThumbnail(leaderboardEntries[0].avatarURL);
    }
    
    // Build leaderboard text - cleaner format
    let boardText = '';
    
    leaderboardEntries.forEach((entry, i) => {
        // Rank medals for top 3, numbers for rest
        const rankMedals = ['🥇', '🥈', '🥉'];
        const rankDisplay = i < 3 ? rankMedals[i] : `\`${entry.rank}.\``;
        
        // Class emoji
        const classEmoji = CLASS_INFO[entry.playerClass]?.emoji || '⚪';
        
        // Main line: Rank + Name + Class
        boardText += `${rankDisplay} **${entry.name}** ${classEmoji}\n`;
        
        // Stats line (muted) - compact format
        const stats = [];
        stats.push(`${entry.xp.toLocaleString()} XP`);
        stats.push(`Lv.${entry.level}`);
        if (entry.gamesPlayed > 0) stats.push(`${entry.gamesPlayed} games`);
        if (entry.streak > 0) stats.push(`🔥${entry.streak}`);
        
        boardText += `-# ${stats.join(' · ')}\n`;
        
        // Add spacing between entries (except last)
        if (i < leaderboardEntries.length - 1) boardText += '\n';
    });
    
    embed.addFields({ name: '​', value: boardText, inline: false });
    embed.setFooter({ text: `${leaderboardEntries.length} players · /profile for your stats` });
    
    await interaction.editReply({ embeds: [embed] });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ⚙️ /toggle
// ═══════════════════════════════════════════════════════════════════════════════

const toggleData = new SlashCommandBuilder()
    .setName('toggle')
    .setDescription('⚙️ Toggle XP system on/off');

async function toggle(interaction) {
    const userId = interaction.user.id;
    await db.getOrCreateUser(userId);
    const newStatus = await db.toggleGamification(userId);
    
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
