/**
 * /summary, /prioritize and /ask. The AI client and the database helpers are
 * stubbed, so these run without the AI service or MySQL.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('@taskquest/shared/db');
const { TaskQuestError } = require('@taskquest/shared');
const fmt = require('../utils/aiFormat');
const aiCommands = require('../commands/ai');

const THREAD = '123e4567-e89b-42d3-a456-426614174000';

// ─── stubs ───────────────────────────────────────────────────────────────────

let user = { discord_id: '42', ai_enabled: 1 };
db.users.ensureUser = async () => user;
db.tasks.getLists = async () => [
    { id: 7, name: 'Math homework' },
    { id: 8, name: 'Clean garage' }
];

function stubClient(replies = {}) {
    const calls = [];
    const reply = (kind, path, body) => {
        calls.push({ kind, path, body });
        const r = replies[path];
        if (r instanceof Error) throw r;
        return typeof r === 'function' ? r(body) : r;
    };
    return {
        calls,
        enabled: true,
        assertEnabled() {
            if (replies.disabled) throw new TaskQuestError('AI_DISABLED', 'AI features are not enabled on this server.', 503);
        },
        post: async (path, id, body) => reply('post', path, body),
        chat: async (path, id, body) => reply('chat', path, body)
    };
}

/** A minimal ChatInputCommand / Button interaction that records what the bot sends. */
function fake({ options = {}, customId } = {}) {
    const sent = [];
    const i = {
        user: { id: '42' },
        customId,
        deferred: false,
        replied: false,
        sent,
        options: {
            getString: (name) => options[name] ?? null,
            getInteger: (name) => options[name] ?? null,
            getFocused: () => ({ name: 'quest', value: options.quest || '' })
        },
        async deferReply() {
            i.deferred = true;
            sent.push({ type: 'deferReply' });
        },
        async deferUpdate() {
            i.deferred = true;
            sent.push({ type: 'deferUpdate' });
        },
        async editReply(p) {
            sent.push({ type: 'editReply', ...serialize(p) });
        },
        async reply(p) {
            i.replied = true;
            sent.push({ type: 'reply', ...serialize(p) });
        },
        async followUp(p) {
            sent.push({ type: 'followUp', ...serialize(p) });
        },
        async respond(choices) {
            sent.push({ type: 'respond', choices });
        }
    };
    return i;
}

const serialize = (p) => ({
    ...p,
    embeds: (p.embeds || []).map((e) => (e.toJSON ? e.toJSON() : e)),
    components: (p.components || []).map((c) => (c.toJSON ? c.toJSON() : c))
});

const lastEdit = (i) => i.sent.filter((s) => s.type === 'editReply').at(-1);

// ─── command definitions ─────────────────────────────────────────────────────

test('command builders produce valid Discord payloads', () => {
    const [summary, prioritize, ask] = [aiCommands.summaryData, aiCommands.prioritizeData, aiCommands.askData].map((d) => d.toJSON());
    assert.deepEqual([summary.name, prioritize.name, ask.name], ['summary', 'prioritize', 'ask']);
    assert.deepEqual(summary.options.map((o) => o.name), ['mode', 'quest', 'range']);
    assert.equal(ask.options[0].required, true);
    assert.equal(ask.options[0].max_length, 2000);
});

// ─── formatting ──────────────────────────────────────────────────────────────

test('truncate keeps short text and marks cut text', () => {
    assert.equal(fmt.truncate('short', 10), 'short');
    assert.equal(fmt.truncate('x'.repeat(20), 10).length, 10);
    assert.ok(fmt.truncate('x'.repeat(20), 10).endsWith('…'));
});

test('summaryEmbed shows headline and only non-empty sections', () => {
    const e = fmt.summaryEmbed({ headline: 'Two quests need you', highlights: ['Math due tomorrow'], blockers: [], next_steps: ['Finish problems'] }, { mode: 'recap', range: 'day' }).toJSON();
    assert.equal(e.title, "📆 Today's recap");
    assert.match(e.description, /Two quests need you/);
    assert.deepEqual(e.fields.map((f) => f.name), ['✨ Highlights', '➡️ Next steps']);
    assert.match(e.footer.text, /AI-generated/);
});

test('priorityEmbed lists ranks, suggestions and the fallback note', () => {
    const e = fmt
        .priorityEmbed({
            ranked: [
                { rank: 1, name: 'Physics report', priority: 'HIGH', reason: 'Overdue by 2 day(s)' },
                { rank: 2, name: 'Math', priority: 'MEDIUM', reason: 'Due tomorrow', suggestedPriority: 'HIGH' }
            ],
            focusMessage: 'Start with the report.',
            usedFallback: true
        })
        .toJSON();
    assert.match(e.description, /^Start with the report\./);
    assert.match(e.description, /\*\*1\.\*\* 🔴 \*\*Physics report\*\*/);
    assert.match(e.description, /Consider raising it to \*\*HIGH\*\*/);
    assert.match(e.description, /AI ranking was unavailable/);
    assert.match(fmt.priorityEmbed({ ranked: [] }).toJSON().description, /No open quests/);
});

test('answerEmbed stays within Discord limits and shows sources and confirmations', () => {
    const e = fmt
        .answerEmbed(
            {
                text: 'y'.repeat(5000),
                sources: [{ id: 'L7', title: 'Math homework' }],
                tools: [],
                confirms: [{ preview: "Mark 'Problems 11-20' done?" }],
                error: null
            },
            'what is left?'
        )
        .toJSON();
    assert.ok(e.description.length <= 4096);
    assert.equal(e.fields[0].value, '`L7` Math homework');
    assert.match(e.author.name, /what is left\?/);
});

test('confirm buttons round-trip through parseConfirmId', () => {
    const row = fmt.confirmRow(THREAD).toJSON();
    const [ok, no] = row.components.map((c) => c.custom_id);
    assert.ok(ok.length <= 100);
    assert.deepEqual(fmt.parseConfirmId(ok), { approved: true, threadId: THREAD });
    assert.deepEqual(fmt.parseConfirmId(no), { approved: false, threadId: THREAD });
    assert.equal(fmt.parseConfirmId('ai_ok:not-a-uuid'), null);
    assert.equal(fmt.parseConfirmId('list_7'), null);
});

test('toolLines and rewardsFrom report write outcomes', () => {
    const tools = [
        { name: 'get_overdue', status: 'done' },
        { name: 'complete_item', status: 'done', xpResult: { finalXP: 25, newLevel: 3, leveledUp: false }, newAchievements: [{ name: 'First', description: 'd' }] },
        { name: 'add_item', status: 'declined' }
    ];
    assert.deepEqual(fmt.toolLines(tools), ['✅ Done! **+25 XP**', '🚫 Cancelled. Nothing was changed.']);
    const r = fmt.rewardsFrom(tools);
    assert.deepEqual(r.xp, [{ finalXP: 25, bonusInfo: undefined, leveledUp: false, level: 3 }]);
    assert.equal(r.achievements.length, 1);
});

// ─── handlers ────────────────────────────────────────────────────────────────

test('/summary defaults to the briefing and resolves a typed quest name', async () => {
    const client = stubClient({ '/v1/summary': { headline: 'All good', highlights: [], blockers: [], next_steps: [] } });
    aiCommands._setClient(client);

    const i = fake();
    await aiCommands.summary(i);
    assert.deepEqual(client.calls[0].body, { mode: 'digest', range: 'week' });
    assert.match(lastEdit(i).embeds[0].title, /briefing/);

    const j = fake({ options: { quest: 'math homework' } });
    await aiCommands.summary(j);
    assert.deepEqual(client.calls[1].body, { mode: 'list', range: 'week', listId: 7 });

    const k = fake({ options: { mode: 'list', quest: 'nope' } });
    await aiCommands.summary(k);
    assert.match(lastEdit(k).embeds[0].description, /No quest named "nope"/);
    assert.equal(client.calls.length, 2);
});

test('/summary autocomplete offers quest ids', async () => {
    const i = fake({ options: { quest: 'gar' } });
    await aiCommands.autocomplete(i);
    assert.deepEqual(i.sent[0].choices, [{ name: 'Clean garage', value: '8' }]);
});

test('opted-out users and disabled AI never reach the service', async () => {
    const client = stubClient({ '/v1/prioritize': { ranked: [] } });
    aiCommands._setClient(client);
    user = { discord_id: '42', ai_enabled: 0 };
    try {
        const i = fake();
        await aiCommands.prioritize(i);
        assert.match(lastEdit(i).embeds[0].description, /AI is off for you/);
    } finally {
        user = { discord_id: '42', ai_enabled: 1 };
    }
    aiCommands._setClient(stubClient({ disabled: true }));
    const j = fake();
    await aiCommands.ask(Object.assign(j, { options: { ...j.options, getString: () => 'hi' } }));
    assert.match(lastEdit(j).embeds[0].description, /AI is off/);
    assert.equal(client.calls.length, 0);
});

test('/prioritize passes the limit and shows quota errors', async () => {
    const client = stubClient({ '/v1/prioritize': { ranked: [{ rank: 1, name: 'Math', priority: 'HIGH', reason: 'Due tomorrow' }] } });
    aiCommands._setClient(client);
    const i = fake({ options: { limit: 3 } });
    await aiCommands.prioritize(i);
    assert.deepEqual(client.calls[0].body, { limit: 3 });
    assert.match(lastEdit(i).embeds[0].description, /Math/);

    aiCommands._setClient(stubClient({ '/v1/prioritize': new TaskQuestError('AI_QUOTA', 'Daily AI energy used up.', 429) }));
    const j = fake();
    await aiCommands.prioritize(j);
    assert.match(lastEdit(j).embeds[0].description, /Out of AI energy/);
});

test('/ask shows Approve/Cancel when a write needs confirmation, and resume applies it', async () => {
    const client = stubClient({
        '/v1/chat': {
            text: 'I can mark that done.',
            sources: [],
            tools: [],
            confirms: [{ id: 'c1', action: 'complete_item', preview: "Mark 'Problems 11-20' done?" }],
            error: null,
            threadId: THREAD
        },
        [`/v1/chat/${THREAD}/resume`]: (body) => ({
            text: body.approved ? 'Done!' : 'Okay, left it.',
            sources: [],
            tools: body.approved
                ? [{ name: 'complete_item', status: 'done', xpResult: { finalXP: 25, newLevel: 2, leveledUp: false } }]
                : [{ name: 'complete_item', status: 'declined' }],
            confirms: [],
            error: null,
            threadId: THREAD
        })
    });
    aiCommands._setClient(client);

    const i = fake({ options: { question: 'mark problems 11-20 done' } });
    await aiCommands.ask(i);
    assert.deepEqual(client.calls[0].body, { message: 'mark problems 11-20 done' });
    const ids = lastEdit(i).components[0].components.map((c) => c.custom_id);
    assert.deepEqual(ids, [`ai_ok:${THREAD}`, `ai_no:${THREAD}`]);

    const ok = fake({ customId: ids[0] });
    await aiCommands.handleButton(ok);
    assert.deepEqual(client.calls[1], { kind: 'chat', path: `/v1/chat/${THREAD}/resume`, body: { approved: true } });
    assert.match(lastEdit(ok).embeds[0].description, /\+25 XP/);
    assert.deepEqual(lastEdit(ok).components, []);
    assert.ok(ok.sent.some((s) => s.type === 'followUp' && /XP/.test(JSON.stringify(s.embeds))));

    const no = fake({ customId: ids[1] });
    await aiCommands.handleButton(no);
    assert.deepEqual(client.calls[2].body, { approved: false });
    assert.match(lastEdit(no).embeds[0].description, /Cancelled/);
});

test('an unknown ai_ button is reported as expired', async () => {
    const i = fake({ customId: 'ai_ok:garbage' });
    await aiCommands.handleButton(i);
    assert.match(i.sent[0].content, /expired/);
});
