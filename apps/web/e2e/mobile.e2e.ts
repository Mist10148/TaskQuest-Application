import { test, expect } from './helpers';

test('phone layout: the drawer opens and the dashboard does not scroll sideways', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: 'Open menu' }).click();
    const drawer = page.getByRole('dialog', { name: 'Menu' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name: 'Leaderboard' }).click();
    await expect(page).toHaveURL(/\/leaderboard$/);
    await expect(drawer).toBeHidden();
});
