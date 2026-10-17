import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from './helpers';

/**
 * Not a test: it takes the README screenshots from the seeded e2e app, signed in as the seeded player. It is skipped in every
 * normal run and only does anything with CAPTURE_SCREENSHOTS=1:
 *
 *   npm run build
 *   CAPTURE_SCREENSHOTS=1 npm run e2e -w @taskquest/web -- screenshots
 *
 * The images land in docs/images (see CONTRIBUTING, "README screenshots"). Animations are off so every frame is steady.
 */
const OUT = fileURLToPath(new URL('../../../docs/images/', import.meta.url));

const PAGES: Array<{ name: string; path: string }> = [
    { name: 'dashboard', path: '/dashboard' },
    { name: 'today', path: '/today' },
    { name: 'tasks', path: '/tasks' },
    { name: 'stats', path: '/stats' },
    { name: 'focus', path: '/focus' },
    { name: 'review', path: '/review' },
    { name: 'shop', path: '/shop' },
    { name: 'party', path: '/party' },
    { name: 'classes', path: '/classes' },
    { name: 'skills', path: '/skills' },
    { name: 'leaderboard', path: '/leaderboard' },
    { name: 'games', path: '/games' },
];

test.describe('README screenshots', () => {
    test.skip(!process.env.CAPTURE_SCREENSHOTS, 'set CAPTURE_SCREENSHOTS=1 to capture the README screenshots');
    test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });

    test.beforeEach(async ({ page }) => {
        mkdirSync(OUT, { recursive: true });
        await page.addInitScript(() => {
            try {
                window.localStorage.setItem('tq.prefs', JSON.stringify({ reduceMotion: true }));
            } catch {
                /* storage unavailable */
            }
        });
    });

    for (const shot of PAGES) {
        test(`captures ${shot.name}`, async ({ page }) => {
            await page.goto(shot.path);
            await page.getByRole('heading', { level: 1 }).first().waitFor();
            await page.waitForLoadState('networkidle');
            await page.screenshot({ path: `${OUT}${shot.name}.png`, animations: 'disabled' });
        });
    }
});
