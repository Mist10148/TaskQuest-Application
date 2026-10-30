/**
 * /focus start|finish|status - the web app's Focus timer on Discord. The server keeps the time (db.focus), so a session
 * started here can be finished on the web and the other way round, and the same rules pay: at least FOCUS_MIN_MINUTES must
 * pass, and the XP has a daily cap. Ephemeral.
 */

'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { focus } = require('@taskquest/shared/db');
const { LIMITS, REWARDS } = require('@taskquest/shared');
const ui = require('../utils/ui');
const { EPHEMERAL, handleError, sendRewards } = require('../utils/respond');

const DEFAULT_MINUTES = 25;

const data = new SlashCommandBuilder()
    .setName('focus')
    .setDescription('⏳ A focus timer that pays XP for the minutes you really work')
    .addSubcommand((s) =>
        s
            .setName('start')
            .setDescription('Start a focus session (ends any unfinished one)')
            .addIntegerOption((o) =>
                o.setName('minutes').setDescription(`How long (${LIMITS.FOCUS_MIN_MINUTES} to ${LIMITS.FOCUS_MAX_MINUTES}, default ${DEFAULT_MINUTES})`).setMinValue(LIMITS.FOCUS_MIN_MINUTES).setMaxValue(LIMITS.FOCUS_MAX_MINUTES)
            )
    )
    .addSubcommand((s) => s.setName('finish').setDescription('Finish your session and collect its XP'))
    .addSubcommand((s) => s.setName('status').setDescription("Your running session and today's focus XP"));

/** A Discord timestamp: shown in each reader's own time zone, and `R` counts down by itself. */
const stamp = (iso, style) => `<t:${Math.floor(Date.parse(iso) / 1000)}:${style}>`;

/** @param {object} s the result of db.focus.getFocusStatus */
function render(s, now = Date.now()) {
    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('⏳ Focus');
    if (s.active) {
        const payableAt = Date.parse(s.active.startedAt) + LIMITS.FOCUS_MIN_MINUTES * 60_000;
        const ends = Date.parse(s.active.endsAt);
        embed.setDescription(
            [
                `**${s.active.minutes} minute session** · ${now >= ends ? "time's up" : `ends ${stamp(s.active.endsAt, 'R')}`}`,
                now >= payableAt
                    ? 'Finish with `/focus finish` to collect your XP.'
                    : `Finishing pays from ${stamp(new Date(payableAt).toISOString(), 't')}; finishing sooner cancels the session.`
            ].join('\n')
        );
    } else {
        embed.setDescription(`No session running. Start one with \`/focus start\` (${LIMITS.FOCUS_MIN_MINUTES} to ${LIMITS.FOCUS_MAX_MINUTES} minutes).`);
    }
    embed.addFields(
        { name: 'Sessions today', value: `${s.today.sessions}/${LIMITS.FOCUS_SESSIONS_PER_DAY}`, inline: true },
        { name: 'Focus XP today', value: `${s.today.xp}/${LIMITS.FOCUS_XP_PER_DAY}`, inline: true }
    );
    embed.setFooter({ text: `${REWARDS.FOCUS_XP_PER_MINUTE} XP a minute · the timer cannot be paused` });
    return { embeds: [embed] };
}

/** What a finished session paid, in words. */
function finishedText(r) {
    if (r.state === 'cancelled') return ui.warn('Session cancelled', `It was shorter than ${LIMITS.FOCUS_MIN_MINUTES} minutes, so it earned no XP.`);
    if (r.state === 'expired') return ui.warn('Session expired', 'It was left running too long to count. Start a new one with `/focus start`.');
    const capped = r.capped ? `\n-# Today's focus XP limit (${LIMITS.FOCUS_XP_PER_DAY}) is reached.` : '';
    return ui.success('Session finished', `${r.minutesCredited} minutes focused · **+${r.xp} XP**. Balance: ${Number(r.balance).toLocaleString()} XP.${capped}`);
}

async function execute(interaction) {
    await interaction.deferReply(EPHEMERAL);
    const userId = interaction.user.id;
    try {
        const sub = interaction.options.getSubcommand();
        if (sub === 'start') {
            await focus.startFocus(userId, interaction.options.getInteger('minutes') ?? DEFAULT_MINUTES);
            return await interaction.editReply(render(await focus.getFocusStatus(userId)));
        }
        if (sub === 'finish') {
            const status = await focus.getFocusStatus(userId);
            if (!status.active) return await interaction.editReply(render(status));
            // The web asks before cancelling a session too short to pay; a slash command cannot, so it refuses instead.
            const payableAt = Date.parse(status.active.startedAt) + LIMITS.FOCUS_MIN_MINUTES * 60_000;
            if (Date.now() < payableAt) {
                return await interaction.editReply({
                    embeds: [ui.warn('Too early to finish', `Finishing pays from ${stamp(new Date(payableAt).toISOString(), 't')}. Finishing now would cancel the session with no XP, so keep going.`)]
                });
            }
            const r =await focus.finishFocus(userId, status.active.sessionId);
            await interaction.editReply({ embeds: [finishedText(r)] });
            return await sendRewards(interaction, { achievements: r.achievements });
        }
        return await interaction.editReply(render(await focus.getFocusStatus(userId)));
    } catch (err) {
        await handleError(interaction, err);
    }
}

module.exports = { data, execute, render, finishedText };
