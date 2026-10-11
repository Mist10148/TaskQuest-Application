'use strict';

/**
 * When a task's due date was set. Overdue and early effects (class bonuses, early_finish, overdue_clear,
 * the early/overdue quest facts) only count a due date that was set at least 24 hours before the
 * completion, so a task created with a made-up past or far-future date cannot be completed for a bonus.
 *   items.due_date_set_at   set whenever a due date is created or changed (NULL: no due date).
 *                           Backfilled from created_at for existing rows. A repeating copy gets its spawn time.
 */

exports.description = 'items.due_date_set_at';

exports.up = async (h) => {
    await h.addColumnIfMissing('items', 'due_date_set_at', 'DATETIME NULL DEFAULT NULL');
    await h.exec('UPDATE items SET due_date_set_at = created_at, updated_at = updated_at WHERE due_date IS NOT NULL AND due_date_set_at IS NULL');
};
