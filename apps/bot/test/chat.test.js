/**
 * Conversation chat (@mention / reply / DM). The AI client and database are stubbed.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('@taskquest/shared/db');
const { TaskQuestError } = require('@taskquest/shared');
const chat = require('../chat');

const BOT = '999';
let user = { discord_id: '42', ai_enabled: 1 };
db.users.ensureUser = async () => user;

function stubAi(reply = 'Hi.', { enabled = true, fail } = {}) {
    const calls = [];
    return {
        calls,
        enabled,
        converse: async (id, body) => {
            calls.push({ id, ...body });
            if (fail) throw fail;
            return { reply: typeof reply === 'function' ? reply(body) : reply };
        }
    };
}

/** A minimal discord.js Message that records what the bot sends. */
function fakeMessage({ content = `<@${BOT}> hello`, guildId = '1', mention = true, repliedTo, bot = false, attachment } = {}) {
    const sent = [];
    const ids = new Set(mention ? [BOT] : []);
    return {
        sent,
        content,
        guildId,
        channelId: '900',
        system: false,
        author: { id: '42', bot },
        client: { user: { id: BOT } },
        mentions: { users: { has: (id) => ids.has(id) }, repliedUser: repliedTo ? { id: repliedTo } : null },
        attachments: { first: () => attachment },
        channel: {
            sendTyping: async () => sent.push({ typing: true }),
            send: async (m) => sent.push({ send: m })
        },
        reply: async (m) => sent.push({ reply: m })
    };
}

const replies = (m) => m.sent.filter((s) => s.reply || s.send).map((s) => (s.reply || s.send).content);

test.beforeEach(() => chat._reset());

test('replies on mention, on reply-to-bot and in DMs; ignores everything else', () => {
    assert.equal(chat.shouldReply(fakeMessage(), BOT), true);
    assert.equal(chat.shouldReply(fakeMessage({ mention: false, repliedTo: BOT }), BOT), true);
    assert.equal(chat.shouldReply(fakeMessage({ mention: false, guildId: null }), BOT), true);
    assert.equal(chat.shouldReply(fakeMessage({ mention: false }), BOT), false);
    assert.equal(chat.shouldReply(fakeMessage({ mention: false, repliedTo: '5' }), BOT), false);
    assert.equal(chat.shouldReply(fakeMessage({ bot: true }), BOT), false); // never answer bots (no loops)
});

test('stripMentions removes only the bot mention', () => {
    assert.equal(chat.stripMentions(`<@${BOT}>  hey <@!${BOT}> and <@7>`, BOT), 'hey and <@7>');
});

test('splitMessage keeps chunks under the limit and prefers paragraph breaks', () => {
    const text = `${'a'.repeat(1500)}\n\n${'b'.repeat(1500)}`;
    assert.deepEqual(chat.splitMessage(text), ['a'.repeat(1500), 'b'.repeat(1500)]);
    const long = 'word '.repeat(1000);
    const parts = chat.splitMessage(long);
    assert.ok(parts.every((p) => p.length <= 2000));
    assert.equal(parts.join(' ').replace(/\s+/g, ' ').trim(), long.trim());
});

test('a mention sends the cleaned text with the channel and replies without pings', async () => {
    const ai = stubAi('*smiles* Hey there.');
    chat._setClient(ai);
    const m = fakeMessage();
    await chat.handleMessage(m);
    assert.deepEqual(ai.calls, [{ id: '42', channelId: '900', message: 'hello', imageUrl: undefined }]);
    assert.ok(m.sent[0].typing);
    assert.deepEqual(m.sent.at(-1).reply, { content: '*smiles* Hey there.', allowedMentions: { parse: [], repliedUser: false } });
});

test('images are passed by URL; empty mentions get a nudge', async () => {
    const ai = stubAi();
    chat._setClient(ai);
    const img = { url: 'https://cdn.discordapp.com/a/b/cat.png', contentType: 'image/png', name: 'cat.png', size: 10 };
    await chat.handleMessage(fakeMessage({ content: `<@${BOT}>`, attachment: img }));
    assert.equal(ai.calls[0].imageUrl, img.url);

    chat._reset();
    const empty = fakeMessage({ content: `<@${BOT}>` });
    await chat.handleMessage(empty);
    assert.equal(ai.calls.length, 1);
    assert.match(replies(empty)[0], /Say something/);
});

test('long replies are split, very long ones become a file', async () => {
    chat._setClient(stubAi(`${'x'.repeat(1900)}\n\n${'y'.repeat(1900)}`));
    const m = fakeMessage();
    await chat.handleMessage(m);
    assert.equal(replies(m).length, 2);

    chat._reset();
    chat._setClient(stubAi('z'.repeat(7000)));
    const f = fakeMessage();
    await chat.handleMessage(f);
    const last = f.sent.at(-1).reply;
    assert.equal(last.files.length, 1);
});

test('cooldown, disabled AI, opt-out and service errors', async () => {
    const ai = stubAi();
    chat._setClient(ai);
    let t = 1000;
    await chat.handleMessage(fakeMessage(), { now: () => t });
    t += 1000;
    await chat.handleMessage(fakeMessage(), { now: () => t }); // within 3 s: ignored
    assert.equal(ai.calls.length, 1);

    chat._reset();
    const off = stubAi('x', { enabled: false });
    chat._setClient(off);
    const silent = fakeMessage();
    await chat.handleMessage(silent);
    assert.equal(off.calls.length, 0);
    assert.equal(silent.sent.length, 0);

    chat._reset();
    chat._setClient(ai);
    user = { discord_id: '42', ai_enabled: 0 };
    try {
        const m = fakeMessage();
        await chat.handleMessage(m);
        assert.match(replies(m)[0], /turned AI features off/);
        assert.equal(ai.calls.length, 1);
    } finally {
        user = { discord_id: '42', ai_enabled: 1 };
    }

    chat._reset();
    chat._setClient(stubAi('x', { fail: new TaskQuestError('AI_QUOTA', 'quota', 429) }));
    const q = fakeMessage();
    await chat.handleMessage(q, { log: () => {} });
    assert.match(replies(q)[0], /out of energy/);
});

test('users who picked /ai-format embed get embeds', async () => {
    chat._setClient(stubAi('*nods* Embedded.'));
    user = { discord_id: '42', ai_enabled: 1, ai_chat_format: 'embed' };
    try {
        const m = fakeMessage();
        m.author.username = 'mist';
        await chat.handleMessage(m);
        const { embeds } = m.sent.at(-1).reply;
        assert.equal(embeds.length, 1);
        assert.equal(embeds[0].data.description, '*nods* Embedded.');
        assert.match(embeds[0].data.footer.text, /mist/);
    } finally {
        user = { discord_id: '42', ai_enabled: 1 };
    }
});
