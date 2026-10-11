import { test, expect } from './helpers';

test('focus page starts a session, shows the countdown and can be given up', async ({ page }) => {
    await page.goto('/focus');
    await expect(page.getByRole('heading', { name: 'Focus', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: "Today's progress" })).toBeVisible();

    await page.getByRole('button', { name: '25 min' }).click();
    const timer = page.getByRole('timer', { name: 'Time left' });
    await expect(timer).toBeVisible();
    await expect(timer).toHaveText(/^2[45]:\d\d$/);
    // Finishing only pays after 10 minutes, so the button stays off right after the start.
    await expect(page.getByRole('button', { name: 'Finish session' })).toBeDisabled();
    await expect(page.getByText(/cannot be paused/).first()).toBeVisible();

    // The session lives on the server: a reload shows it again.
    await page.reload();
    await expect(page.getByRole('timer', { name: 'Time left' })).toBeVisible();

    // Clean up so later tests start from an idle page: giving up early cancels without XP.
    await page.getByRole('button', { name: 'Give up' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Give up' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Session cancelled' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Start a session' })).toBeVisible();
});

test('stats page renders the chart, the XP sources and the heatmap', async ({ page }) => {
    await page.goto('/stats');
    await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: /^XP per day from / })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Tasks completed per day, last 12 weeks' })).toBeVisible();
    await expect(page.getByTestId('streak-card')).toBeVisible();

    await page.getByRole('button', { name: '7 days' }).click();
    await expect(page.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
    // The same numbers are available as a table.
    await page.getByText('Show as a table').click();
    await expect(page.getByRole('table', { name: 'XP earned and tasks completed per day' }).getByRole('row')).toHaveCount(8);
});

test('weekly review page shows this week and the claim state', async ({ page }) => {
    await page.goto('/review');
    await expect(page.getByRole('heading', { name: 'Weekly review' })).toBeVisible();
    await expect(page.getByTestId('review-completed')).toBeVisible();
    await expect(page.getByText(/resets in/)).toBeVisible();
    // Either the bonus can still be claimed (button) or it was claimed already.
    await expect(page.getByRole('button', { name: 'Claim review bonus' }).or(page.getByRole('status').filter({ hasText: 'Claimed' }))).toBeVisible();
});
