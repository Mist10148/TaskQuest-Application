/**
 * /prestige - start over for a permanent XP bonus and a title.
 *
 * Eligibility comes from the shared prestige service. Prestiging resets the balance, level, class
 * and skills, so it takes two deliberate clicks: "Prestige..." shows what is lost and kept, and only
 * "Yes, reset" runs it. Everything is ephemeral.
 */

'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { progression } = require('@taskquest/shared/db');
const ui = require('../utils/ui');
const { EPHEMERAL, handleError, sendRewards } = require('../utils/respond');

const data = new SlashCommandBuilder().setName('prestige').setDescription('✦ Start over for a permanent XP bonus and a title');

/** @param {object} p the result of db.progression.getPrestige */
function render(p) {
    const lines = [];
    if (p.prestige > 0) lines.push(`Current: **${p.title}** (prestige ${p.prestige}), **+${p.bonusPercent}%** XP.`);
    else lines.push('You have not prestiged yet.');
    if (p.nextTitle) lines.push(`Next: **${p.nextTitle}**, **+${p.nextBonusPercent}%** XP.`);
    else lines.push(`You reached the highest prestige (${p.max}).`);
    lines.push(`You can prestige from level ${p.minLevel}. You are level ${p.level}.`);
    const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('✦ Prestige').setDescription(lines.join('\n'));
    if (!p.eligible) {
        embed.setFooter({ text: p.nextTitle ? `Reach level ${p.minLevel} (and keep XP on) to prestige.` : 'Nothing more to do here.' });
        return { embeds: [embed], components: [] };
    }
    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('prestige_ask').setLabel('Prestige...').setEmoji('✦').setStyle(ButtonStyle.Primary))]
    };
}

/** The warning with the second, explicit confirmation step. */
function confirmation(p) {
    const embed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('⚠️ Reset your progress?')
        .setDescription(
            `You become **${p.nextTitle}** with a permanent **+${p.nextBonusPercent}%** XP bonus.\n\n` +
                '**You lose:** your XP balance, level, class and its skills, and your streak freezes.\n' +
                '**You keep:** tasks and lists, achievements, quest history, your daily streak and your lifetime XP total.\n\n' +
                'This cannot be undone.'
        );
    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('prestige_confirm').setLabel('Yes, reset').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('prestige_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
            )
        ]
    };
}

async function execute(interaction) {
    await interaction.deferReply(EPHEMERAL);
    try {
        await interaction.editReply(render(await progression.getPrestige(interaction.user.id)));
    } catch (err) {
        await handleError(interaction, err);
    }
}

/** prestige_ask, prestige_confirm and prestige_cancel. */
async function handleButton(interaction) {
    await interaction.deferUpdate();
    try {
        const userId = interaction.user.id;
        const p = await progression.getPrestige(userId);
        if (interaction.customId === 'prestige_cancel') return await interaction.editReply(render(p));
        if (interaction.customId === 'prestige_ask') {
            // Re-check: a stale message must not offer a reset the player no longer qualifies for.
            return await interaction.editReply(p.eligible ? confirmation(p) : render(p));
        }
        if (interaction.customId !== 'prestige_confirm') return;
        const result = await progression.prestige(userId);
        await interaction.editReply({
            embeds: [ui.success(`You are now ${result.title}`, `Prestige ${result.prestige}: **+${result.bonusPercent}%** XP from now on. You start again at level ${result.level}.`)],
            components: []
        });
        await sendRewards(interaction, { achievements: result.achievements });
    } catch (err) {
        await handleError(interaction, err);
    }
}

module.exports = { data, execute, handleButton, render, confirmation };
