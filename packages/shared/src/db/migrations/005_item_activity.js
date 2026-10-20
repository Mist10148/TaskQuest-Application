'use strict';

/**
 * A task's history (db/activity.js): one row per change somebody made, written inside the transaction that made it. `from_value` /
 * `to_value` are what the change was, as text (a name, a priority, a YYYY-MM-DD date, a person's display name, a quest name), so
 * an entry still reads the same after the person renames themselves or the quest is deleted. The actor's account may go (SET NULL:
 * "Someone"); the task's rows go with the task. Old rows are pruned by `npm run archive` with the XP log's window.
 */

exports.description = 'Task history (item_activity)';

exports.up = async ({ exec }) => {
    await exec(`CREATE TABLE IF NOT EXISTS item_activity (
        id BIGSERIAL PRIMARY KEY,
        item_id INT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
        actor_id VARCHAR(32) NULL REFERENCES users (discord_id) ON DELETE SET NULL,
        kind VARCHAR(16) NOT NULL CHECK (kind IN ('created', 'renamed', 'completed', 'reopened', 'priority', 'due', 'assigned', 'moved')),
        from_value VARCHAR(255) NULL,
        to_value VARCHAR(255) NULL,
        created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await exec('CREATE INDEX IF NOT EXISTS idx_item_activity_item ON item_activity (item_id, created_at DESC)');
    // Every foreign key column gets an index (deleting an account sets its rows' actor to NULL), and the archive job prunes by age.
    await exec('CREATE INDEX IF NOT EXISTS idx_item_activity_actor ON item_activity (actor_id)');
    await exec('CREATE INDEX IF NOT EXISTS idx_item_activity_created ON item_activity (created_at)');
};
