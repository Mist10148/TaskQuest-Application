/** /weekly - turn the Monday weekly digest DM on or off. */

'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { users } = require('@taskquest/shared/db');
const ui = require('../utils/ui');
const { EPHEMERAL, handleError } = require('../utils/respond');

const data = new SlashCommandBuilder().setName('weekly').setDescription('📅 Turn the weekly summary DM on or off');

async function execute(interaction) {
    await interaction.deferReply(EPHEMERAL);
    try {
        const on = await users.toggleSetting(interaction.user.id, 'weekly_digest');
        const embed = on
            ? ui.success('Weekly digest on', 'I will DM you a summary every Monday morning. Set your hour and time zone with `/timezone`.')
            : ui.info('Weekly digest off', 'No more weekly summaries. Run `/weekly` again to turn them back on.');
        await interaction.editReply({ embeds: [embed] });
    } catch (err) {
        await handleError(interaction, err);
    }
}

module.exports = { data, execute };
