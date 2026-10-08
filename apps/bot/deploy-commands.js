/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🚀 DEPLOY COMMANDS - Clears ALL old commands (global + guild) first!
 *  Run: node deploy-commands.js
 *  Run with guild: node deploy-commands.js --guild YOUR_GUILD_ID
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const listCommand = require('./commands/list');
const gamification = require('./commands/gamification');
const gameCommand = require('./commands/game');

const commands = [
    listCommand.data.toJSON(),
    gameCommand.data.toJSON(),
    gamification.pingData.toJSON(),
    gamification.automationData.toJSON(),
    gamification.profileData.toJSON(),
    gamification.achievementsData.toJSON(),
    gamification.classData.toJSON(),
    gamification.leaderboardData.toJSON(),
    gamification.toggleData.toJSON(),
    gamification.helpData.toJSON(),
    gamification.dailyData.toJSON(),
    gamification.appData.toJSON()  // NEW: /app command
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// Get guild ID from command line or env
const guildId = process.argv[2]?.replace('--guild=', '') || process.env.GUILD_ID;

(async () => {
    try {
        console.log('╔═══════════════════════════════════════════════════════════════╗');
        console.log('║          🚀 TASKQUEST COMMAND DEPLOYMENT v3.2                 ║');
        console.log('╚═══════════════════════════════════════════════════════════════╝\n');
        
        // ═══════════════════════════════════════════════════════════════════════
        //  STEP 1: Clear ALL global commands
        // ═══════════════════════════════════════════════════════════════════════
        console.log('🗑️  Clearing ALL global commands...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: [] }
        );
        console.log('✅ Global commands cleared!\n');
        
        // ═══════════════════════════════════════════════════════════════════════
        //  STEP 2: Clear guild commands if guild ID provided
        // ═══════════════════════════════════════════════════════════════════════
        if (guildId) {
            console.log(`🗑️  Clearing ALL guild commands for ${guildId}...`);
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
                { body: [] }
            );
            console.log('✅ Guild commands cleared!\n');
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        //  STEP 3: Deploy new commands
        // ═══════════════════════════════════════════════════════════════════════
        if (guildId) {
            // Guild commands (instant update - for development)
            console.log(`🚀 Deploying ${commands.length} commands to guild ${guildId}...\n`);
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
                { body: commands }
            );
            console.log('✅ Guild commands deployed (instant update)!\n');
        } else {
            // Global commands (can take up to 1 hour)
            console.log(`🚀 Deploying ${commands.length} commands globally...\n`);
            await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                { body: commands }
            );
            console.log('✅ Global commands deployed!\n');
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        //  STEP 4: Show deployed commands
        // ═══════════════════════════════════════════════════════════════════════
        console.log('📋 Deployed commands:');
        commands.forEach(c => console.log(`   /${c.name} - ${c.description}`));
        
        console.log('\n═══════════════════════════════════════════════════════════════');
        if (guildId) {
            console.log('✅ Done! Guild commands are available immediately.');
        } else {
            console.log('⚠️  Global commands can take up to 1 hour to update.');
            console.log('   For instant updates, use: node deploy-commands.js --guild=YOUR_GUILD_ID');
        }
        console.log('═══════════════════════════════════════════════════════════════\n');
        
    } catch (error) {
        console.error('❌ Deploy failed:', error);
        process.exit(1);
    }
})();
