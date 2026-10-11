/**
 * /quick - add a task from one line of text, e.g.
 *   /quick text:"Finish report fri !high #work every week" list:Work
 * Dates, priority (!high), #tags and repeats (daily/weekly/monthly) are read
 * from the text; see packages/shared/src/quickAdd.js.
 */

'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { tasks, users } = require('@taskquest/shared/db');
const { parseQuickAdd, todayInZone, formatDeadline } = require('@taskquest/shared');
const ui = require('../utils/ui');
const aiSync = require('../utils/aiSync');
const { EPHEMERAL, handleError, sendRewards } = require('../utils/respond');

const data = new SlashCommandBuilder()
    .setName('quick')
    .setDescription('⚡ Add a task from one line: dates, !priority, #tags and repeats are understood')
    .addStringOption((o) => o.setName('text').setDescription('e.g. Finish report fri !high #work every week').setRequired(true).setMaxLength(300))
    .addStringOption((o) => o.setName('list').setDescription('The list to add it to').setRequired(true).setAutocomplete(true));

async function execute(interaction) {
    await interaction.deferReply(EPHEMERAL);
    try {
        const userId = interaction.user.id;
        const user = await users.ensureUser(userId);
        const list = await tasks.getListByName(userId, interaction.options.getString('list'));
        if (!list) return interaction.editReply({ embeds: [ui.error('List not found', 'Pick one of your lists from the suggestions.')] });

        const today = todayInZone(user.timezone);
        const parsed = parseQuickAdd(interaction.options.getString('text'), today);
        if (!parsed.name) return interaction.editReply({ embeds: [ui.error('Nothing to add', 'The text needs a task name besides the date, priority and tags.')] });

        const result = await tasks.addItem(userId, list.id, {
            name: parsed.name,
            due_date: parsed.due_date,
            priority: parsed.priority,
            tags: parsed.tags,
            recurrence: parsed.recurrence
        });
        aiSync.reindex(userId, list.id);

        const details = [
            parsed.due_date ? `📅 ${formatDeadline(parsed.due_date, today)}` : null,
            parsed.priority ? `❗ ${parsed.priority.toLowerCase()}` : null,
            parsed.tags.length ? parsed.tags.map((t) => `#${t}`).join(' ') : null,
            parsed.recurrence ? `🔁 ${parsed.recurrence}` : null
        ].filter(Boolean);
        await interaction.editReply({ embeds: [ui.success('Task added', `**${result.item.name}** in **${list.name}**${details.length ? `\n${details.join(' · ')}` : ''}`)] });
        await sendRewards(interaction, result);
    } catch (err) {
        await handleError(interaction, err);
    }
}

async function autocomplete(interaction) {
    try {
        const focused = interaction.options.getFocused(true);
        if (focused.name !== 'list') return await interaction.respond([]);
        const q = String(focused.value || '').toLowerCase();
        const lists = await tasks.getLists(interaction.user.id, { sortBy: 'name', order: 'ASC' });
        return await interaction.respond(
            lists
                .filter((l) => l.role !== 'viewer') // a view-only list cannot take a new task
                .filter((l) => l.name.toLowerCase().includes(q))
                .slice(0, 25)
                .map((l) => ({ name: l.name.slice(0, 100), value: l.name.slice(0, 100) }))
        );
    } catch {
        return interaction.respond([]).catch(() => {});
    }
}

module.exports = { data, execute, autocomplete };
