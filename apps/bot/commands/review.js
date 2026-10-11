/**
 * /review - the weekly review. Shows this week's finished tasks and XP (the same numbers as the
 * web app's review page) and, once at least one task is done, a button for the once-a-week bonus.
 * Ephemeral, because it shows XP.
 */

'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { review } = require('@taskquest/shared/db');
const { LIMITS } = require('@taskquest/shared');
const ui = require('../utils/ui');
const { EPHEMERAL, handleError, sendRewards } = require('../utils/respond');

const data = new SlashCommandBuilder().setName('review').setDescription('📝 Your weekly review and its XP bonus');

/** @param {object} r the result of db.review.getReview */
function render(r) {
    const min = LIMITS.WEEKLY_REVIEW_MIN_COMPLETED;
    const state = r.claimed
        ? "✅ You claimed this week's review."
        : r.claimable
          ? `🎁 Ready to claim: **+${r.reward} XP**`
          : r.completed < min
            ? `Finish at least ${min === 1 ? 'one task' : `${min} tasks`} this week to unlock **+${r.reward} XP**.`
            : 'XP is turned off, so there is nothing to claim. Use `/toggle` to turn it on.';
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📝 Weekly review')
        .setDescription(state)
        .addFields(
            { name: 'Tasks finished', value: String(r.completed), inline: true },
            { name: 'XP earned', value: `${Number(r.xpEarned).toLocaleString()} XP`, inline: true },
            { name: 'Streak', value: `🔥 ${r.streak}`, inline: true }
        )
        .setFooter({ text: 'The week resets on Monday at your midnight (see /timezone).' });
    const components = r.claimable
        ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('review_claim').setLabel('Claim review').setEmoji('🎁').setStyle(ButtonStyle.Success))]
        : [];
    return { embeds: [embed], components };
}

async function execute(interaction) {
    await interaction.deferReply(EPHEMERAL);
    try {
        await interaction.editReply(render(await review.getReview(interaction.user.id)));
    } catch (err) {
        await handleError(interaction, err);
    }
}

/** The review_claim button. */
async function handleButton(interaction) {
    await interaction.deferUpdate();
    try {
        const result = await review.claimReview(interaction.user.id);
        await interaction.editReply(render(await review.getReview(interaction.user.id)));
        await interaction.followUp({
            embeds: [ui.success('Review claimed', `+${result.xp} XP. Balance: ${Number(result.balance).toLocaleString()} XP.`)],
            ...EPHEMERAL
        });
        await sendRewards(interaction, { achievements: result.achievements });
    } catch (err) {
        await handleError(interaction, err);
    }
}

module.exports = { data, execute, handleButton, render };
