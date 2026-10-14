'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadEnv, REPO_ROOT } = require('../src/env');

test('loadEnv reads the app .env, never overrides a real variable, and skips missing files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tq-env-'));
    try {
        fs.writeFileSync(path.join(dir, '.env'), 'TQ_ENV_TEST_FROM_FILE=file\nTQ_ENV_TEST_REAL=file\n');
        process.env.TQ_ENV_TEST_REAL = 'process';
        const loaded = loadEnv(dir);
        assert.ok(loaded.includes(path.join(dir, '.env')));
        assert.equal(process.env.TQ_ENV_TEST_FROM_FILE, 'file');
        assert.equal(process.env.TQ_ENV_TEST_REAL, 'process', 'the process environment wins');
        assert.deepEqual(loadEnv(path.join(dir, 'missing')).filter((f) => f.startsWith(dir)), []);
    } finally {
        delete process.env.TQ_ENV_TEST_FROM_FILE;
        delete process.env.TQ_ENV_TEST_REAL;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('the repo root is three levels above src', () => {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'package.json')));
});
