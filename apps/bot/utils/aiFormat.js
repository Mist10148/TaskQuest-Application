/**
 * Embeds and buttons for the AI commands (/summary, /prioritize, /ask).
 * Pure functions of the AI service's responses, so they are easy to test.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLORS, PRIORITY_DOT } = require('./ui');

const AI_COLOR = 0x9B59B6;
const FOOTER = { text: '✨ AI-generated, so double-check anything important' };
const DESCRIPTION_LIMIT = 4096;
const FIELD_LIMIT = 1024;

const CONFIRM_PREFIX = { ok: 'ai_ok:', no: 'ai_no:' };

/** Cut text to `max` characters, ending with an ellipsis when it was cut. */
function truncate(text, max) {
    const s = String(text ?? '');
    return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function bullets(lines, max = FIELD_LIMIT) {
    return truncate(lines.map((l) => `• ${l}`).join('\n'), max);
}

const SUMMARY_TITLES = {
    digest: "📋 Today's briefing",
    list: '📋 Quest summary',
    recap: { day: "📆 Today's recap", week: '📆 Weekly recap' }
};

function summaryTitle(mode, range) {
    const t = SUMMARY_TITLES[mode];
    return typeof t === 'object' ? t[range] || t.week : t || '📋 Summary';
}

/** Embed for a /v1/summary response. */
function summaryEmbed(summary, { mode = 'digest', range = 'week' } = {}) {
    const embed = new EmbedBuilder()
        .setColor(AI_COLOR)
        .setTitle(summaryTitle(mode, range))
        .setDescription(truncate(`**${summary.headline || 'Nothing to report.'}**`, DESCRIPTION_LIMIT))
        .setFooter(FOOTER);
    const fields = [
        ['✨ Highlights', summary.highlights],
        ['⚠️ Blockers', summary.blockers],
        ['➡️ Next steps', summary.next_steps]
    ]
        .filter(([, lines]) => Array.isArray(lines) && lines.length)
        .map(([name, lines]) => ({ name, value: bullets(lines) }));
    if (fields.length) embed.addFields(fields);
    return embed;
}

/** Embed for a /v1/prioritize response. */
function priorityEmbed(result) {
    const ranked = result.ranked || [];
    const embed = new EmbedBuilder().setColor(AI_COLOR).setTitle('🎯 What to do next').setFooter(FOOTER);
    if (!ranked.length) return embed.setDescription('No open quests. Enjoy the break, or start a new one with `/list`.');

    const lines = ranked.map((r) => {
        const dot = PRIORITY_DOT[r.priority] || PRIORITY_DOT.NONE;
        const suggestion = r.suggestedPriority ? `\n   💡 Consider raising it to **${r.suggestedPriority}**` : '';
        return `**${r.rank}.** ${dot} **${r.name}**\n   ${r.reason}${suggestion}`;
    });
    let description = result.focusMessage ? `${result.focusMessage}\n\n` : '';
    description += lines.join('\n');
    if (result.usedFallback) description += '\n\n-# Ranked by deadlines and priority (the AI ranking was unavailable).';
    return embed.setDescription(truncate(description, DESCRIPTION_LIMIT));
}

/** Readable outcome of the tools a chat turn ran (writes only; reads are noise in Discord). */
function toolLines(tools) {
    const out = [];
    for (const t of tools || []) {
        if (t.status === 'declined') out.push('🚫 Cancelled. Nothing was changed.');
        else if (t.status === 'error') out.push(`⚠️ \`${t.name}\` failed.`);
        else if (t.xpResult && t.xpResult.finalXP) out.push(`✅ Done! **+${t.xpResult.finalXP} XP**`);
    }
    return out;
}

/** Embed for a collected /v1/chat turn (see @taskquest/shared/ai collectChat). */
function answerEmbed(turn, question) {
    const parts = [];
    if (turn.text) parts.push(turn.text.trim());
    parts.push(...toolLines(turn.tools));
    if (turn.error) parts.push(`⚠️ ${turn.error}`);
    if (turn.confirms && turn.confirms.length) {
        parts.push(`**Confirm to continue:**\n${turn.confirms.map((c) => `• ${c.preview}`).join('\n')}`);
    }
    const embed = new EmbedBuilder()
        .setColor(turn.error ? COLORS.error : AI_COLOR)
        .setDescription(truncate(parts.join('\n\n') || 'I have no answer for that.', DESCRIPTION_LIMIT))
        .setFooter(FOOTER);
    if (question) embed.setAuthor({ name: truncate(`💬 ${question}`, 256) });
    if (turn.sources && turn.sources.length) {
        embed.addFields({ name: '📎 Sources', value: truncate(turn.sources.map((s) => `\`${s.id}\` ${s.title}`).join('\n'), FIELD_LIMIT) });
    }
    return embed;
}

/** Approve / Cancel buttons for a chat turn paused on a write action. */
function confirmRow(threadId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${CONFIRM_PREFIX.ok}${threadId}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${CONFIRM_PREFIX.no}${threadId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );
}

/** "ai_ok:<uuid>" → { approved: true, threadId }, or null for anything else. */
function parseConfirmId(customId) {
    for (const [key, prefix] of Object.entries(CONFIRM_PREFIX)) {
        if (customId.startsWith(prefix)) {
            const threadId = customId.slice(prefix.length);
            if (/^[0-9a-f-]{36}$/i.test(threadId)) return { approved: key === 'ok', threadId };
        }
    }
    return null;
}

/** Map a chat tool's xpResult to the shape respond.sendRewards expects. */
function rewardsFrom(tools) {
    const xp = [];
    const achievements = [];
    for (const t of tools || []) {
        if (t.xpResult && t.xpResult.finalXP) {
            xp.push({ finalXP: t.xpResult.finalXP, bonusInfo: t.xpResult.bonusInfo, leveledUp: t.xpResult.leveledUp, level: t.xpResult.newLevel });
        }
        achievements.push(...(t.newAchievements || []));
    }
    return { xp, achievements };
}

module.exports = {
    AI_COLOR,
    truncate,
    summaryEmbed,
    priorityEmbed,
    answerEmbed,
    toolLines,
    confirmRow,
    parseConfirmId,
    rewardsFrom,
    CONFIRM_PREFIX
};
