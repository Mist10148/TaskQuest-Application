'use strict';

/**
 * A task can be assigned to one person on its quest (the owner or a member). The column holds a Discord ID, which never leaves the
 * server: clients see the person's member key ('owner' or list_members.public_id), derived when the task is read (db/assignees.js).
 * ON DELETE SET NULL: an account that goes away leaves the task unassigned rather than deleting it. Leaving a list, being removed
 * from it, a progress reset and moving the task to a list the person is not on clear it in the service.
 */

exports.description = 'Tasks can be assigned to a person on their quest (items.assignee_id)';

exports.up = async ({ exec }) => {
    await exec('ALTER TABLE items ADD COLUMN IF NOT EXISTS assignee_id VARCHAR(32) NULL REFERENCES users (discord_id) ON DELETE SET NULL');
    await exec('CREATE INDEX IF NOT EXISTS idx_items_assignee ON items (assignee_id)');
};
