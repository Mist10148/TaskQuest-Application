/**
 * Conversation chat: the bot answers when it is @mentioned, when someone replies
 * to one of its messages, and in DMs (like the Zephyr bot's AI chat).
 *
 * Replies come from the AI service's /v1/converse (persona, per-user memory per
 * channel, read-only access to the user's quests). Nothing here writes data:
 * changes go through /ask, which asks for confirmation.
 *
 * Discord only sends message text to bots without the privileged Message Content
 * intent when the message mentions the bot or is a DM. Replies to the bot that
 * turn the mention ping off arrive empty unless AI_CHAT_MESSAGE_CONTENT=true and
 * the intent is enabled in the Developer Portal.
 */

'use strict';

const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { createAiClient } = require('@taskquest/shared/ai');
const { users } = require('@taskquest/shared/db');

const MAX_MESSAGE = 2000;
const MAX_EMBED = 4000;
const EMBED_COLOR = 0x9b59b6;
const FILE_THRESHOLD = 3 * MAX_MESSAGE; // longer replies go out as a .txt file
const MAX_INPUT = 4000;
const MAX_TEXT_ATTACHMENT = 100 * 1024;
const COOLDOWN_MS = 3000;
const TYPING_EVERY_MS = 8000;

let client;
const ai = () => (client ||= createAiClient());
const lastSeen = new Map(); // userId -> timestamp, for the per-user cooldown

// Never let a model reply ping @everyone, roles or users.
const NO_PINGS = { parse: [], repliedUser: false };

// ─── pure helpers (unit-tested) ──────────────────────────────────────────────

/** Should the bot answer this message? */
function shouldReply(message, botId) {
    if (!message || message.author?.bot || message.system) return false;
    if (!message.guildId) return true; // DM
    if (message.mentions?.users?.has?.(botId)) return true;
    return message.mentions?.repliedUser?.id === botId;
}

/** Remove the bot's own mention tags and tidy whitespace. */
function stripMentions(content, botId) {
    return String(content || '')
        .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Split text into Discord-sized messages, preferring paragraph, then line, then
 * word boundaries, and never breaking inside a code block fence pair badly.
 */
function splitMessage(text, max = MAX_MESSAGE) {
    const chunks = [];
    let rest = String(text);
    while (rest.length > max) {
        const window = rest.slice(0, max);
        let cut = window.lastIndexOf('\n\n');
        if (cut < max / 2) cut = window.lastIndexOf('\n');
        if (cut < max / 2) cut = window.lastIndexOf(' ');
        if (cut <= 0) cut = max;
        chunks.push(rest.slice(0, cut).trimEnd());
        rest = rest.slice(cut).trimStart();
    }
    if (rest) chunks.push(rest);
    return chunks;
}

/** The first attachment as { imageUrl } or { textUrl }, or null. */
function pickAttachment(message) {
    const first = message.attachments?.first?.();
    if (!first) return null;
    const type = String(first.contentType || '');
    if (type.startsWith('image/')) return { imageUrl: first.url };
    if ((type.startsWith('text/plain') || /\.txt$/i.test(first.name || '')) && first.size <= MAX_TEXT_ATTACHMENT) {
        return { textUrl: first.url };
    }
    return null;
}

function errorReply(err) {
    switch (err?.code) {
        case 'AI_QUOTA':
            return "I'm out of energy for today. *yawns* Talk to me again after midnight UTC.";
        case 'AI_OPTED_OUT':
            return 'You turned AI features off for your account, so I have to stay quiet. You can turn them back on in the web app settings.';
        case 'VALIDATION':
            return err.message || "I couldn't read that.";
        default:
            return "My head's a bit foggy right now. Try me again in a moment.";
    }
}

// ─── handler ─────────────────────────────────────────────────────────────────

async function readTextAttachment(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return '';
    return (await response.text()).slice(0, MAX_INPUT);
}

/** Reply as embeds (the /ai-format "embed" style), 4000 characters each. */
async function sendEmbeds(message, text) {
    const parts = splitMessage(text, MAX_EMBED);
    const embeds = parts.map((part, i) => {
        const embed = new EmbedBuilder().setColor(EMBED_COLOR).setDescription(part);
        if (i === parts.length - 1) {
            embed.setFooter({ text: `Requested by ${message.author.username || 'you'}`, iconURL: message.author.displayAvatarURL?.() });
        }
        return embed;
    });
    await message.reply({ embeds: embeds.slice(0, 10), allowedMentions: NO_PINGS });
}

async function sendReply(message, text, format = 'text') {
    if (format === 'embed' && text.length <= 10 * MAX_EMBED) return sendEmbeds(message, text);
    if (text.length > FILE_THRESHOLD) {
        const file = new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: 'response.txt' });
        return message.reply({ content: 'That got long, so here it is as a file.', files: [file], allowedMentions: NO_PINGS });
    }
    const [first, ...more] = splitMessage(text);
    await message.reply({ content: first, allowedMentions: NO_PINGS });
    for (const part of more) await message.channel.send({ content: part, allowedMentions: NO_PINGS });
}

/** Handle one MessageCreate event. Never throws. */
async function handleMessage(message, { log = console.warn, now = Date.now } = {}) {
    try {
        const botId = message.client?.user?.id;
        if (!botId || !shouldReply(message, botId)) return;
        if (!ai().enabled) return; // AI is off on this deployment: stay silent

        const userId = message.author.id;
        if (lastSeen.has(userId) && now() - lastSeen.get(userId) < COOLDOWN_MS) return;
        lastSeen.set(userId, now());

        const user = await users.ensureUser(userId);
        if (user && Number(user.ai_enabled) === 0) {
            return message.reply({ content: errorReply({ code: 'AI_OPTED_OUT' }), allowedMentions: NO_PINGS });
        }

        let text = stripMentions(message.content, botId);
        const attachment = pickAttachment(message);
        if (attachment?.textUrl) text = (await readTextAttachment(attachment.textUrl)) || text;
        if (!text && !attachment?.imageUrl) {
            return message.reply({ content: 'Say something when you mention me.', allowedMentions: NO_PINGS });
        }

        await message.channel.sendTyping().catch(() => {});
        const typing = setInterval(() => message.channel.sendTyping().catch(() => {}), TYPING_EVERY_MS);
        let result;
        try {
            result = await ai().converse(userId, {
                channelId: message.channelId,
                message: (text || '(no text, just the attached image)').slice(0, MAX_INPUT),
                imageUrl: attachment?.imageUrl
            });
        } finally {
            clearInterval(typing);
        }
        await sendReply(message, result.reply || '...', user?.ai_chat_format);
    } catch (err) {
        log('[ai-chat]', err.code || err.message);
        try {
            await message.reply({ content: errorReply(err), allowedMentions: NO_PINGS });
        } catch {
            /* channel gone or no permission to send */
        }
    }
}

module.exports = {
    handleMessage,
    shouldReply,
    stripMentions,
    splitMessage,
    pickAttachment,
    errorReply,
    // exported for tests
    _setClient: (c) => {
        client = c;
    },
    _reset: () => lastSeen.clear()
};
