'use strict';

/**
 * Parties: a small group (up to 6 people) with a shared weekly quest. Every step is idempotent.
 *   parties         one row per party; the owner is also a party_members row
 *   party_members   one row per person; UNIQUE (discord_id) is the "one party per user" rule, enforced by the database
 *   party_invites   a named invitation to one person (same rules as list invites: 7 days, pending/accepted/declined/revoked)
 * The party quest itself has no table: progress is derived from items.first_completed_by, and the claim is a quest_claims row
 * with the key PARTY_<partyId> (see db/parties.js).
 */

exports.description = 'parties, party_members, party_invites';

exports.up = async (h) => {
    await h.exec(`CREATE TABLE IF NOT EXISTS parties (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(40) NOT NULL,
        owner_id VARCHAR(32) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_party_owner_name (owner_id, name),
        CONSTRAINT fk_parties_owner FOREIGN KEY (owner_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await h.exec(`CREATE TABLE IF NOT EXISTS party_members (
        party_id INT NOT NULL,
        discord_id VARCHAR(32) NOT NULL,
        joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (party_id, discord_id),
        UNIQUE KEY unique_party_member_user (discord_id),
        CONSTRAINT fk_party_members_party FOREIGN KEY (party_id) REFERENCES parties (id) ON DELETE CASCADE,
        CONSTRAINT fk_party_members_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await h.exec(`CREATE TABLE IF NOT EXISTS party_invites (
        id INT AUTO_INCREMENT PRIMARY KEY,
        party_id INT NOT NULL,
        invitee_discord_id VARCHAR(32) NOT NULL,
        invited_by VARCHAR(32) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        status ENUM('pending','accepted','declined','revoked') NOT NULL DEFAULT 'pending',
        KEY idx_party_invites_invitee (invitee_discord_id, status),
        KEY idx_party_invites_party (party_id, status),
        KEY idx_party_invites_inviter (invited_by, created_at),
        CONSTRAINT fk_party_invites_party FOREIGN KEY (party_id) REFERENCES parties (id) ON DELETE CASCADE,
        CONSTRAINT fk_party_invites_user FOREIGN KEY (invitee_discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
};
