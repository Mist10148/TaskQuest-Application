'use strict';

/**
 * Per-task details: its own due date and priority, free-form tags, one level of
 * subtasks (parent_id) and a recurrence rule. All nullable, so existing tasks
 * and every older client keep working unchanged.
 */

exports.description = 'items due_date, priority, tags, parent_id, recurrence';

exports.up = async (h) => {
    await h.addColumnIfMissing('items', 'due_date', 'DATE NULL DEFAULT NULL');
    await h.addColumnIfMissing('items', 'priority', "ENUM('LOW','MEDIUM','HIGH') NULL DEFAULT NULL");
    await h.addColumnIfMissing('items', 'tags', 'VARCHAR(255) NULL DEFAULT NULL');
    await h.addColumnIfMissing('items', 'parent_id', 'INT NULL DEFAULT NULL');
    await h.addColumnIfMissing('items', 'recurrence', "ENUM('daily','weekly','monthly') NULL DEFAULT NULL");
    await h.addIndexIfMissing('items', 'idx_items_parent', 'INDEX idx_items_parent (parent_id)');
    await h.addIndexIfMissing('items', 'idx_items_due', 'INDEX idx_items_due (due_date)');
    await h.addForeignKeyIfMissing('items', 'parent_id', 'items', 'id', 'fk_items_parent');
};
