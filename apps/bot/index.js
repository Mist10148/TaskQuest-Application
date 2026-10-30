/**
 * TaskQuest Discord bot.
 *
 *   /list → overview → view (read-only) → edit (all mutations)
 *   /game → blackjack · rock paper scissors · hangman
 *   /daily /profile /achievements /class /leaderboard /toggle /automation /help /app /ping
 *   /review /prestige /shop /today /focus
 *   /share /invites /members /leave → shared lists
 *   /party → a small group with a shared weekly quest
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
const { createPushClient } = require('@taskquest/shared/push');
const { version } = require('./package.json');
const listCommand = require('./commands/list');
const { job: runJob, stopJobs, whenIdle } = require('./utils/job');
const gamification = require('./commands/gamification');
const gameCommand = require('./commands/game');
const aiCommands = require('./commands/ai');
const questCommands = require('./commands/quests');
const reviewCommand = require('./commands/review');
const prestigeCommand = require('./commands/prestige');
const shopCommand = require('./commands/shop');
const aiSync = require('./utils/aiSync');
const reminders = require('./utils/reminders');
const timezoneCommand = require('./commands/timezone');
const digest = require('./utils/digest');
const streakWarning = require('./utils/streakWarning');
const weeklyCommand = require('./commands/weekly');
const quickCommand = require('./commands/quick');
const sharingCommands = require('./commands/sharing');
const partyCommand = require('./commands/party');
const todayCommand = require('./commands/today');
const focusCommand = require('./commands/focus');
const chat = require('./chat');
const { refreshProfile } = require('./utils/profile');

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

/** Run a job, logging (not crashing on) failures, never overlapping itself. */
const job = (name, fn) => runJob(name, fn, log);

// Web push (optional): the web server holds the VAPID keys; the bot only asks it, best effort. Off without WEB_PUSH_INTERNAL_URL.
const push = createPushClient();

const checkDeadlines = job('DEADLINE', async () => {
    const budget = reminders.createBudget(); // one cap per person across list and task reminders
    await reminders.sendDeadlineReminders({ db, client, log, push, budget });
    await reminders.sendTaskReminders({ db, client, log, push, budget });
    await reminders.flushOverflow({ client, log, budget });
});

const weeklyDigests = job('DIGEST', () => digest.sendWeeklyDigests({ db, client, log, push }));

const streakWarnings = job('STREAK', () => streakWarning.sendStreakWarnings({ db, client, log, push }));

const cleanupLists = job('AUTO-DELETE', async () => {
    const deleted = await db.tasks.cleanupOldLists();
    for (const list of deleted) aiSync.forget(list.discord_id, list.id); // drop their vectors too
    if (deleted.length > 0) log('🗑️', 'AUTO-DELETE', `Removed ${deleted.length} old lists`);
});

const expireGames = job('GAMES', async () => {
    const expired = await db.games.expireStaleSessions();
    if (expired > 0) log('🧹', 'GAMES', `Expired ${expired} abandoned game sessions (open Blackjack hands stand)`);
});

const timers = [];

client.once(Events.ClientReady, (c) => {
    log('🎉', 'READY', `${c.user.tag} v${version} in ${c.guilds.cache.size} servers`);
    c.user.setPresence({ activities: [{ name: '/help', type: ActivityType.Playing }], status: 'online' });

    timers.push(setTimeout(checkDeadlines, 5_000), setTimeout(cleanupLists, 10_000), setTimeout(weeklyDigests, 15_000), setTimeout(streakWarnings, 20_000));
    expireGames();
    timers.push(setInterval(checkDeadlines, 60 * 60 * 1000));
    timers.push(setInterval(weeklyDigests, 60 * 60 * 1000));
    timers.push(setInterval(streakWarnings, 60 * 60 * 1000));
    timers.push(setInterval(cleanupLists, 24 * 60 * 60 * 1000));
    timers.push(setInterval(expireGames, 5 * 60 * 1000));
});

// ─── Interaction routing ─────────────────────────────────────────────────────

const LIST_BUTTON_IDS = new Set(['create', 'back', 'filter_cat', 'filter_all', 'filter_current', 'filter_expired', 'filter_completed']);
const LIST_BUTTON_PREFIXES = ['sort_', 'search_', 'refresh_', 'edit_', 'view_', 'item_', 'list_', 'rename_', 'yes_', 'no_', 'metadone_'];
// The class browser keeps no state: its buttons carry the class they show (class_next_HERO), so they route by prefix.
const CLASS_BUTTON_IDS = new Set(['class_return_default']);
const CLASS_BUTTON_PREFIXES = ['cbuy_', 'ceq_', 'cx_', 'skill_unlock_', 'class_prev_', 'class_next_', 'class_browse_', 'class_skills_', 'skill_back_', 'skill_respec_'];

const COMMANDS = {
    list: listCommand.execute,
    game: gameCommand.execute,
    ping: gamification.ping,
    daily: gamification.daily,
    freeze: gamification.freeze,
    quests: questCommands.execute,
    review: reviewCommand.execute,
    prestige: prestigeCommand.execute,
    shop: shopCommand.execute,
    timezone: timezoneCommand.execute,
    weekly: weeklyCommand.execute,
    quick: quickCommand.execute,
    party: partyCommand.execute,
    today: todayCommand.execute,
    focus: focusCommand.execute,
    share: sharingCommands.share,
    invites: sharingCommands.invites,
    members: sharingCommands.members,
    leave: sharingCommands.leave,
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
        if (interaction.commandName === 'timezone') return timezoneCommand.autocomplete(interaction);
        if (interaction.commandName === 'quick') return quickCommand.autocomplete(interaction);
        if (['share', 'members', 'leave'].includes(interaction.commandName)) return sharingCommands.autocomplete(interaction);
        return interaction.respond([]);
    }

    if (interaction.isChatInputCommand()) {
        const handler = COMMANDS[interaction.commandName];
        if (!handler) return interaction.reply({ content: '❌ Unknown command', flags: MessageFlags.Ephemeral });
        void refreshProfile(db, interaction.user); // not awaited: never in the way of the command
        return handler(interaction);
    }

    if (interaction.isButton()) {
        const id = interaction.customId;
        if (id.startsWith('ai_')) return aiCommands.handleButton(interaction);
        if (id.startsWith('quest_claim_')) return questCommands.handleButton(interaction);
        if (id.startsWith('party_')) return partyCommand.handleButton(interaction);
        if (id.startsWith('inv_accept_') || id.startsWith('inv_decline_')) return sharingCommands.handleInviteButton(interaction);
        if (id.startsWith('leave_yes_') || id === 'leave_no') return sharingCommands.handleLeaveButton(interaction);
        if (id === 'review_claim') return reviewCommand.handleButton(interaction);
        if (id.startsWith('prestige_')) return prestigeCommand.handleButton(interaction);
        if (id.startsWith('shop_')) return shopCommand.handleButton(interaction);
        if (id === 'remind_off' || id.startsWith('remind_snooze_') || id.startsWith('task_remind_snooze_')) return reminders.handleButton(interaction);
        if (LIST_BUTTON_IDS.has(id) || LIST_BUTTON_PREFIXES.some((p) => id.startsWith(p))) return listCommand.handleButton(interaction);
        if (CLASS_BUTTON_IDS.has(id) || CLASS_BUTTON_PREFIXES.some((p) => id.startsWith(p))) {
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
        if (id.startsWith('shop_pick_')) return shopCommand.handleSelect(interaction);
        if (id.startsWith('mem_rm_')) return sharingCommands.handleSelect(interaction);
        if (id === 'class_select') return gamification.handleClassSelect(interaction);
        if (id.startsWith('skill_select_')) return gamification.handleSkillSelect(interaction);
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
            // A public "thinking…" placeholder that never got its answer would hang there for everyone: swap it for the private error.
            if (interaction.isChatInputCommand() && interaction.deferred && !interaction.replied && !interaction.ephemeral) await interaction.deleteReply().catch(() => {});
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
    // clearInterval also clears a timeout. Then let a run that is in flight finish (a DM just sent must get its "sent" mark) before the
    // connections go away.
    timers.forEach(clearInterval);
    stopJobs();
    server.close();
    if (!(await whenIdle(10_000))) log('⚠️', 'SHUTDOWN', 'a background job was still running after 10 seconds');
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
