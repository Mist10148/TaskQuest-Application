'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeDiscord } = require('../src');

const ZWSP = '\u200b';

test('escapeDiscord escapes every markdown character', () => {
    for (const ch of ['*', '_', '~', '`', '>', '|', '[', ']', '(', ')', '#', '\\', '<']) {
        assert.equal(escapeDiscord(`a${ch}b`), `a\\${ch}b`, ch);
    }
    assert.equal(escapeDiscord('**bold** __under__ ~~strike~~ `code` > quote || spoiler ||'), '\\*\\*bold\\*\\* \\_\\_under\\_\\_ \\~\\~strike\\~\\~ \\`code\\` \\> quote \\|\\| spoiler \\|\\|');
    assert.equal(escapeDiscord('\\*'), '\\\\\\*', 'a backslash is escaped first, so it cannot cancel the next escape');
});

test('escapeDiscord turns a masked link into plain text', () => {
    const out = escapeDiscord('[Claim your prize](https://evil.example/login)');
    assert.equal(out.includes('](' ), false);
    assert.equal(out.startsWith('\\['), true);
    assert.equal(out.includes('https://'), false);
    assert.equal(out.includes('evil.example'), false);
});

test('escapeDiscord neutralises mentions', () => {
    for (const mention of ['@everyone', '@here', '<@123456789012345678>', '<@!123456789012345678>', '<@&123456789012345678>', '<#123456789012345678>']) {
        const out = escapeDiscord(`hi ${mention}`);
        assert.equal(/@(everyone|here)/.test(out), false, mention);
        assert.equal(/<@[!&]?\d/.test(out), false, mention);
        assert.equal(/<#\d/.test(out), false, mention);
        assert.equal(out.replaceAll(ZWSP, '').replaceAll('\\', '').includes(mention.replace(/^</, '').replace(/>$/, '')), true, `${mention} is still readable`);
    }
});

test('escapeDiscord stops bare links from autolinking', () => {
    for (const link of ['https://evil.example/path?x=1', 'http://evil.example', 'www.evil.example', 'discord.gg/invite', 'evil.example']) {
        const out = escapeDiscord(`go to ${link} now`);
        assert.equal(/https?:\/\//.test(out), false, link);
        assert.equal(/[A-Za-z0-9]\.[A-Za-z0-9]/.test(out), false, `${link} has no contiguous domain`);
        assert.equal(out.replaceAll(ZWSP, '').replaceAll('\\', ''), `go to ${link} now`, 'the text itself is unchanged for the reader');
    }
});

test('escapeDiscord flattens control characters, hides invisible ones and can shorten', () => {
    assert.equal(escapeDiscord('line one\nline two\r\n\tthree'), 'line one line two three');
    assert.equal(escapeDiscord(`a${ZWSP}b\u202ec`), 'abc', 'zero-width and bidi overrides are removed');
    assert.equal(escapeDiscord('  padded  '), 'padded');
    assert.equal(escapeDiscord('x'.repeat(50), { max: 10 }), `${'x'.repeat(9)}…`);
    assert.equal(escapeDiscord('abc', { max: 10 }), 'abc');
    assert.equal(escapeDiscord(null), '');
    assert.equal(escapeDiscord(undefined), '');
    assert.equal(escapeDiscord(42), '42');
    assert.equal(escapeDiscord('plain name 123'), 'plain name 123', 'ordinary text is untouched');
    assert.equal(escapeDiscord('Bob Smith'), 'Bob Smith');
});
