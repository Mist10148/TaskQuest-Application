import { test, expect } from './helpers';

test('the Shop lists titles, frames and accents with their prices', async ({ page }) => {
    await page.goto('/shop');
    await expect(page.getByRole('heading', { name: 'Shop', exact: true })).toBeVisible();
    await expect(page.getByText('Available XP:')).toBeVisible();

    const titles = page.getByRole('tab', { name: 'Titles' });
    await expect(titles).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'the Diligent' })).toBeVisible();
    // Every card ends in exactly one action: buy, a "need more XP" notice, locked, or equip.
    await expect(page.getByRole('button', { name: /^(Buy for|Need|Locked|Equip)/ }).first()).toBeVisible();

    await page.getByRole('tab', { name: 'Frames' }).click();
    await expect(page.getByRole('heading', { name: 'Bronze ring' })).toBeVisible();
    await page.getByRole('tab', { name: 'Accents' }).click();
    await expect(page.getByRole('heading', { name: 'Ocean' })).toBeVisible();

    // It is reachable from the sidebar.
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Shop' })).toHaveAttribute('aria-current', 'page');
});
