'use strict';

/**
 * Per-task reminders. A task with its own due date gets a DM on its due day.
 *   items.reminded_at  when the due-day DM went out (NULL: not yet), so it is sent once
 *   items.remind_at    a snooze: remind again once this time has passed
 * A new due date clears both, so moving a date re-arms the reminder.
 */

exports.description = 'items reminded_at, remind_at';

exports.up = async (h) => {
    await h.addColumnIfMissing('items', 'reminded_at', 'DATETIME NULL DEFAULT NULL');
    await h.addColumnIfMissing('items', 'remind_at', 'DATETIME NULL DEFAULT NULL');
};
