import { defineConfig, devices } from '@playwright/test';
// @ts-expect-error plain ESM shared with the seed script and helpers
import { BASE_URL, SERVER_ENV } from './e2e/env.mjs';

/**
 * Browser smoke tests. They run against the real API serving the built SPA (apps/web/dist)
 * and a throwaway database seeded by e2e/seed.mjs:
 *
 *   npm run build && npm run e2e         (from the repo root: npm run test:e2e)
 */
export default defineConfig({
    testDir: './e2e',
    testMatch: '**/*.e2e.ts',
    fullyParallel: false,
    workers: 1,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
    use: {
        baseURL: BASE_URL,
        // The web saves the browser's zone for an account without one; UTC keeps "today" the same day in the tests and the seed.
        timezoneId: 'UTC',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: {
        command: 'node ../server/index.js',
        url: `${BASE_URL}/api/health`,
        env: SERVER_ENV,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
    },
    projects: [
        { name: 'desktop', testIgnore: '**/mobile.e2e.ts', use: { ...devices['Desktop Chrome'] } },
        { name: 'mobile', testMatch: '**/mobile.e2e.ts', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
    ],
});
