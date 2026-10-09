/**
 * TaskQuest Discord bot.
 *
 *   /list → overview → view (read-only) → edit (all mutations)
 *   /game → blackjack · rock paper scissors · hangman
 *   /daily /profile /achievements /class /leaderboard /toggle /automation /help /app /ping
 *   /summary /prioritize /ask /forget /ai-format → AI service (when AI_ENABLED)
 *   @mention / reply / DM → AI conversation (chat.js)
 *
 * XP and achievements are always shown ephemerally. Background jobs send
 * deadline DMs, clean up old lists and expire abandoned game sessions.
 */

require('@taskquest/shared/env').loadEnv(__dirname);

const http = require('http');
const { Client, GatewayIntentBits, Events, ActivityType, MessageFlags, Partials } = require('discord.js');
const db = require('@taskquest/shared/db');
const { version } = require('./package.json');
const listCommand = require('./commands/list');
const gamification = require('./commands/gamification');
const gameCommand = require('./commands/game');
const aiCommands = require('./commands/ai');
const chat = require('./chat');

const log = (emoji, scope, msg) => console.log(`[${new Date().toISOString()}] ${emoji} [${scope}] ${msg}`);

// ─── Keep-alive / health endpoint (Render web services need an open port) ─────

const server = http.createServer((req, res) => {
    const ok = client.isReady();
    res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: ok ? 'online' : 'starting', bot: 'TaskQuest', version }));
});

// ─── Discord client ──────────────────────────────────────────────────────────

const intents = [GatewayIntentBits.Guilds];
if (process.env.AI_ENABLED === 'true') {
    // Conversation chat. Without Message Content, Discord still sends the text of messages
    // that mention the bot and of DMs; the privileged intent is opt-in for ping-less replies.
    intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages);
    if (process.env.AI_CHAT_MESSAGE_CONTENT === 'true') intents.push(GatewayIntentBits.MessageContent);
}

const client = new Client({ intents, partials: [Partials.Channel] });

// ─── Background jobs ─────────────────────────────────────────────────────────

/** Run a job, logging (not crashing on) failures. */
function job(name, fn) {
    return async () => {
        try {
            await fn();
        } catch (err) {
            log('❌', name, err.stack || err.message);
        }
    };
}

const checkDeadlines = job('DEADLINE', async () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const list of await db.tasks.getListsDueOn(today)) {
        try {
            const user = await client.users.fetch(list.discord_id);
            const items = (await db.tasks.getItems(list.discord_id, list.id)) || [];
            const done = items.filter((i) => i.completed).length;
            await user.send({
                embeds: [
                    {
                        color: 0xff6b6b,
                        title: '⏰ Deadline Today!',
                        description: `Your list **${list.name}** is due today!`,
                        fields: [
                            { name: '📊 Progress', value: `${done}/${items.length} tasks`, inline: true },
                            { name: '📁 Category', value: list.category || 'None', inline: true }
                        ],
                        footer: { text: 'TaskQuest • /automation to turn reminders off' }
                    }
                ]
            });
            log('📬', 'DEADLINE', `Reminded ${list.discord_id} about list ${list.id}`);
        } catch (err) {
            // 50007 = cannot DM this user (DMs closed). Anything else is worth logging.
            if (err.code !== 50007) log('⚠️', 'DEADLINE', `list ${list.id}: ${err.message}`);
        }
        // Mark even when the DM fails so a closed inbox isn't retried every hour.
        await db.tasks.markDeadlineNotified(list.id);
    }
});

const cleanupLists = job('AUTO-DELETE', async () => {
    const deleted = await db.tasks.cleanupOldLists();
    if (deleted > 0) log('🗑️', 'AUTO-DELETE', `Removed ${deleted} old lists`);
});

const expireGames = job('GAMES', async () => {
    const expired = await db.games.expireStaleSessions();
    if (expired > 0) log('🧹', 'GAMES', `Expired ${expired} abandoned game sessions (bets refunded)`);
});

const timers = [];

client.once(Events.ClientReady, (c) => {
    log('🎉', 'READY', `${c.user.tag} v${version} in ${c.guilds.cache.size} servers`);
    c.user.setPresence({ activities: [{ name: '/help', type: ActivityType.Playing }], status: 'online' });

    setTimeout(checkDeadlines, 5_000);
    setTimeout(cleanupLists, 10_000);
    expireGames();
    timers.push(setInterval(checkDeadlines, 60 * 60 * 1000));
    timers.push(setInterval(cleanupLists, 24 * 60 * 60 * 1000));
    timers.push(setInterval(expireGames, 5 * 60 * 1000));
});

// ─── Interaction routing ─────────────────────────────────────────────────────

const LIST_BUTTON_IDS = new Set(['create', 'back', 'filter_cat', 'filter_all', 'filter_current', 'filter_expired', 'filter_completed']);
const LIST_BUTTON_PREFIXES = ['sort_', 'search_', 'refresh_', 'edit_', 'view_', 'item_', 'list_', 'rename_', 'yes_', 'no_', 'metadone_'];
const CLASS_BUTTON_IDS = new Set([
    'class_overview', 'class_skills', 'skill_back', 'class_browse', 'class_prev', 'class_next',
    'class_return_default', 'skill_back_to_class', 'class_equipped_placeholder', 'class_return_current'
]);

const COMMANDS = {
    list: listCommand.execute,
    game: gameCommand.execute,
    ping: gamification.ping,
    daily: gamification.daily,
    automation: gamification.automation,
    profile: gamification.profile,
    achievements: gamification.achievements,
    class: gamification.classShop,
    leaderboard: gamification.leaderboard,
    toggle: gamification.toggle,
    help: gamification.help,
    app: gamification.app,
    summary: aiCommands.summary,
    prioritize: aiCommands.prioritize,
    ask: aiCommands.ask,
    forget: aiCommands.forget,
    'ai-format': aiCommands.aiFormat
};

async function route(interaction) {
    if (interaction.isAutocomplete()) {
        if (interaction.commandName === 'list') return listCommand.autocomplete(interaction);
        if (interaction.commandName === 'summary') return aiCommands.autocomplete(interaction);
        return interaction.respond([]);
    }

    if (interaction.isChatInputCommand()) {
        const handler = COMMANDS[interaction.commandName];
        if (!handler) return interaction.reply({ content: '❌ Unknown command', flags: MessageFlags.Ephemeral });
        return handler(interaction);
    }

    if (interaction.isButton()) {
        const id = interaction.customId;
        if (id.startsWith('ai_')) return aiCommands.handleButton(interaction);
        if (LIST_BUTTON_IDS.has(id) || LIST_BUTTON_PREFIXES.some((p) => id.startsWith(p))) return listCommand.handleButton(interaction);
        if (id.startsWith('cbuy_') || id.startsWith('ceq_') || id.startsWith('cx_') || id.startsWith('skill_unlock_') || CLASS_BUTTON_IDS.has(id)) {
            return gamification.handleClassButton(interaction);
        }
        if (id.startsWith('ach_')) return gamification.handleAchievementPagination(interaction);
        if (id === 'bj_bet_custom') return gameCommand.handleButtonNoDefer(interaction);
        if (id.startsWith('bj_') || id.startsWith('game_') || id.startsWith('rps_') || id.startsWith('hm_')) return gameCommand.handleButton(interaction);
        return interaction.reply({ content: '❌ This button has expired.', flags: MessageFlags.Ephemeral });
    }

    if (interaction.isStringSelectMenu()) {
        const id = interaction.customId;
        if (id === 'game_select') return gameCommand.handleSelectMenu(interaction);
        if (id.startsWith('hm_letter_select')) return gameCommand.handleHangmanSelect(interaction);
        if (id === 'class_select') return gamification.handleClassSelect(interaction);
        if (id === 'skill_select') return gamification.handleSkillSelect(interaction);
        return listCommand.handleSelectMenu(interaction);
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'bj_bet_modal') return gameCommand.handleModal(interaction);
        return listCommand.handleModal(interaction);
    }
}

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        await route(interaction);
    } catch (err) {
        log('❌', 'INTERACTION', `${interaction.customId || interaction.commandName}: ${err.stack || err.message}`);
        if (interaction.isAutocomplete()) return;
        try {
            const msg = { content: '❌ Something went wrong. Please try again.', flags: MessageFlags.Ephemeral };
            if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
            else await interaction.reply(msg);
        } catch {
            /* interaction expired */
        }
    }
});

client.on(Events.MessageCreate, (message) => chat.handleMessage(message, { log: (scope, msg) => log('⚠️', 'AI-CHAT', `${scope} ${msg}`) }));

// ─── Lifecycle ───────────────────────────────────────────────────────────────

let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log('🛑', 'SHUTDOWN', `${signal} received`);
    timers.forEach(clearInterval);
    server.close();
    await client.destroy();
    await db.closePool().catch(() => {});
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => log('❌', 'UNHANDLED', err?.stack || err));
process.on('uncaughtException', (err) => {
    log('❌', 'UNCAUGHT', err.stack || err.message);
    setTimeout(() => process.exit(1), 1000);
});

async function main() {
    if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN is not set (see apps/bot/.env.example)');
    await db.ping();
    if (process.env.MIGRATE_ON_START !== 'false') await db.runMigrations({ log: (m) => log('🗄️', 'DB', m) });
    else await db.assertSchemaCurrent();
    log('✅', 'DB', 'Connected');

    // BOT_PORT lets the bot and web server share one root .env without clashing.
    const port = parseInt(process.env.BOT_PORT || process.env.PORT, 10) || 3000;
    server.listen(port, () => log('🌐', 'HTTP', `Health endpoint on :${port}`));
    await client.login(process.env.DISCORD_TOKEN);
}

main().catch((err) => {
    log('❌', 'STARTUP', err.message);
    process.exit(1);
});
