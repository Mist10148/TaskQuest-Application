/**
 * Interaction response helpers shared by every command module.
 */

const { MessageFlags } = require('discord.js');
const { TaskQuestError } = require('@taskquest/shared');
const ui = require('./ui');

const EPHEMERAL = { flags: MessageFlags.Ephemeral };

/** Reply / follow up / edit — whichever is valid for the interaction's state. */
async function send(interaction, payload) {
    if (interaction.deferred && !interaction.replied) return interaction.editReply(payload);
    if (interaction.replied || interaction.deferred) return interaction.followUp({ ...payload, ...EPHEMERAL });
    return interaction.reply({ ...payload, ...EPHEMERAL });
}

/**
 * Show a friendly message for expected errors (TaskQuestError) and a generic
 * one for bugs, which are logged with their stack.
 */
async function handleError(interaction, err) {
    let embed;
    if (err instanceof TaskQuestError) {
        embed = ui.error(errorTitle(err.code), err.message);
    } else {
        console.error(`[${interaction.customId || interaction.commandName}]`, err);
        embed = ui.error('Something went wrong', 'Please try again in a moment.');
    }
    try {
        if (interaction.deferred && !interaction.replied) await interaction.editReply({ embeds: [embed], components: [] });
        else if (interaction.replied) await interaction.followUp({ embeds: [embed], ...EPHEMERAL });
        else await interaction.reply({ embeds: [embed], ...EPHEMERAL });
    } catch {
        /* interaction expired */
    }
}

function errorTitle(code) {
    return (
        {
            VALIDATION: 'Invalid input',
            NOT_FOUND: 'Not found',
            CONFLICT: 'Already done',
            INSUFFICIENT_XP: 'Not enough XP',
            FORBIDDEN: 'Locked',
            GAMIFICATION_DISABLED: 'XP is off',
            COOLDOWN: 'Slow down',
            AI_QUOTA: 'Out of AI energy',
            AI_DISABLED: 'AI is off',
            AI_OPTED_OUT: 'AI is off for you',
            AI_UNAVAILABLE: 'AI unavailable'
        }[code] || 'Error'
    );
}

/** Ephemeral follow-ups for an XP reward and newly unlocked achievements. */
async function sendRewards(interaction, { xp, achievements } = {}) {
    if (xp && xp.finalXP > 0) {
        await interaction.followUp({ embeds: [ui.xpEmbed(xp.finalXP, xp.bonusInfo, xp.leveledUp, xp.level)], ...EPHEMERAL });
    }
    for (const a of achievements || []) {
        await interaction.followUp({ embeds: [ui.achievementUnlockEmbed(a)], ...EPHEMERAL });
    }
}

/** Parse the numeric suffix of a custom ID such as "edit_42". */
function idFrom(customId, prefix) {
    const n = Number(customId.slice(prefix.length));
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

module.exports = { EPHEMERAL, send, handleError, sendRewards, idFrom };
