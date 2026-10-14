import { test, expect, unique } from './helpers';

test.describe('anonymous visitor', () => {
    test.use({ loggedIn: false });

    test('sees the login screen instead of the app', async ({ page }) => {
        await page.goto('/dashboard');
        await expect(page.getByRole('heading', { name: 'TaskQuest' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Login with Discord' })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
    });
});

test('seeded player lands on the dashboard with level and XP', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Level 4' })).toBeVisible();
    await expect(page.getByText(/350 Lifetime XP/)).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Level 4 progress' })).toBeVisible();
});

test('creates a quest, adds a task with quick add and completes it for XP', async ({ page }) => {
    const quest = unique('Quest');
    const task = unique('Task');

    await page.goto('/tasks');
    await page.getByRole('button', { name: 'Create Quest', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name *').fill(quest);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    await page.getByRole('button', { name: new RegExp(quest) }).click();
    await expect(page.getByRole('heading', { name: quest })).toBeVisible();

    await page.getByLabel('Quick add a task').fill(task);
    await page.getByLabel('Quick add a task').press('Enter');
    const done = page.getByRole('button', { name: `Mark "${task}" as done` });
    await expect(done).toBeVisible();

    const progress = page.locator('aside').getByRole('progressbar', { name: /^Level \d+ progress$/ });
    const before = await progress.getAttribute('aria-valuenow');

    await done.click();
    await expect(page.getByRole('button', { name: `Mark "${task}" as done` })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/\+\d+ XP!/).first()).toBeVisible();
    await expect(progress).not.toHaveAttribute('aria-valuenow', before ?? '');
});

test('deleting a task offers Undo, and Undo brings it back', async ({ page }) => {
    await page.goto('/tasks');
    await page.getByRole('button', { name: /Seed chores/ }).click();
    const row = page.getByRole('button', { name: 'Mark "Take out the bin" as done' });
    await expect(row).toBeVisible();

    await page.getByRole('button', { name: 'Delete "Take out the bin"' }).click();
    await expect(row).toBeHidden();
    const undo = page.getByRole('button', { name: 'Undo' });
    await expect(undo).toBeVisible();

    await undo.click();
    await expect(row).toBeVisible();
});

test('skills and classes pages render; the purchase dialog opens without buying', async ({ page }) => {
    await page.goto('/skills');
    await expect(page.getByRole('heading', { name: 'Skill Trees' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Class skill trees' })).toBeVisible();
    await expect(page.getByText('Available XP:')).toBeVisible();

    await page.goto('/classes');
    await expect(page.getByRole('heading', { name: 'Choose Your Path' })).toBeVisible();

    // Earlier tests may have earned a little XP, but the balance stays between 300 and 400:
    // at least one class is affordable and at least one is locked.
    const balance = page.getByText('Available XP:').locator('xpath=following-sibling::span');
    await expect(balance).not.toHaveText('0');
    const before = await balance.innerText();
    await expect(page.getByRole('button', { name: /^Need \d+ more XP$/ }).first()).toBeDisabled();

    await page.getByRole('button', { name: /^Purchase for \d+ XP$/ }).first().click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('heading', { name: /^Buy .+\?$/ })).toBeVisible();
    await expect(dialog.getByText(/Balance after/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    await expect(balance).toHaveText(before);
});

test('leaderboard shows its boards and arrow keys move between tabs', async ({ page }) => {
    await page.goto('/leaderboard');
    await expect(page.getByRole('heading', { name: 'Leaderboard' })).toBeVisible();
    const tabs = page.getByRole('tablist', { name: 'Leaderboard' }).getByRole('tab');
    await expect(tabs).toHaveCount(4);
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');

    await tabs.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'false');
});

test('settings theme switch toggles dark mode', async ({ page }) => {
    await page.goto('/settings');
    // The app switches themes with a class on <html> (next-themes, attribute="class").
    const theme = page.locator('main').getByRole('radiogroup', { name: 'Theme' });
    await theme.getByRole('radio', { name: 'Dark theme' }).click();
    await expect(theme.getByRole('radio', { name: 'Dark theme' })).toBeChecked();
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);

    await theme.getByRole('radio', { name: 'Light theme' }).click();
    await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/);
});

test('Ctrl+K opens the command palette and navigates', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
    await page.keyboard.press('Control+k');
    const search = page.getByRole('combobox', { name: 'Search commands' });
    await expect(search).toBeVisible();

    await search.fill('leaderboard');
    await expect(page.getByRole('option', { name: /Leaderboard/ })).toBeVisible();
    await search.press('Enter');
    await expect(page).toHaveURL(/\/leaderboard$/);
    await expect(page.getByRole('combobox', { name: 'Search commands' })).toBeHidden();
});
