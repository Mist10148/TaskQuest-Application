/**
 * Sharing a list with other people: named invitations, members, roles.
 *
 * Rules (see docs/design/shared-lists.md):
 *   - only a manager (the owner counts as one) invites, changes roles or removes members; only the owner makes or unmakes a manager
 *   - an invitation names one person who has used TaskQuest before, found by their stored display name or by Discord ID when the
 *     bot already has one from a mention; there are no public invite links
 *   - at most LIMITS.MAX_LIST_MEMBERS people besides the owner, counting members and pending invitations
 *   - an invitation lives LIMITS.INVITE_TTL_DAYS days and is answered by the invitee only
 *   - members see each other's display names and roles. Discord IDs never leave this module: a member is addressed by the
 *     opaque list_members.public_id ("member key")
 *   - the owner cannot leave (they delete the list instead)
 * Every function throws NOT_FOUND for a list the caller has no part in.
 */

'use strict';

const crypto = require('crypto');
const { withTransaction, getPool } = require('./pool');
const access = require('./access');
const { errors, TaskQuestError } = require('../errors');
const v = require('../validation');
const { LIMITS, LIST_ROLES } = require('../constants');

const DAY_MS = 86400e3;

function unwrap(result) {
    if (!result.ok) throw errors.validation(result.error);
    return result.value;
}

function parseRole(role) {
    const r = String(role === undefined || role === null || role === '' ? 'viewer' : role).toLowerCase();
    if (!LIST_ROLES.includes(r)) throw errors.validation(`Role must be one of ${LIST_ROLES.join(', ')}.`);
    return r;
}

const newPublicId = () => crypto.randomBytes(6).toString('hex'); // 12 characters, random, never derived from a Discord ID

/** Find the invitee: by Discord ID when the bot supplies one, otherwise by exact stored display name. */
async function findInvitee(conn, { discordId, username, name }) {
    if (discordId !== undefined && discordId !== null) {
        const [[row]] = await conn.query('SELECT discord_id, discord_username FROM users WHERE discord_id = ?', [String(discordId)]);
        if (!row) throw errors.notFound('That person has not used TaskQuest yet.');
        return row;
    }
    const raw = String(username ?? name ?? '')
        .trim()
        .replace(/^@/, '');
    if (!raw) throw errors.validation('Enter the name of the person to invite.');
    if (raw.length > 100) throw errors.validation('That name is too long.');
    const [rows] = await conn.query('SELECT discord_id, discord_username FROM users WHERE discord_username = ? LIMIT 3', [raw]);
    if (rows.length === 0) throw errors.notFound('No TaskQuest user has that name. They need to have used TaskQuest at least once.');
    if (rows.length > 1) throw errors.conflict('More than one person has that name, so it is not safe to guess. Ask them to invite you instead.');
    return rows[0];
}

/** Pending invitations that have not run out. */
const LIVE = "status = 'pending' AND expires_at > UTC_TIMESTAMP()";

async function memberCount(conn, listId) {
    const [[m]] = await conn.query('SELECT COUNT(*) AS n FROM list_members WHERE list_id = ?', [listId]);
    const [[i]] = await conn.query(`SELECT COUNT(*) AS n FROM list_invites WHERE list_id = ? AND ${LIVE}`, [listId]);
    return { members: Number(m.n), invites: Number(i.n) };
}

/**
 * Invite someone to a list the actor manages.
 * @param {string} actorId
 * @param {number|string} listId
 * @param {{ username?: string, name?: string, discordId?: string, role?: string }} input `discordId` is for the bot only (the API never passes it)
 * @returns {Promise<{ id: number, role: string, expiresAt: Date, inviteeName: string|null, inviteeDiscordId: string, listName: string }>}
 */
async function invite(actorId, listId, input = {}) {
    const role = parseRole(input.role);
    return withTransaction(async (conn) => {
        const { list, isOwner } = await access.forList(conn, actorId, listId, 'manager', { lock: true });
        if (role === 'manager' && !isOwner) throw errors.forbidden('Only the owner can invite someone as a manager.');

        const invitee = await findInvitee(conn, input);
        const inviteeId = String(invitee.discord_id);
        if (inviteeId === String(actorId)) throw errors.validation('You cannot invite yourself.');
        if (inviteeId === String(list.discord_id)) throw errors.validation('That person already owns this list.');

        const [[sent]] = await conn.query('SELECT COUNT(*) AS n FROM list_invites WHERE invited_by = ? AND created_at > (UTC_TIMESTAMP() - INTERVAL 1 DAY)', [String(actorId)]);
        if (Number(sent.n) >= LIMITS.INVITES_PER_DAY) throw new TaskQuestError('RATE_LIMITED', 'You have sent a lot of invitations today. Try again tomorrow.', 429);

        const [[already]] = await conn.query('SELECT 1 AS x FROM list_members WHERE list_id = ? AND discord_id = ?', [list.id, inviteeId]);
        if (already) throw errors.conflict('That person is already on this list.');
        // An invitation that ran out no longer blocks a new one.
        await conn.query("UPDATE list_invites SET status = 'revoked' WHERE list_id = ? AND invitee_discord_id = ? AND status = 'pending' AND expires_at <= UTC_TIMESTAMP()", [list.id, inviteeId]);
        const [[pending]] = await conn.query(`SELECT 1 AS x FROM list_invites WHERE list_id = ? AND invitee_discord_id = ? AND ${LIVE}`, [list.id, inviteeId]);
        if (pending) throw errors.conflict('That person already has an invitation to this list.');

        const counts = await memberCount(conn, list.id);
        if (counts.members + counts.invites >= LIMITS.MAX_LIST_MEMBERS) {
            throw errors.validation(`A list can have at most ${LIMITS.MAX_LIST_MEMBERS} people besides the owner (members and pending invitations).`);
        }

        const expiresAt = new Date(Date.now() + LIMITS.INVITE_TTL_DAYS * DAY_MS);
        const [res] = await conn.query('INSERT INTO list_invites (list_id, invitee_discord_id, role, invited_by, expires_at) VALUES (?, ?, ?, ?, ?)', [
            list.id,
            inviteeId,
            role,
            String(actorId),
            expiresAt
        ]);
        return { id: res.insertId, role, expiresAt, inviteeName: invitee.discord_username || null, inviteeDiscordId: inviteeId, listName: list.name };
    });
}

/** The invitations waiting for me. Display names only. */
async function listInvites(userId) {
    const [rows] = await getPool().query(
        `SELECT i.id, i.role, i.created_at, i.expires_at, l.name AS list_name, ou.discord_username AS owner_name, iu.discord_username AS invited_by_name
         FROM list_invites i
         JOIN lists l ON l.id = i.list_id
         JOIN users ou ON ou.discord_id = l.discord_id
         LEFT JOIN users iu ON iu.discord_id = i.invited_by
         WHERE i.invitee_discord_id = ? AND i.status = 'pending' AND i.expires_at > UTC_TIMESTAMP()
         ORDER BY i.id DESC`,
        [String(userId)]
    );
    return rows.map((r) => ({
        id: r.id,
        listName: r.list_name,
        ownerName: r.owner_name,
        invitedByName: r.invited_by_name,
        role: r.role,
        createdAt: r.created_at,
        expiresAt: r.expires_at
    }));
}

/** Accept or decline one of my invitations. @returns {Promise<{ accepted: boolean, list: { id: number, name: string }|null, role: string }>} */
async function respond(userId, inviteId, accept) {
    const id = unwrap(v.id(inviteId));
    return withTransaction(async (conn) => {
        // Lock order is always list, then invitation (as in invite and revoke), so the three never deadlock.
        const [[peek]] = await conn.query('SELECT list_id FROM list_invites WHERE id = ? AND invitee_discord_id = ?', [id, String(userId)]);
        if (!peek) throw errors.notFound('Invitation not found.');
        await conn.query('SELECT id FROM lists WHERE id = ? FOR UPDATE', [peek.list_id]);
        const [[inv]] = await conn.query('SELECT * FROM list_invites WHERE id = ? AND invitee_discord_id = ? FOR UPDATE', [id, String(userId)]);
        if (!inv) throw errors.notFound('Invitation not found.');
        if (inv.status !== 'pending') throw errors.conflict('This invitation is no longer open.');
        if (new Date(inv.expires_at).getTime() <= Date.now()) {
            await conn.query("UPDATE list_invites SET status = 'revoked' WHERE id = ?", [id]);
            throw errors.conflict('This invitation has expired. Ask for a new one.');
        }
        if (!accept) {
            await conn.query("UPDATE list_invites SET status = 'declined' WHERE id = ?", [id]);
            return { accepted: false, list: null, role: inv.role };
        }
        const [[list]] = await conn.query('SELECT id, name, discord_id FROM lists WHERE id = ?', [inv.list_id]);
        if (!list) throw errors.notFound('Invitation not found.');
        const [[m]] = await conn.query('SELECT COUNT(*) AS n FROM list_members WHERE list_id = ?', [list.id]);
        const [[have]] = await conn.query('SELECT 1 AS x FROM list_members WHERE list_id = ? AND discord_id = ?', [list.id, String(userId)]);
        if (!have && Number(m.n) >= LIMITS.MAX_LIST_MEMBERS) throw errors.validation('This list is full.');
        if (!have) {
            await conn.query('INSERT INTO list_members (list_id, discord_id, role, public_id, added_by) VALUES (?, ?, ?, ?, ?)', [
                list.id,
                String(userId),
                inv.role,
                newPublicId(),
                inv.invited_by
            ]);
        }
        await conn.query("UPDATE list_invites SET status = 'accepted' WHERE id = ?", [id]);
        return { accepted: true, list: { id: list.id, name: list.name }, role: have ? 'unchanged' : inv.role };
    });
}

/** Withdraw a pending invitation of a list the actor manages. */
async function revoke(actorId, inviteId) {
    const id = unwrap(v.id(inviteId));
    return withTransaction(async (conn) => {
        const [[inv]] = await conn.query('SELECT id, list_id, status FROM list_invites WHERE id = ?', [id]);
        if (!inv) throw errors.notFound('Invitation not found.');
        await access.forList(conn, actorId, inv.list_id, 'manager', { lock: true }); // a stranger gets NOT_FOUND, like a missing invitation
        const [res] = await conn.query("UPDATE list_invites SET status = 'revoked' WHERE id = ? AND status = 'pending'", [id]);
        if (!res.affectedRows) throw errors.conflict('This invitation is no longer open.');
        return true;
    });
}

/**
 * Who is on a list, as any member sees it: display names and roles, plus the caller's own role. Managers also get the
 * pending invitations. The owner has the member key "owner".
 */
async function listMembers(userId, listId) {
    const { list, role, isOwner } = await access.forList(getPool(), userId, listId);
    const me = String(userId);
    const [[owner]] = await getPool().query('SELECT discord_username FROM users WHERE discord_id = ?', [list.discord_id]);
    const [rows] = await getPool().query(
        `SELECT m.public_id, m.role, m.discord_id, m.created_at, u.discord_username
         FROM list_members m JOIN users u ON u.discord_id = m.discord_id WHERE m.list_id = ? ORDER BY m.created_at, u.discord_username, m.public_id`,
        [list.id]
    );
    const members = [
        { memberKey: 'owner', name: owner ? owner.discord_username : null, role: 'manager', isOwner: true, isYou: isOwner },
        ...rows.map((r) => ({ memberKey: r.public_id, name: r.discord_username, role: r.role, isOwner: false, isYou: String(r.discord_id) === me, since: r.created_at }))
    ];
    let invites = [];
    if (access.atLeast(role, 'manager')) {
        const [inv] = await getPool().query(
            `SELECT i.id, i.role, i.created_at, i.expires_at, u.discord_username AS invitee_name
             FROM list_invites i JOIN users u ON u.discord_id = i.invitee_discord_id
             WHERE i.list_id = ? AND i.status = 'pending' AND i.expires_at > UTC_TIMESTAMP() ORDER BY i.id`,
            [list.id]
        );
        invites = inv.map((r) => ({ id: r.id, inviteeName: r.invitee_name, role: r.role, createdAt: r.created_at, expiresAt: r.expires_at }));
    }
    return { list: { id: list.id, name: list.name }, role, isOwner, members, invites, limit: LIMITS.MAX_LIST_MEMBERS };
}

async function memberByKey(conn, listId, memberKey) {
    const key = String(memberKey || '');
    if (!/^[a-f0-9]{12}$/.test(key)) throw errors.notFound('Member not found.');
    const [[m]] = await conn.query('SELECT * FROM list_members WHERE list_id = ? AND public_id = ? FOR UPDATE', [listId, key]);
    if (!m) throw errors.notFound('Member not found.');
    return m;
}

/** Change a member's role. Only the owner promotes someone to manager or changes a manager. */
async function setRole(actorId, listId, memberKey, role) {
    const next = parseRole(role);
    return withTransaction(async (conn) => {
        const { list, isOwner } = await access.forList(conn, actorId, listId, 'manager', { lock: true });
        const m = await memberByKey(conn, list.id, memberKey);
        if (!isOwner && (m.role === 'manager' || next === 'manager')) throw errors.forbidden('Only the owner can make or change a manager.');
        await conn.query('UPDATE list_members SET role = ? WHERE list_id = ? AND discord_id = ?', [next, list.id, m.discord_id]);
        return { memberKey: m.public_id, role: next };
    });
}

/** Delete a member's rows from one list, including their personal reminder state. */
async function dropMember(conn, listId, discordId) {
    await conn.query('DELETE FROM list_members WHERE list_id = ? AND discord_id = ?', [listId, discordId]);
    await conn.query('DELETE FROM list_reminders WHERE list_id = ? AND discord_id = ?', [listId, discordId]);
    await conn.query('DELETE ir FROM item_reminders ir JOIN items i ON i.id = ir.item_id WHERE i.list_id = ? AND ir.discord_id = ?', [listId, discordId]);
}

/** Remove a member from a list the actor manages. Only the owner removes a manager. */
async function removeMember(actorId, listId, memberKey) {
    return withTransaction(async (conn) => {
        const { list, isOwner } = await access.forList(conn, actorId, listId, 'manager', { lock: true });
        const m = await memberByKey(conn, list.id, memberKey);
        if (!isOwner && m.role === 'manager') throw errors.forbidden('Only the owner can remove a manager.');
        await dropMember(conn, list.id, m.discord_id);
        return true;
    });
}

/** Leave a list someone else owns. The owner cannot leave: they delete the list. */
async function leave(userId, listId) {
    return withTransaction(async (conn) => {
        const { list, isOwner } = await access.forList(conn, userId, listId, 'viewer', { lock: true });
        if (isOwner) throw errors.forbidden('You own this list, so you cannot leave it. Delete it instead.');
        await dropMember(conn, list.id, String(userId));
        return true;
    });
}

module.exports = { invite, listInvites, respond, revoke, listMembers, setRole, removeMember, leave };
