import { test, expect, unique } from './helpers';

test('Today lists what is due, completes it, takes a reflection and a weekly goal', async ({ page }) => {
    const quest = unique('Today quest');
    const task = unique('Due today');

    // a quest with a task due today and one marked HIGH
    await page.goto('/tasks');
    await page.getByRole('button', { name: 'Create Quest', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name *').fill(quest);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(quest) }).click();
    await page.getByRole('button', { name: 'Add Task' }).first().click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Task name').fill(task).catch(async () => form.getByRole('textbox').first().fill(task));
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await form.getByLabel('Due date').fill(iso);
    await form.getByRole('button', { name: /^(Add|Create|Save)/ }).last().click();
    await expect(page.getByText(task).first()).toBeVisible();

    await page.goto('/today');
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await expect(page.getByTestId('count-due')).toContainText('due today');
    const line = page.getByRole('button', { name: `Mark "${task}" done` });
    await expect(line).toBeVisible();
    await line.click();
    await expect(page.getByRole('button', { name: `Mark "${task}" done` })).toBeHidden();

    // reflection: once a day
    const note = page.getByLabel(/One line about your day/);
    if (await note.isVisible().catch(() => false)) {
        await note.fill('A calm, focused day.');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.getByRole('status').filter({ hasText: 'A calm, focused day.' })).toBeVisible();
    }

    // weekly goal: set a target above this week's progress
    const target = page.getByLabel(/Tasks to finish this week/);
    if (await target.isVisible().catch(() => false)) {
        await target.fill('40');
        await page.getByRole('button', { name: 'Set goal' }).click();
        await expect(page.getByTestId('goal-progress')).toBeVisible();
        await expect(page.getByRole('progressbar', { name: 'Weekly goal progress' })).toBeVisible();
    }
});

test('a quest can be shown as a board and as a calendar', async ({ page }) => {
    const quest = unique('Views quest');
    await page.goto('/tasks');
    await page.getByRole('button', { name: 'Create Quest', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name *').fill(quest);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(quest) }).click();
    await page.getByLabel('Quick add a task').fill('A board task');
    await page.getByLabel('Quick add a task').press('Enter');
    await expect(page.getByRole('button', { name: 'Mark "A board task" as done' })).toBeVisible();

    const views = page.getByRole('group', { name: 'How to show the tasks' });
    await views.getByRole('button', { name: 'Board' }).click();
    await expect(page.getByTestId('task-board')).toBeVisible();
    await expect(page.getByRole('region', { name: 'No priority' }).getByText('A board task')).toBeVisible();

    await views.getByRole('button', { name: 'Calendar' }).click();
    await expect(page.getByTestId('task-calendar')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next month' })).toBeVisible();

    // the choice is remembered
    await page.reload();
    await page.getByRole('button', { name: new RegExp(quest) }).click();
    await expect(page.getByTestId('task-calendar')).toBeVisible();
    await page.getByRole('group', { name: 'How to show the tasks' }).getByRole('button', { name: 'List' }).click();
    await expect(page.getByRole('button', { name: 'Mark "A board task" as done' })).toBeVisible();
});
