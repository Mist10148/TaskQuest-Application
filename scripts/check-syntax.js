#!/usr/bin/env node
/** `node --check` every JavaScript file of the Node workspaces (bot, server, shared). */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const roots = ['apps/bot', 'apps/server', 'packages/shared'];
const files = [];
const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) files.push(full);
    }
};
roots.forEach((r) => walk(path.join(__dirname, '..', r)));

let failed = 0;
for (const f of files) {
    try {
        execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    } catch (err) {
        failed++;
        console.error(`✗ ${path.relative(process.cwd(), f)}\n${err.stderr}`);
    }
}
console.log(`${failed ? '✗' : '✓'} checked ${files.length} files, ${failed} failed`);
process.exit(failed ? 1 : 0);
