/**
 * Docs consistency: every relative link in the Markdown docs points at a file that exists, and every `#anchor` at a heading
 * of that file (GitHub's slug rules). A failure names the document, the link and what is missing.
 * Links inside code blocks and inline code are ignored, and so are web links. No database is needed.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const DIRS = ['.', 'docs', 'docs/design', 'db/legacy', 'apps/ai', 'apps/bot', 'apps/server', 'apps/web', 'packages/shared'];
const DOCS = DIRS.flatMap((dir) =>
    fs
        .readdirSync(path.join(ROOT, dir))
        .filter((f) => f.endsWith('.md'))
        .map((f) => path.join(dir, f))
);

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const withoutFences = (text) => text.replace(/^```[\s\S]*?^```/gm, '');
/** The text without fenced code blocks and inline code, where a "link" is only an example. */
const prose = (text) => withoutFences(text).replace(/`[^`\n]*`/g, '');

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens, repeats numbered -1, -2 ... */
function anchorsOf(text) {
    const seen = new Map();
    const out = new Set();
    for (const line of withoutFences(text).split('\n')) {
        const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
        if (!m) continue;
        const title = m[1].replace(/`/g, '').replace(/<[^>]+>/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
        const base = title.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
        const n = seen.get(base) || 0;
        seen.set(base, n + 1);
        out.add(n ? `${base}-${n}` : base);
    }
    // Explicit <a id="..."> / <a name="..."> targets count too.
    for (const m of text.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) out.add(m[1]);
    return out;
}

const anchorCache = new Map();
const anchorsFor = (file) => {
    if (!anchorCache.has(file)) anchorCache.set(file, anchorsOf(read(file)));
    return anchorCache.get(file);
};

/** Every [text](target) in the prose, as { target, line }. */
function linksIn(text) {
    const out = [];
    prose(text)
        .split('\n')
        .forEach((line, i) => {
            for (const m of line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) out.push({ target: m[1], line: i + 1 });
        });
    return out;
}

test('the docs list is not empty', () => {
    assert.ok(DOCS.length > 20, `found only ${DOCS.length} Markdown files`);
});

for (const doc of DOCS) {
    test(`${doc}: relative links and anchors resolve`, () => {
        const problems = [];
        for (const { target } of linksIn(read(doc))) {
            if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // https:, mailto: ...
            const [rawFile, anchor] = target.split('#');
            const file = rawFile ? path.normalize(path.join(path.dirname(doc), decodeURIComponent(rawFile))) : doc;
            if (!fs.existsSync(path.join(ROOT, file))) {
                problems.push(`${target}: no file ${file}`);
                continue;
            }
            if (anchor && file.endsWith('.md') && !anchorsFor(file).has(decodeURIComponent(anchor).toLowerCase())) problems.push(`${target}: no heading #${anchor} in ${file}`);
        }
        assert.deepEqual(problems, []);
    });
}
