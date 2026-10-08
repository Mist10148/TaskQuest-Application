/**
 * Register slash commands with Discord.
 *
 *   npm run deploy -w @taskquest/bot                  # global (can take up to 1h to propagate)
 *   npm run deploy -w @taskquest/bot -- --guild=ID    # one guild, instant (development)
 *   npm run deploy -w @taskquest/bot -- --guild ID --clear-global
 *
 * A bulk PUT replaces the whole command set atomically, so there is never a
 * window with no commands registered. `--clear-global` removes global
 * commands (useful when switching a dev bot to guild-only commands).
 */

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const listCommand = require('./commands/list');
const gamification = require('./commands/gamification');
const gameCommand = require('./commands/game');

const commands = [
    listCommand.data,
    gameCommand.data,
    gamification.pingData,
    gamification.dailyData,
    gamification.automationData,
    gamification.profileData,
    gamification.achievementsData,
    gamification.classData,
    gamification.leaderboardData,
    gamification.toggleData,
    gamification.helpData,
    gamification.appData
].map((c) => c.toJSON());

function argValue(name) {
    const args = process.argv.slice(2);
    const eq = args.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(name.length + 3);
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
}

async function main() {
    const { DISCORD_TOKEN, CLIENT_ID } = process.env;
    if (!DISCORD_TOKEN || !CLIENT_ID) throw new Error('DISCORD_TOKEN and CLIENT_ID must be set');

    const guildId = argValue('guild') || process.env.GUILD_ID || undefined;
    if (guildId && !/^\d{5,25}$/.test(guildId)) throw new Error(`Invalid guild id: ${guildId}`);

    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

    if (process.argv.includes('--clear-global')) {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
        console.log('🗑️  Cleared global commands');
    }

    const route = guildId ? Routes.applicationGuildCommands(CLIENT_ID, guildId) : Routes.applicationCommands(CLIENT_ID);
    const deployed = await rest.put(route, { body: commands });

    console.log(`✅ Deployed ${deployed.length} commands ${guildId ? `to guild ${guildId} (instant)` : 'globally (may take up to 1 hour)'}:`);
    for (const c of commands) console.log(`   /${c.name} — ${c.description}`);
}

main().catch((err) => {
    console.error('❌ Deploy failed:', err.message);
    process.exit(1);
});
