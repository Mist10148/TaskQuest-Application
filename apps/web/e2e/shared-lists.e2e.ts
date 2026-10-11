import { test, expect, playerContext, unique } from './helpers';

test('an owner invites a friend by username, who accepts, finishes a task and the owner sees it done', async ({ browser }) => {
    const quest = unique('Team quest');
    const task = unique('Shared task');

    const captain = await (await playerContext(browser, 'captain')).newPage();
    const ally = await (await playerContext(browser, 'ally')).newPage();

    // The owner makes a quest with one task.
    await captain.goto('/tasks');
    await captain.getByRole('button', { name: 'Create Quest', exact: true }).click();
    const create = captain.getByRole('dialog');
    await create.getByLabel('Name *').fill(quest);
    await create.getByRole('button', { name: 'Create', exact: true }).click();
    await captain.getByRole('button', { name: new RegExp(quest) }).click();
    await captain.getByLabel('Quick add a task').fill(task);
    await captain.getByLabel('Quick add a task').press('Enter');
    await expect(captain.getByRole('button', { name: `Mark "${task}" as done` })).toBeVisible();

    // ...and invites the ally by their display name as an editor.
    await captain.getByRole('button', { name: 'Members' }).click();
    const members = captain.getByRole('dialog', { name: 'Members' });
    await expect(members.getByTestId('member-row')).toHaveCount(1);
    await members.getByLabel('Username').fill('nobody_by_that_name');
    await members.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(members.getByRole('alert')).toContainText(/no taskquest user/i);
    await members.getByLabel('Username').fill('e2e_ally');
    await members.getByLabel('Role', { exact: true }).selectOption('editor');
    await members.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(members.getByTestId('invite-row')).toContainText('e2e_ally');
    await captain.keyboard.press('Escape');
    await expect(members).toBeHidden();

    // The ally sees the invitation on the quest log, accepts it and the quest appears with the shared badge.
    await ally.goto('/tasks');
    const invitations = ally.getByRole('region', { name: 'Quest invitations' });
    await expect(invitations).toContainText(quest);
    await invitations.getByRole('button', { name: `Accept invitation to ${quest}` }).click();
    await expect(invitations).toBeHidden();
    const card = ally.getByRole('button', { name: `Open quest ${quest}` });
    await expect(card.getByLabel('Shared with 2 people')).toBeVisible();
    await expect(card).toContainText('Editor');
    await card.click();

    // An editor can finish the task (but cannot delete the quest).
    await expect(ally.getByRole('heading', { name: quest })).toBeVisible();
    await expect(ally.getByRole('button', { name: 'Delete quest' })).toHaveCount(0);
    await ally.getByRole('button', { name: `Mark "${task}" as done` }).click();
    await expect(ally.getByRole('button', { name: `Mark "${task}" as not done` })).toHaveAttribute('aria-pressed', 'true');

    // The owner sees it completed, and by whom.
    await captain.reload();
    await captain.getByRole('button', { name: new RegExp(quest) }).click();
    await expect(captain.getByRole('button', { name: `Mark "${task}" as not done` })).toHaveAttribute('aria-pressed', 'true');
    await expect(captain.getByText('Done by e2e_ally')).toBeVisible();
    await expect(captain.getByRole('button', { name: 'Delete quest' })).toBeVisible();
});

test('a viewer sees View only and has no way to add, edit or complete tasks', async ({ browser }) => {
    const ally = await (await playerContext(browser, 'ally')).newPage();
    await ally.goto('/tasks');
    await ally.getByRole('button', { name: /Viewer board/ }).click();

    await expect(ally.getByRole('heading', { name: 'Viewer board' })).toBeVisible();
    await expect(ally.getByText('View only', { exact: true })).toBeVisible();
    await expect(ally.getByRole('button', { name: 'Mark "Read only task" as done' })).toBeDisabled();
    await expect(ally.getByRole('button', { name: /Add Task|Add New Task/ })).toHaveCount(0);
    await expect(ally.getByLabel('Quick add a task')).toHaveCount(0);
    await expect(ally.getByRole('button', { name: /Edit "Read only task"|Delete "Read only task"/ })).toHaveCount(0);
    await expect(ally.getByRole('button', { name: 'Delete quest' })).toHaveCount(0);
    await expect(ally.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);

    // A viewer can still see who is on the quest and may leave it.
    await ally.getByRole('button', { name: 'Members' }).click();
    const members = ally.getByRole('dialog', { name: 'Members' });
    await expect(members.getByTestId('member-row')).toHaveCount(2);
    await expect(members.getByText('You', { exact: true })).toBeVisible();
    await expect(members.getByLabel('Username')).toHaveCount(0);
    await expect(members.getByRole('button', { name: 'Leave list' })).toBeVisible();
});
