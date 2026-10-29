/**
 * docs/COMMANDS.md lists every slash command that deploy-commands.js registers, and nothing that is not registered.
 * The command set is read from deploy-commands.js itself (its `require`s and `commands` array), without calling Discord.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(BOT, 'deploy-commands.js'), 'utf8');
const doc = fs.readFileSync(path.join(BOT, '..', '..', 'docs', 'COMMANDS.md'), 'utf8');

/** The builders in deploy-commands.js's `commands` array, from the modules it requires. */
function registered() {
    const modules = {};
    for (const m of source.matchAll(/const (\w+) = require\('(\.\/commands\/[\w-]+)'\);/g)) modules[m[1]] = require(path.join(BOT, m[2]));
    const list = /const commands = \[([\s\S]*?)\]\.map/.exec(source);
    assert.ok(list, 'deploy-commands.js has a `commands` array');
    return [...list[1].matchAll(/(\w+)\.(\w+)/g)].map(([ref, mod, key]) => {
        assert.ok(modules[mod]?.[key], `${ref} is exported`);
        return modules[mod][key].toJSON();
    });
}

test('COMMANDS.md documents every registered slash command, and only those', () => {
    const slash = registered().filter((c) => (c.type ?? 1) === 1).map((c) => c.name);
    assert.ok(slash.length >= 25, `found ${slash.length} commands`);
    const documented = new Set([...doc.matchAll(/^\| `\/([\w-]+)/gm)].map((m) => m[1]));
    assert.deepEqual(slash.filter((n) => !documented.has(n)), [], 'registered but not in a COMMANDS.md table');
    assert.deepEqual([...documented].filter((n) => !slash.includes(n)), [], 'in a COMMANDS.md table but not registered');
});
