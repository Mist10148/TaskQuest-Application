'use strict';

/**
 * Sharing hardening. Every step is idempotent.
 *   users.discord_handle   the Discord username (unique on Discord, lowercase, e.g. "bob_42"), the only thing a person can be invited by.
 *                          users.discord_username stays the DISPLAY name (global name, chosen freely and not unique), which is only ever
 *                          shown, never searched. A binary collation makes the match exact and the unique key makes a handle belong to one
 *                          account. It is filled on every web login (and by the bot's invite flows). There is nothing to backfill from:
 *                          the stored display name cannot be told apart from a username, and a wrong guess would invite the wrong person,
 *                          so existing rows start NULL and fill in at their next login.
 */

exports.description = 'sharing hardening: users.discord_handle';

exports.up = async (h) => {
    await h.addColumnIfMissing('users', 'discord_handle', 'VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL');
    await h.addIndexIfMissing('users', 'unique_users_discord_handle', 'UNIQUE KEY unique_users_discord_handle (discord_handle)');
};
