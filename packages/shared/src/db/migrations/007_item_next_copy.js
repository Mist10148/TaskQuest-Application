'use strict';

/**
 * A repeating task remembers the copy its completion created (items.next_copy_id), so undoing the completion can remove that copy
 * while nobody has touched it yet. copy_undone marks a task whose copy was removed that way: completing it again creates the copy
 * again (once), although its XP was already paid. ON DELETE SET NULL: deleting the copy by hand just forgets it.
 */

exports.description = 'Repeating tasks remember their next copy (items.next_copy_id, items.copy_undone)';

exports.up = async ({ exec }) => {
    await exec('ALTER TABLE items ADD COLUMN IF NOT EXISTS next_copy_id INT NULL REFERENCES items (id) ON DELETE SET NULL');
    await exec('ALTER TABLE items ADD COLUMN IF NOT EXISTS copy_undone SMALLINT NOT NULL DEFAULT 0');
    // The foreign key gets its own index, so deleting a task does not scan items for rows pointing at it.
    await exec('CREATE INDEX IF NOT EXISTS idx_items_next_copy ON items (next_copy_id) WHERE next_copy_id IS NOT NULL');
};
