/**
 * /today - the web app's Today page on Discord: what is overdue or due today (plus HIGH priority tasks), what is coming up
 * this week, the streak and the weekly goal. Same numbers as the web page (db.today.getToday). Ephemeral.
 */

'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { today: todayDb } = require('@taskquest/shared/db');
const { escapeDiscord } = require('@taskquest/shared');
const { EPHEMERAL, handleError } = require('../utils/respond');

const data = new SlashCommandBuilder().setName('today').setDescription('📅 What is due today, your streak and your weekly goal');

const PRIORITY_DOT = { HIGH: '🔴', MEDIUM: '🟡', LOW: '🔵' };

/** One task line: priority, name, quest and how late or soon it is. */
function taskLine(t, day) {
    const due = !t.dueDate ? '' : t.overdueDays > 0 ? ` · **${t.overdueDays} ${t.overdueDays === 1 ? 'day' : 'days'} late**` : t.dueDate === day ? ' · due today' : ` · due ${t.dueDate}`;
    return `${PRIORITY_DOT[t.priority] || '▫️'} ${escapeDiscord(t.name, { max: 80 })} · *${escapeDiscord(t.listName, { max: 40 })}*${due}`;
}

/** @param {object} d the result of db.today.getToday */
function render(d) {
    const { counts, streak, goal } = d;
    const summary = `**${counts.dueToday}** due today · **${counts.overdue}** overdue · **${counts.doneToday}** done today`;
    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('📅 Today').setDescription(summary);

    const shown = d.tasks.length;
    const total = counts.dueToday + counts.overdue;
    // The list stops at a few tasks (HIGH priority ones without a date included), so say how many are due in all.
    const more = total > shown ? `\n-# ${total} tasks are due or overdue in all: see them on the web Today page or with /list.` : '';
    embed.addFields({ name: 'To do', value: shown ? `${d.tasks.map((t) => taskLine(t, d.day)).join('\n')}${more}`.slice(0, 1024) : 'Nothing due. Enjoy the day, or add something with /quick.' });
    if (d.upcoming?.length) embed.addFields({ name: 'Coming up this week', value: d.upcoming.map((t) => taskLine(t, d.day)).join('\n').slice(0, 1024) });

    if (d.xpEnabled) {
        const streakText = streak.live > 0
            ? `🔥 ${streak.live} ${streak.live === 1 ? 'day' : 'days'}${streak.claimedToday ? ' · claimed today' : streak.atRisk ? ' · **claim /daily today to keep it**' : ''}`
            : 'No streak yet. Claim /daily to start one.';
        embed.addFields({ name: 'Streak', value: streakText, inline: true });
        const goalText = !goal.target
            ? `Not set. Set one on the web Today page (${goal.min} to ${goal.max} tasks).`
            : goal.claimed
              ? `✅ ${goal.progress}/${goal.target} · claimed`
              : `${goal.progress}/${goal.target} tasks${goal.claimable ? ' · 🎁 ready to claim on the web' : ''}`;
        embed.addFields({ name: 'Weekly goal', value: goalText, inline: true });
    }
    embed.setFooter({ text: `Your day: ${d.day} (see /timezone)` });
    return { embeds: [embed] };
}

async function execute(interaction) {
    await interaction.deferReply(EPHEMERAL);
    try {
        await interaction.editReply(render(await todayDb.getToday(interaction.user.id)));
    } catch (err) {
        await handleError(interaction, err);
    }
}

module.exports = { data, execute, render };
