'use strict';

/**
 * Comments on a task (db/comments.js). A comment is shared content of the quest: it stays when its author resets their progress, and
 * when the author's account goes the comment stays without an author (SET NULL). It goes with the task. The body limit is
 * TEXT_LIMITS.COMMENT (1000 characters), checked by the service and, as a backstop, by the database.
 */

exports.description = 'Comments on tasks (item_comments)';

exports.up = async ({ exec }) => {
    await exec(`CREATE TABLE IF NOT EXISTS item_comments (
        id BIGSERIAL PRIMARY KEY,
        item_id INT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
        author_id VARCHAR(32) NULL REFERENCES users (discord_id) ON DELETE SET NULL,
        body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
        created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await exec('CREATE INDEX IF NOT EXISTS idx_item_comments_item ON item_comments (item_id, created_at)');
    // The foreign key to users gets its own index (deleting an account), and it serves the export of a person's own comments.
    await exec('CREATE INDEX IF NOT EXISTS idx_item_comments_author ON item_comments (author_id)');
};
