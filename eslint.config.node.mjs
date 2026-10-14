// Lint for the Node packages (bot, server, shared). The web app has its own config in apps/web.
// eslint and @eslint/js are provided by the web workspace's devDependencies (hoisted by npm workspaces).
import js from '@eslint/js';

const nodeGlobals = Object.fromEntries(
    ['process', 'console', 'Buffer', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'URL', 'URLSearchParams', 'AbortSignal', 'AbortController', 'fetch', 'TextEncoder', 'TextDecoder', 'structuredClone', 'queueMicrotask', 'Headers', 'Response', 'Request', 'FormData', 'Blob', '__dirname', '__filename', 'require', 'module', 'exports'].map((n) => [n, 'readonly'])
);

export default [
    { ignores: ['**/node_modules/**', 'apps/web/**', 'apps/ai/**', 'db/**', 'docs/**'] },
    js.configs.recommended,
    {
        files: ['apps/bot/**/*.js', 'apps/server/**/*.js', 'packages/shared/**/*.js', 'scripts/**/*.js'],
        languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: nodeGlobals },
        rules: { 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }] }
    },
    {
        files: ['apps/server/**/*.js'],
        languageOptions: { sourceType: 'module' }
    }
];
