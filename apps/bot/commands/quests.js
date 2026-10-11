/**
 * /quests - daily and weekly quests. Progress comes from what you already do
 * (completing and adding tasks, claiming /daily); finished quests are claimed
 * with a button. Everything is ephemeral because it shows XP.
 */

'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { quests } = require('@taskquest/shared/db');
const ui = require('../utils/ui');
const { EPHEMERAL, handleError, sendRewards } = require('../utils/respond');

const data = new SlashCommandBuilder().setName('quests').setDescription('📜 Daily and weekly quests with XP rewards');

const bar = (progress, target) => {
    const filled = Math.round((progress / target) * 8);
    return `${'▰'.repeat(filled)}${'▱'.repeat(8 - filled)}`;
};

function render(list) {
    const line = (q) => {
        const state = q.claimed ? '✅ claimed' : q.claimable ? '🎁 ready!' : `${q.progress}/${q.target}`;
        return `${q.emoji} **${q.name}** · +${q.reward} XP\n-# ${q.description}\n${bar(q.progress, q.target)} ${state}`;
    };
    const section = (period) => list.filter((q) => q.period === period).map(line).join('\n\n');
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📜 Quests')
        .addFields({ name: 'Today', value: section('daily') }, { name: 'This week', value: section('weekly') })
        .setFooter({ text: 'Daily quests reset at your midnight (see /timezone), weekly ones on Monday.' });

    const claimable = list.filter((q) => q.claimable).slice(0, 5);
    const components = claimable.length
        ? [
              new ActionRowBuilder().addComponents(
                  claimable.map((q) => new ButtonBuilder().setCustomId(`quest_claim_${q.key}`).setLabel(`Claim ${q.name}`).setEmoji('🎁').setStyle(ButtonStyle.Success))
              )
          ]
        : [];
    return { embeds: [embed], components };
}

async function execute(interaction) {
    await interaction.deferReply(EPHEMERAL);
    try {
        await interaction.editReply(render(await quests.getQuests(interaction.user.id)));
    } catch (err) {
        await handleError(interaction, err);
    }
}

/** quest_claim_<KEY> buttons. */
async function handleButton(interaction) {
    await interaction.deferUpdate();
    try {
        const key = interaction.customId.slice('quest_claim_'.length);
        const result = await quests.claimQuest(interaction.user.id, key);
        await interaction.editReply(render(await quests.getQuests(interaction.user.id)));
        await interaction.followUp({
            embeds: [ui.success(`${result.name} claimed`, `+${result.reward} XP. Balance: ${Number(result.balance).toLocaleString()} XP.`)],
            ...EPHEMERAL
        });
        await sendRewards(interaction, { achievements: result.achievements });
    } catch (err) {
        await handleError(interaction, err);
    }
}

module.exports = { data, execute, handleButton, render };
