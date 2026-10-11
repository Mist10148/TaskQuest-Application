'use strict';

/**
 * Sharing hardening. Every step is idempotent.
 *   users.discord_handle   the Discord username (unique on Discord, lowercase, e.g. "bob_42"), the only thing a person can be invited by.
 *                          users.discord_username stays the DISPLAY name (global name, chosen freely and not unique), which is only ever
 *                          shown, never searched. A binary collation makes the match exact and the unique key makes a handle belong to one
 *                          account. It is filled on every web login (and by the bot's invite flows). There is nothing to backfill from:
 *                          the stored display name cannot be told apart from a username, and a wrong guess would invite the wrong person,
 *                          so existing rows start NULL and fill in at their next login.
 *   party_members.public_id   the opaque member key the API uses for the owner to remove (kick) a member, like list_members.public_id.
 *                          Backfilled randomly; unique.
 *   users.accept_invites   1 (default) lets other people invite this account to a list or a party; 0 refuses every invitation, silently
 *                          (the inviter gets the same neutral answer as for an unknown name)
 */

exports.description = 'sharing hardening: users.discord_handle, users.accept_invites, party_members.public_id';

exports.up = async (h) => {
    await h.addColumnIfMissing('users', 'discord_handle', 'VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL');
    await h.addIndexIfMissing('users', 'unique_users_discord_handle', 'UNIQUE KEY unique_users_discord_handle (discord_handle)');

    await h.addColumnIfMissing('users', 'accept_invites', 'TINYINT(1) NOT NULL DEFAULT 1');

    await h.addColumnIfMissing('party_members', 'public_id', 'CHAR(12) NULL DEFAULT NULL');
    await h.exec("UPDATE party_members SET public_id = LEFT(SHA2(CONCAT(UUID(), '-', party_id, '-', discord_id), 256), 12) WHERE public_id IS NULL");
    await h.addIndexIfMissing('party_members', 'unique_party_member_public', 'UNIQUE KEY unique_party_member_public (public_id)');
};
