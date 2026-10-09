/**
 * AI commands (phase 6 of docs/AI_INTEGRATION.md): /summary, /prioritize, /ask.
 *
 * The bot calls the private AI service directly with the shared X-AI-Token, the
 * same way the web server does. The Discord ID always comes from the
 * interaction, never from user input. Replies are ephemeral because they
 * describe the user's own quests.
 */

const { SlashCommandBuilder } = require('discord.js');
const { TaskQuestError } = require('@taskquest/shared');
const { tasks, users } = require('@taskquest/shared/db');
const { createAiClient } = require('@taskquest/shared/ai');
const { EPHEMERAL, handleError, sendRewards } = require('../utils/respond');
const fmt = require('../utils/aiFormat');
const ui = require('../utils/ui');

const SLOW_CALL_MS = 45000; // summaries and rankings can take a while on a cold start

let client;
const ai = () => (client ||= createAiClient());

// ─── Command definitions ─────────────────────────────────────────────────────

const summaryData = new SlashCommandBuilder()
    .setName('summary')
    .setDescription('✨ AI summary of your quests')
    .addStringOption((o) =>
        o
            .setName('mode')
            .setDescription('What to summarize (default: briefing)')
            .addChoices(
                { name: "Today's briefing", value: 'digest' },
                { name: 'Recap of what I finished', value: 'recap' },
                { name: 'One quest', value: 'list' }
            )
    )
    .addStringOption((o) => o.setName('quest').setDescription('The quest to summarize (for "One quest")').setAutocomplete(true))
    .addStringOption((o) =>
        o
            .setName('range')
            .setDescription('Recap period (default: week)')
            .addChoices({ name: 'Today', value: 'day' }, { name: 'This week', value: 'week' })
    );

const prioritizeData = new SlashCommandBuilder()
    .setName('prioritize')
    .setDescription('🎯 AI ranking of what to work on next')
    .addIntegerOption((o) => o.setName('limit').setDescription('How many quests to show (default 5)').setMinValue(1).setMaxValue(10));

const askData = new SlashCommandBuilder()
    .setName('ask')
    .setDescription('💬 Ask the AI assistant about your quests or TaskQuest')
    .addStringOption((o) =>
        o.setName('question').setDescription('e.g. "What is due this week?" or "Add milk to my groceries"').setRequired(true).setMaxLength(2000)
    );

const forgetData = new SlashCommandBuilder()
    .setName('forget')
    .setDescription('🧹 Make the AI forget your conversation with it in this channel');

const aiFormatData = new SlashCommandBuilder()
    .setName('ai-format')
    .setDescription('🎨 How the AI replies when you mention it')
    .addStringOption((o) =>
        o
            .setName('format')
            .setDescription('Reply style')
            .setRequired(true)
            .addChoices({ name: 'Plain messages', value: 'text' }, { name: 'Embeds', value: 'embed' })
    );

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Throws unless AI is enabled on this deployment and for this user. */
async function assertAllowed(discordId) {
    ai().assertEnabled();
    const user = await users.ensureUser(discordId);
    if (user && Number(user.ai_enabled) === 0) {
        throw new TaskQuestError('AI_OPTED_OUT', 'AI features are turned off for your account. Turn them back on in the web app settings.', 403);
    }
}

/** The quest option is a list id (picked from autocomplete) or a typed name. */
async function resolveListId(discordId, value) {
    if (!value) throw new TaskQuestError('VALIDATION', 'Pick a quest with the `quest` option.', 400);
    const lists = await tasks.getLists(discordId);
    const name = value.trim().toLowerCase();
    // Autocomplete sends the id; a typed value is a name (which may itself be all digits, e.g. "2026").
    const match = lists.find((l) => l.name.toLowerCase() === name) || lists.find((l) => String(l.id) === value.trim());
    if (!match) throw new TaskQuestError('NOT_FOUND', `No quest named "${value}".`, 404);
    return match.id;
}

async function giveRewards(interaction, tools) {
    const { xp, achievements } = fmt.rewardsFrom(tools);
    for (const reward of xp) await sendRewards(interaction, { xp: reward });
    if (achievements.length) await sendRewards(interaction, { achievements });
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function summary(interaction) {
    await interaction.deferReply(EPHEMERAL);
    try {
        const discordId = interaction.user.id;
        await assertAllowed(discordId);
        const mode = interaction.options.getString('mode') || (interaction.options.getString('quest') ? 'list' : 'digest');
        const range = interaction.options.getString('range') || 'week';
        const body = { mode, range };
        if (mode === 'list') body.listId = await resolveListId(discordId, interaction.options.getString('quest'));
        const result = await ai().post('/v1/summary', discordId, body, { timeoutMs: SLOW_CALL_MS });
        return interaction.editReply({ embeds: [fmt.summaryEmbed(result, { mode, range })] });
    } catch (err) {
        return handleError(interaction, err);
    }
}

async function prioritize(interaction) {
    await interaction.deferReply(EPHEMERAL);
    try {
        const discordId = interaction.user.id;
        await assertAllowed(discordId);
        const limit = interaction.options.getInteger('limit') || 5;
        const result = await ai().post('/v1/prioritize', discordId, { limit }, { timeoutMs: SLOW_CALL_MS });
        return interaction.editReply({ embeds: [fmt.priorityEmbed(result)] });
    } catch (err) {
        return handleError(interaction, err);
    }
}

async function ask(interaction) {
    await interaction.deferReply(EPHEMERAL);
    try {
        const discordId = interaction.user.id;
        await assertAllowed(discordId);
        const question = interaction.options.getString('question', true);
        const turn = await ai().chat('/v1/chat', discordId, { message: question });
        await interaction.editReply({
            embeds: [fmt.answerEmbed(turn, question)],
            components: turn.confirms.length && turn.threadId ? [fmt.confirmRow(turn.threadId)] : []
        });
        return giveRewards(interaction, turn.tools);
    } catch (err) {
        return handleError(interaction, err);
    }
}

/** Approve / Cancel on an /ask answer that is waiting for confirmation. */
async function handleButton(interaction) {
    const parsed = fmt.parseConfirmId(interaction.customId);
    if (!parsed) return interaction.reply({ content: '❌ This button has expired.', ...EPHEMERAL });
    await interaction.deferUpdate();
    try {
        const discordId = interaction.user.id;
        await assertAllowed(discordId);
        // The AI service checks that this thread belongs to the clicking user.
        const turn = await ai().chat(`/v1/chat/${parsed.threadId}/resume`, discordId, { approved: parsed.approved });
        await interaction.editReply({
            embeds: [fmt.answerEmbed(turn)],
            components: turn.confirms.length && turn.threadId ? [fmt.confirmRow(turn.threadId)] : []
        });
        return giveRewards(interaction, turn.tools);
    } catch (err) {
        return handleError(interaction, err);
    }
}

/** Autocomplete for /summary quest: the user's quests, matched by name. */
async function forget(interaction) {
    await interaction.deferReply(EPHEMERAL);
    try {
        const discordId = interaction.user.id;
        await assertAllowed(discordId);
        const forgotten = await ai().forgetConversation(discordId, interaction.channelId);
        await interaction.editReply({
            embeds: [
                ui.success(
                    forgotten ? 'Forgotten' : 'Nothing to forget',
                    forgotten ? 'Our conversation in this channel is wiped. Fresh start.' : "We haven't talked in this channel yet."
                )
            ]
        });
    } catch (err) {
        await handleError(interaction, err);
    }
}

async function aiFormat(interaction) {
    try {
        const format = interaction.options.getString('format');
        await users.setAiChatFormat(interaction.user.id, format);
        await interaction.reply({
            embeds: [ui.success('Saved', format === 'embed' ? 'I will reply with embeds.' : 'I will reply with plain messages.')],
            ...EPHEMERAL
        });
    } catch (err) {
        await handleError(interaction, err);
    }
}

async function autocomplete(interaction) {
    try {
        const focused = interaction.options.getFocused(true);
        if (focused.name !== 'quest') return await interaction.respond([]);
        const q = String(focused.value || '').toLowerCase();
        const lists = await tasks.getLists(interaction.user.id, { sortBy: 'name', order: 'ASC' });
        return await interaction.respond(
            lists
                .filter((l) => l.name.toLowerCase().includes(q))
                .slice(0, 25)
                .map((l) => ({ name: l.name.slice(0, 100), value: String(l.id) }))
        );
    } catch (err) {
        // A failed lookup (or an expired interaction) must not become an unhandled rejection.
        console.warn('[ai] autocomplete failed:', err.code || err.message);
        return interaction.respond([]).catch(() => {});
    }
}

module.exports = {
    summaryData,
    prioritizeData,
    askData,
    forgetData,
    aiFormatData,
    summary,
    prioritize,
    ask,
    forget,
    aiFormat,
    handleButton,
    autocomplete,
    // exported for tests
    _setClient: (c) => {
        client = c;
    }
};
