'use strict';

/**
 * list_invites.responded_at and party_invites.responded_at: when the invitee declined. The decline cooldown (an inviter
 * cannot invite someone who said no, for a few days) is measured from this moment, not from when the invitation was sent:
 * an invitation declined late in its life used to leave almost no cooldown. NULL for older rows, which keep using created_at.
 */

exports.description = 'list_invites.responded_at, party_invites.responded_at';

exports.up = async (h) => {
    await h.addColumnIfMissing('list_invites', 'responded_at', 'DATETIME NULL DEFAULT NULL');
    await h.addColumnIfMissing('party_invites', 'responded_at', 'DATETIME NULL DEFAULT NULL');
};
