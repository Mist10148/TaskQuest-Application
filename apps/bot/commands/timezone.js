/**
 * /timezone - set the time zone and hour for your deadline reminders.
 * Deadlines are plain dates; this decides when "today" starts for you, when your
 * daily limits, quests and weekly review reset, and when in the day the reminder DM arrives.
 * The zone can change once every 24 hours (the shared users service rejects a faster change).
 */

'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { users } = require('@taskquest/shared/db');
const { isValidTimeZone, todayInZone, hourInZone } = require('@taskquest/shared');
const ui = require('../utils/ui');
const { EPHEMERAL, handleError } = require('../utils/respond');

const data = new SlashCommandBuilder()
    .setName('timezone')
    .setDescription('🕒 Set your time zone (your day, quests and reminders) and the hour reminders arrive')
    .addStringOption((o) => o.setName('zone').setDescription('Time zone, e.g. Europe/Paris or Asia/Manila').setAutocomplete(true))
    .addIntegerOption((o) => o.setName('hour').setDescription('Hour of day for reminders (0-23, default 9)').setMinValue(0).setMaxValue(23));

let zones;
const allZones = () => (zones ||= (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC']).concat('UTC'));

const clock = (hour) => `${String(hour).padStart(2, '0')}:00`;

async function execute(interaction) {
    await interaction.deferReply(EPHEMERAL);
    try {
        const zone = interaction.options.getString('zone');
        const hour = interaction.options.getInteger('hour');
        if (zone !== null && !isValidTimeZone(zone)) {
            return interaction.editReply({ embeds: [ui.error('Unknown time zone', 'Pick one from the suggestions, e.g. `Europe/Paris` or `Asia/Manila`.')] });
        }
        const changes = {};
        if (zone !== null) changes.timezone = zone;
        if (hour !== null) changes.reminder_hour = hour;
        const user = Object.keys(changes).length ? await users.updateSettings(interaction.user.id, changes) : await users.ensureUser(interaction.user.id);

        const tz = user.timezone || 'UTC';
        const lines = [
            `**Time zone:** ${user.timezone || 'UTC (not set)'}`,
            `**Local time now:** ${todayInZone(tz)} ${clock(hourInZone(tz))}`,
            `**Reminders arrive:** around ${clock(user.reminder_hour ?? 9)}`,
            'Your day starts at midnight in this zone: daily limits, quests and the weekly review reset then. A zone can change once every 24 hours.'
        ];
        const title = Object.keys(changes).length ? 'Reminder settings saved' : 'Your reminder settings';
        await interaction.editReply({ embeds: [ui.success(title, lines.join('\n'))] });
    } catch (err) {
        await handleError(interaction, err);
    }
}

async function autocomplete(interaction) {
    try {
        const focused = interaction.options.getFocused(true);
        if (focused.name !== 'zone') return await interaction.respond([]);
        const q = String(focused.value || '').toLowerCase().replace(/ /g, '_');
        const matches = allZones().filter((z) => z.toLowerCase().includes(q)).slice(0, 25);
        return await interaction.respond(matches.map((z) => ({ name: z, value: z })));
    } catch (err) {
        return interaction.respond([]).catch(() => {});
    }
}

module.exports = { data, execute, autocomplete };
