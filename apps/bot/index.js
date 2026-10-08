/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🎮 TASKQUEST BOT (v3.8.0 - Clean UI + Web App Integration)
 * 
 *  STATE MACHINE:
 *  IDLE → PING (stateless, no DB) → RETURN_LATENCY
 *       → LIST_OVERVIEW → LIST_VIEW (read-only: sort, search)
 *                       → LIST_EDIT (single mutation hub)
 *       → AUTOMATION_SETTINGS → TOGGLE_ON / TOGGLE_OFF
 *       → GAME_CENTER → BLACKJACK → BET_ENTRY → GAME_PLAY → RESOLUTION
 * 
 *  RULES:
 *  - VIEW = READ-ONLY (no mutations)
 *  - EDIT = ALL mutations
 *  - XP/Achievements = EPHEMERAL ONLY (never public)
 *  - Automation runs outside interactions (background)
 *  - Games use XP transaction logging (escrow model)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();

const { Client, GatewayIntentBits, Events, ActivityType, MessageFlags, Partials } = require('discord.js');
const http = require('http');
const db = require('./database/db');
const listCommand = require('./commands/list');
const gamification = require('./commands/gamification');
const gameCommand = require('./commands/game');
const sessionManager = require('./utils/games/sessionManager');

// ═══════════════════════════════════════════════════════════════════════════════
//  🌐 KEEP-ALIVE SERVER (for Render free tier)
// ═══════════════════════════════════════════════════════════════════════════════
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
        status: 'online', 
        bot: 'TaskQuest',
        version: '3.8.0',
        uptime: process.uptime()
    }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 Keep-alive server running on port ${PORT}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  🤖 DISCORD CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel]
});

const log = (e, c, m) => console.log(`[${new Date().toLocaleTimeString('en-US', { hour12: false })}] ${e} [${c}] ${m}`);

// ═══════════════════════════════════════════════════════════════════════════════
//  ⏰ AUTOMATION SCHEDULER - Background task (not tied to interactions)
//  - Runs hourly
//  - DMs users when deadline == today
//  - Notifies once per list per day
//  - Never spams public channels
// ═══════════════════════════════════════════════════════════════════════════════

async function checkDeadlines() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const lists = await db.getListsDueToday(today);
        
        for (const list of lists) {
            try {
                const user = await client.users.fetch(list.discord_id);
                if (user) {
                    const items = await db.getItems(list.id);
                    const done = items.filter(i => i.completed).length;
                    
                    // Private DM notification
                    await user.send({
                        embeds: [{
                            color: 0xFF6B6B,
                            title: '⏰ Deadline Today!',
                            description: `Your list **${list.name}** is due today!`,
                            fields: [
                                { name: '📊 Progress', value: `${done}/${items.length} items`, inline: true },
                                { name: '📁 Category', value: list.category || 'None', inline: true }
                            ],
                            footer: { text: 'TaskQuest • /automation to toggle' }
                        }]
                    });
                    
                    await db.markDeadlineNotified(list.id);
                    log('📬', 'DEADLINE', `Notified ${user.tag} for "${list.name}"`);
                }
            } catch (e) {
                // User has DMs disabled - fail silently
            }
        }
    } catch (e) {
        log('❌', 'DEADLINE', e.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🚀 READY
// ═══════════════════════════════════════════════════════════════════════════════

client.once(Events.ClientReady, async (c) => {
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║   🎮 TASKQUEST BOT v3.8.0 - ONLINE (Clean UI) 🎮    ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');
    
    try {
        await db.initializeDatabase();
        log('✅', 'DB', 'Connected');
        
        // Cleanup expired game sessions on startup
        const expired = await sessionManager.expireOldSessions();
        if (expired > 0) log('🧹', 'CLEANUP', `Expired ${expired} old game sessions`);
    } catch (e) {
        log('❌', 'DB', e.message);
    }
    
    c.user.setPresence({ activities: [{ name: '/game', type: ActivityType.Playing }], status: 'online' });
    
    // Start deadline scheduler
    setTimeout(checkDeadlines, 5000);
    setInterval(checkDeadlines, 60 * 60 * 1000); // Every hour

    // Auto-delete old lists cleanup - every 24 hours
    setTimeout(async () => {
        try {
            const deleted = await db.cleanupOldLists();
            if (deleted > 0) log('🗑️', 'AUTO-DELETE', `Cleaned up ${deleted} old lists`);
        } catch (e) {
            log('❌', 'AUTO-DELETE', e.message);
        }
    }, 10000); // Run 10 seconds after startup

    setInterval(async () => {
        try {
            const deleted = await db.cleanupOldLists();
            if (deleted > 0) log('🗑️', 'AUTO-DELETE', `Cleaned up ${deleted} old lists`);
        } catch (e) {
            log('❌', 'AUTO-DELETE', e.message);
        }
    }, 24 * 60 * 60 * 1000); // Every 24 hours

    // Game session cleanup - every 15 minutes
    setInterval(async () => {
        const expired = await sessionManager.expireOldSessions();
        if (expired > 0) log('🧹', 'CLEANUP', `Expired ${expired} old game sessions`);
    }, 15 * 60 * 1000);
    
    log('🎉', 'READY', `${c.user.tag} | ${c.guilds.cache.size} servers`);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  🎯 INTERACTION HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        // ═══════════════════════════════════════════════════════════════════════
        //  AUTOCOMPLETE
        // ═══════════════════════════════════════════════════════════════════════
        if (interaction.isAutocomplete()) {
            const focused = interaction.options.getFocused(true);
            if (focused.name === 'name') {
                const lists = await db.getLists(interaction.user.id);
                const filtered = lists.filter(l => l.name.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
                await interaction.respond(filtered.map(l => ({ name: l.name, value: l.name })));
            } else {
                await interaction.respond([]);
            }
            return;
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        //  SLASH COMMANDS
        // ═══════════════════════════════════════════════════════════════════════
        if (interaction.isChatInputCommand()) {
            const cmd = interaction.commandName;
            log('⌨️', 'CMD', `${interaction.user.tag} /${cmd}`);
            
            switch (cmd) {
                case 'list': await listCommand.execute(interaction); break;
                case 'game': await gameCommand.execute(interaction); break;
                case 'ping': await gamification.ping(interaction); break;
                case 'daily': await gamification.daily(interaction); break;
                case 'automation': await gamification.automation(interaction); break;
                case 'profile': await gamification.profile(interaction); break;
                case 'achievements': await gamification.achievements(interaction); break;
                case 'class': await gamification.classShop(interaction); break;
                case 'leaderboard': await gamification.leaderboard(interaction); break;
                case 'toggle': await gamification.toggle(interaction); break;
                case 'help': await gamification.help(interaction); break;
                case 'app': await gamification.app(interaction); break;
                default: await interaction.reply({ content: '❌ Unknown command', flags: MessageFlags.Ephemeral });
            }
            return;
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        //  BUTTONS
        // ═══════════════════════════════════════════════════════════════════════
        if (interaction.isButton()) {
            const id = interaction.customId;
            log('🔘', 'BTN', `${interaction.user.tag} ${id}`);
            
            // List command buttons
            if (['sort_az', 'sort_date', 'sort_pri', 'create', 'back', 'filter_cat', 'filter_all', 'filter_current', 'filter_expired', 'filter_completed'].includes(id) ||
                id.startsWith('sort_') || id.startsWith('search_') || id.startsWith('refresh_') ||
                id.startsWith('edit_') || id.startsWith('view_') ||
                id.startsWith('item_') || id.startsWith('list_') ||
                id.startsWith('rename_') || id.startsWith('yes_') || id.startsWith('no_') ||
                id.startsWith('metadone_')) {
                await listCommand.handleButton(interaction);
                return;
            }
            
            // Class shop buttons
            if (id.startsWith('cbuy_') || id.startsWith('ceq_') || id.startsWith('cx_')) {
                await gamification.handleClassButton(interaction);
                return;
            }
            
            // Class navigation & skill buttons (including new browser controls)
            if (id === 'class_overview' || id === 'class_skills' || id === 'skill_back' || 
                id === 'class_browse' || id === 'class_prev' || id === 'class_next' ||
                id === 'class_return_default' || id === 'skill_back_to_class' ||
                id === 'class_equipped_placeholder' || id === 'class_return_current' ||
                id.startsWith('skill_unlock_')) {
                await gamification.handleClassButton(interaction);
                return;
            }
            
            // Achievement pagination
            if (id.startsWith('ach_')) {
                await gamification.handleAchievementPagination(interaction);
                return;
            }
            
            // ═══════════════════════════════════════════════════════════════════
            //  🎰 GAME BUTTONS (Blackjack, RPS, etc.)
            //  Note: bj_bet_custom needs modal, handled separately (no defer)
            // ═══════════════════════════════════════════════════════════════════
            if (id === 'bj_bet_custom') {
                // Must NOT defer before showing modal
                await gameCommand.handleButtonNoDefer(interaction);
                return;
            }
            
            if (id.startsWith('bj_') || id.startsWith('game_') || id.startsWith('rps_') || id.startsWith('hm_')) {
                await gameCommand.handleButton(interaction);
                return;
            }
            
            // Unknown button - try to respond, but catch if interaction expired
            try {
                await interaction.reply({ content: '❌ Button expired or unknown', flags: MessageFlags.Ephemeral });
            } catch (e) {
                // Interaction already expired, can't respond
                console.log('⚠️ Could not respond to expired interaction:', id);
            }
            return;
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        //  SELECT MENUS
        // ═══════════════════════════════════════════════════════════════════════
        if (interaction.isStringSelectMenu()) {
            const id = interaction.customId;
            log('📋', 'SELECT', `${interaction.user.tag} ${id}`);
            
            // Game select menu
            if (id === 'game_select') {
                await gameCommand.handleSelectMenu(interaction);
                return;
            }
            
            // Hangman letter select
            if (id === 'hm_letter_select') {
                await gameCommand.handleHangmanSelect(interaction);
                return;
            }
            
            // Class select menu
            if (id === 'class_select') {
                await gamification.handleClassSelect(interaction);
                return;
            }
            
            // Skill select menu
            if (id === 'skill_select') {
                await gamification.handleSkillSelect(interaction);
                return;
            }
            
            // List select menus
            await listCommand.handleSelectMenu(interaction);
            return;
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        //  MODALS
        // ═══════════════════════════════════════════════════════════════════════
        if (interaction.isModalSubmit()) {
            const id = interaction.customId;
            log('📝', 'MODAL', `${interaction.user.tag} ${id}`);
            
            // Game modals
            if (id === 'bj_bet_modal') {
                await gameCommand.handleModal(interaction);
                return;
            }
            
            // List modals
            await listCommand.handleModal(interaction);
            return;
        }
        
    } catch (e) {
        log('❌', 'ERROR', e.message);
        console.error(e.stack);
        try {
            const msg = { content: '❌ An error occurred', flags: MessageFlags.Ephemeral };
            if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
            else await interaction.reply(msg);
        } catch (x) {}
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ⚠️ ERROR HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

process.on('unhandledRejection', (e) => log('❌', 'UNHANDLED', e?.message || e));
process.on('uncaughtException', (e) => { log('❌', 'UNCAUGHT', e.message); setTimeout(() => process.exit(1), 1000); });
process.on('SIGINT', async () => {
    log('🛑', 'SHUTDOWN', 'Goodbye!');
    try { await db.closePool(); } catch (e) {}
    server.close();
    client.destroy();
    process.exit(0);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  🚀 START
// ═══════════════════════════════════════════════════════════════════════════════

if (!process.env.DISCORD_TOKEN) { console.error('❌ Set DISCORD_TOKEN in .env'); process.exit(1); }
client.login(process.env.DISCORD_TOKEN);