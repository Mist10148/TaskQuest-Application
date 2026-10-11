import { test, expect, playerContext } from './helpers';

test('an owner creates a party, invites a friend by username, who accepts it from the page', async ({ browser }) => {
    const captainContext = await playerContext(browser, 'captain');
    const allyContext = await playerContext(browser, 'ally');
    const captain = await captainContext.newPage();
    const ally = await allyContext.newPage();

    // Start clean even if an earlier run left them in a party (idempotent calls, results ignored).
    await captainContext.request.delete('/api/parties');
    await allyContext.request.post('/api/parties/leave');

    await captain.goto('/party');
    await expect(captain.getByRole('heading', { name: 'Party', exact: true })).toBeVisible();
    await captain.getByLabel('Party name').fill('Night Owls');
    await captain.getByRole('button', { name: 'Create party' }).click();

    await expect(captain.getByTestId('party-name')).toHaveText('Night Owls');
    const members = captain.getByTestId('party-member');
    await expect(members).toHaveCount(1);
    await expect(members.first()).toContainText('You');

    // Unknown names are rejected inline; the real one becomes a pending invitation.
    await captain.getByLabel('Username').fill('nobody_by_that_name');
    await captain.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(captain.getByRole('alert')).toContainText(/no taskquest user/i);
    await captain.getByLabel('Username').fill('e2e_ally');
    await captain.getByRole('button', { name: 'Invite', exact: true }).click();
    const confirm = captain.getByRole('alertdialog');
    await expect(confirm).toContainText('Invite e2e_ally?');
    await confirm.getByRole('button', { name: 'Send invitation' }).click();
    await expect(captain.getByTestId('party-pending-invite')).toContainText('e2e_ally');

    // The friend accepts from the party page.
    await ally.goto('/party');
    const invitations = ally.getByRole('region', { name: 'Party invitations' });
    await expect(invitations).toContainText('Night Owls');
    await invitations.getByRole('button', { name: 'Accept invitation to Night Owls' }).click();
    await expect(ally.getByTestId('party-name')).toHaveText('Night Owls');
    await expect(ally.getByTestId('party-member')).toHaveCount(2);
    await expect(ally.getByRole('button', { name: 'Leave party' })).toBeVisible();
    await expect(ally.getByRole('button', { name: 'Disband party' })).toHaveCount(0);

    // The owner sees both people and the invitation is gone.
    await captain.reload();
    await expect(captain.getByTestId('party-member')).toHaveCount(2);
    await expect(captain.getByTestId('party-member').filter({ hasText: 'e2e_ally' })).toBeVisible();
    await expect(captain.getByTestId('party-pending-invite')).toHaveCount(0);
    await expect(captain.getByRole('button', { name: 'Claim party reward' })).toBeDisabled();

    // Clean up through the UI: the owner disbands.
    await captain.getByRole('button', { name: 'Disband party' }).click();
    await captain.getByRole('alertdialog').getByRole('button', { name: 'Disband' }).click();
    await expect(captain.getByRole('button', { name: 'Create party' })).toBeVisible();
});
