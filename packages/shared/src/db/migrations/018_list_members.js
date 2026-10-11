'use strict';

/**
 * Shared lists. Every step is idempotent.
 *   list_members      who besides the owner may use a list, and as what (viewer, editor or manager). public_id is the opaque
 *                     handle the API uses for a member, so a Discord ID never leaves the server for another member to read
 *   list_invites      a named invitation to one user, valid for 7 days; at most one pending per list and person (checked under the list lock)
 *   list_reminders    a member's own reminder state for a list (the owner's lives on lists), so each member is reminded once
 *   item_reminders    the same for a task's reminder
 *   items.created_by / completed_by / first_completed_by   the ACTOR of each event: quests, caps, stats and the review count a person's own
 *                     actions, not the list owner's. Backfilled from the list owner, who was the only possible actor until now
 *   lists.cleared_by  who cleared the list (the person who was paid for it)
 */

exports.description = 'list_members, list_invites, reminder tables, items.created_by/completed_by/first_completed_by';

exports.up = async (h) => {
    await h.exec(`CREATE TABLE IF NOT EXISTS list_members (
        list_id INT NOT NULL,
        discord_id VARCHAR(32) NOT NULL,
        role ENUM('viewer','editor','manager') NOT NULL DEFAULT 'viewer',
        public_id CHAR(12) NOT NULL,
        added_by VARCHAR(32) DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (list_id, discord_id),
        UNIQUE KEY unique_list_member_public (public_id),
        KEY idx_list_members_user (discord_id),
        CONSTRAINT fk_list_members_list FOREIGN KEY (list_id) REFERENCES lists (id) ON DELETE CASCADE,
        CONSTRAINT fk_list_members_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await h.exec(`CREATE TABLE IF NOT EXISTS list_invites (
        id INT AUTO_INCREMENT PRIMARY KEY,
        list_id INT NOT NULL,
        invitee_discord_id VARCHAR(32) NOT NULL,
        role ENUM('viewer','editor','manager') NOT NULL DEFAULT 'viewer',
        invited_by VARCHAR(32) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        status ENUM('pending','accepted','declined','revoked') NOT NULL DEFAULT 'pending',
        KEY idx_list_invites_invitee (invitee_discord_id, status),
        KEY idx_list_invites_list (list_id, status),
        KEY idx_list_invites_inviter (invited_by, created_at),
        CONSTRAINT fk_list_invites_list FOREIGN KEY (list_id) REFERENCES lists (id) ON DELETE CASCADE,
        CONSTRAINT fk_list_invites_user FOREIGN KEY (invitee_discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await h.exec(`CREATE TABLE IF NOT EXISTS list_reminders (
        list_id INT NOT NULL,
        discord_id VARCHAR(32) NOT NULL,
        deadline_notified TINYINT(1) NOT NULL DEFAULT 0,
        overdue_notified TINYINT(1) NOT NULL DEFAULT 0,
        remind_at DATETIME NULL DEFAULT NULL,
        PRIMARY KEY (list_id, discord_id),
        CONSTRAINT fk_list_reminders_list FOREIGN KEY (list_id) REFERENCES lists (id) ON DELETE CASCADE,
        CONSTRAINT fk_list_reminders_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await h.exec(`CREATE TABLE IF NOT EXISTS item_reminders (
        item_id INT NOT NULL,
        discord_id VARCHAR(32) NOT NULL,
        reminded_at DATETIME NULL DEFAULT NULL,
        remind_at DATETIME NULL DEFAULT NULL,
        PRIMARY KEY (item_id, discord_id),
        CONSTRAINT fk_item_reminders_item FOREIGN KEY (item_id) REFERENCES items (id) ON DELETE CASCADE,
        CONSTRAINT fk_item_reminders_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await h.addColumnIfMissing('items', 'created_by', 'VARCHAR(32) NULL DEFAULT NULL');
    await h.addColumnIfMissing('items', 'completed_by', 'VARCHAR(32) NULL DEFAULT NULL');
    await h.addColumnIfMissing('items', 'first_completed_by', 'VARCHAR(32) NULL DEFAULT NULL');
    await h.addColumnIfMissing('lists', 'cleared_by', 'VARCHAR(32) NULL DEFAULT NULL');
    await h.addIndexIfMissing('items', 'idx_items_created_by', 'INDEX idx_items_created_by (created_by, created_at)');
    await h.addIndexIfMissing('items', 'idx_items_first_completed_by', 'INDEX idx_items_first_completed_by (first_completed_by, first_completed_at)');
    await h.addIndexIfMissing('items', 'idx_items_completed_by', 'INDEX idx_items_completed_by (completed_by, completed_at)');

    // Backfill: until now the list owner was the only person who could act. updated_at is pinned: this is not an edit.
    await h.exec('UPDATE items i JOIN lists l ON l.id = i.list_id SET i.created_by = l.discord_id, i.updated_at = i.updated_at WHERE i.created_by IS NULL');
    await h.exec(
        'UPDATE items i JOIN lists l ON l.id = i.list_id SET i.completed_by = l.discord_id, i.updated_at = i.updated_at WHERE i.completed = 1 AND i.completed_by IS NULL'
    );
    await h.exec(
        'UPDATE items i JOIN lists l ON l.id = i.list_id SET i.first_completed_by = l.discord_id, i.updated_at = i.updated_at WHERE i.first_completed_at IS NOT NULL AND i.first_completed_by IS NULL'
    );
    await h.exec('UPDATE lists SET cleared_by = discord_id, updated_at = updated_at WHERE cleared_at IS NOT NULL AND cleared_by IS NULL');
};
