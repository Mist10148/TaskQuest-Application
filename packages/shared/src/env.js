/**
 * Environment loading for every TaskQuest process.
 *
 * Variables are read in this order (first one wins, real environment
 * variables always win over files):
 *   1. the process environment (e.g. Render / CI settings)
 *   2. <app>/.env            optional per-app overrides
 *   3. <repo root>/.env      the single shared file for local development
 */

'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** @param {string} [appDir] directory of the app being started */
function loadEnv(appDir) {
    const files = [];
    if (appDir) files.push(path.join(appDir, '.env'));
    files.push(path.join(REPO_ROOT, '.env'));
    const loaded = [];
    for (const file of [...new Set(files)]) {
        if (fs.existsSync(file)) {
            dotenv.config({ path: file, quiet: true });
            loaded.push(file);
        }
    }
    return loaded;
}

module.exports = { loadEnv, REPO_ROOT };
