/**
 * Parties: up to PARTY_MAX people with one shared weekly quest.
 *
 *   - a user is in at most one party (UNIQUE party_members.discord_id); the owner is a member too and cannot leave, only disband;
 *     the owner can remove (kick) a member, who is addressed by the opaque party_members.public_id
 *   - invitations work like list invitations (db/sharing.js): named by Discord username, one person who has used TaskQuest, 7 days, answered by the invitee;
 *     only the owner invites
 *   - the party quest is derived data, nothing to keep in sync. The week is the global UTC ISO week, the same window for every member
 *     (members live in different time zones, so no personal week could be shared). The target is PARTY_QUEST.PER_MEMBER_TARGET
 *     first completions for each member who finished at least one task themselves this week (items with counts_for_quests = 1, by the
 *     person who completed them first, made since that member joined; at least one member's worth); progress is the sum over today's
 *     members (each member's share capped at PER_MEMBER_TARGET). When it is reached every member who finished at least PARTY_QUEST.MIN_OWN_TO_CLAIM tasks themselves can claim
 *     PARTY_QUEST.REWARD flat XP once a week (a quest_claims row
 *     with the key PARTY_<partyId>; one party reward per person per week, whichever party it came from, so changing parties
 *     cannot pay twice)
 *   - members see each other's display names and this week's counts, nothing else (no XP, levels or lists)
 */

'use strict';

const crypto = require('crypto');
const { withTransaction, getPool } = require('./pool');
const { lockUser, progressFloor } = require('./users');
const { awardFlat, requireGamification, unlockAchievements } = require('./progression');
const { actorSql } = require('./access');
const { findInvitee, invitePreview, notSent } = require('./sharing');
const { errors, TaskQuestError } = require('../errors');
const v = require('../validation');
const { LIMITS, PARTY_QUEST, PARTY_FOCUS_QUEST } = require('../constants');
const { questPeriod } = require('../quests');

const DAY_MS = 86400e3;
const newPublicId = () => crypto.randomBytes(6).toString('hex'); // 12 characters, random, never derived from a Discord ID
const LIVE = "status = 'pending' AND expires_at > CURRENT_TIMESTAMP";

const unwrap = (result) => {
    if (!result.ok) throw errors.validation(result.error);
    return result.value;
};

/** The party the user is in: { id, name, owner_id } or null. */
async function myParty(conn, userId) {
    const [[row]] = await conn.query(
        'SELECT p.id, p.name, p.owner_id FROM party_members m JOIN parties p ON p.id = m.party_id WHERE m.discord_id = ?',
        [String(userId)]
    );
    return row || null;
}

/** Create a party; the creator becomes its owner and first member. */
async function create(userId, name) {
    const partyName = unwrap(v.partyName(name));
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, userId);
        if (await myParty(conn, user.discord_id)) throw errors.conflict('You are already in a party. Leave it first.');
        const [res] = await conn.query('INSERT INTO parties (name, owner_id) VALUES (?, ?) RETURNING id', [partyName, user.discord_id]);
        await conn.query('INSERT INTO party_members (party_id, discord_id, public_id) VALUES (?, ?, ?)', [res.insertId, user.discord_id, newPublicId()]);
        return { id: res.insertId, name: partyName };
    });
}

/** Lock the user's party row; owner-only operations pass `ownerOnly`. */
async function lockMyParty(conn, userId, { ownerOnly = false } = {}) {
    const party = await myParty(conn, userId);
    if (!party) throw errors.notFound('You are not in a party.');
    await conn.query('SELECT id FROM parties WHERE id = ? FOR UPDATE', [party.id]);
    if (ownerOnly && String(party.owner_id) !== String(userId)) throw errors.forbidden('Only the owner of the party can do that.');
    return party;
}

async function counts(conn, partyId) {
    const [[m]] = await conn.query('SELECT COUNT(*) AS n FROM party_members WHERE party_id = ?', [partyId]);
    const [[i]] = await conn.query(`SELECT COUNT(*) AS n FROM party_invites WHERE party_id = ? AND ${LIVE}`, [partyId]);
    return { members: Number(m.n), invites: Number(i.n) };
}

/**
 * Invite someone to the party (owner only). `input`: { username } (the exact Discord username) from the API, or { discordId } from the bot's @mention;
 * `dryRun` returns { dryRun: true, name, avatarUrl } for the confirmation step and invites nobody.
 * @returns {Promise<{ sent: true, id: number, inviteeName: string|null, inviteeDiscordId: string, expiresAt: Date, partyName: string } | { sent: false } | { dryRun: true, name: string|null, avatarUrl: string|null }>}
 *   `{ sent: false }`: nobody has that name, the person takes no invitations, declined this inviter recently or is already in a party; the inviter must not learn which
 */
async function invite(actorId, input = {}) {
    return withTransaction(async (conn) => {
        const party = await lockMyParty(conn, actorId, { ownerOnly: true });
        // Checked before the lookup: a limit that only fires for real, invitable people would reveal who exists.
        const [[sent]] = await conn.query('SELECT COUNT(*) AS n FROM party_invites WHERE invited_by = ? AND created_at > (CURRENT_TIMESTAMP - make_interval(days => 1))', [String(actorId)]);
        if (Number(sent.n) >= LIMITS.INVITES_PER_DAY) throw new TaskQuestError('RATE_LIMITED', 'You have sent a lot of invitations today. Try again tomorrow.', 429);

        const invitee = await findInvitee(conn, input);
        if (!invitee) return notSent(input);
        const inviteeId = String(invitee.discord_id);
        if (inviteeId === String(actorId)) throw errors.validation('You cannot invite yourself.');
        if (await myParty(conn, inviteeId)) return notSent(input); // not revealed: whether someone is in a party is theirs to know

        if (!Number(invitee.accept_invites)) return notSent(input);
        const [[declined]] = await conn.query(
            "SELECT 1 AS x FROM party_invites WHERE invited_by = ? AND invitee_discord_id = ? AND status = 'declined' AND COALESCE(responded_at, created_at) > (CURRENT_TIMESTAMP - make_interval(days => ?)) LIMIT 1",
            [String(actorId), inviteeId, LIMITS.INVITE_DECLINE_COOLDOWN_DAYS]
        );
        if (declined) return notSent(input);

        await conn.query("UPDATE party_invites SET status = 'revoked' WHERE party_id = ? AND invitee_discord_id = ? AND status = 'pending' AND expires_at <= CURRENT_TIMESTAMP", [party.id, inviteeId]);
        const [[pending]] = await conn.query(`SELECT 1 AS x FROM party_invites WHERE party_id = ? AND invitee_discord_id = ? AND ${LIVE}`, [party.id, inviteeId]);
        if (pending) throw errors.conflict('That person already has an invitation to your party.');
        const c = await counts(conn, party.id);
        if (c.members + c.invites >= LIMITS.MAX_PARTY_MEMBERS) {
            throw errors.validation(`A party has at most ${LIMITS.MAX_PARTY_MEMBERS} people (members and pending invitations).`);
        }
        if (input.dryRun) return { dryRun: true, ...invitePreview(invitee) };
        const expiresAt = new Date(Date.now() + LIMITS.INVITE_TTL_DAYS * DAY_MS);
        const [res] = await conn.query('INSERT INTO party_invites (party_id, invitee_discord_id, invited_by, expires_at) VALUES (?, ?, ?, ?) RETURNING id', [party.id, inviteeId, String(actorId), expiresAt]);
        return { sent: true, id: res.insertId, inviteeName: invitee.discord_username || null, inviteeDiscordId: inviteeId, expiresAt, partyName: party.name };
    });
}

/** Party invitations waiting for me. Display names only. */
async function listInvites(userId) {
    const [rows] = await getPool().query(
        `SELECT i.id, i.created_at, i.expires_at, p.name AS party_name, ou.discord_username AS owner_name
         FROM party_invites i JOIN parties p ON p.id = i.party_id JOIN users ou ON ou.discord_id = p.owner_id
         WHERE i.invitee_discord_id = ? AND i.status = 'pending' AND i.expires_at > CURRENT_TIMESTAMP ORDER BY i.id DESC`,
        [String(userId)]
    );
    return rows.map((r) => ({ id: r.id, partyName: r.party_name, ownerName: r.owner_name, createdAt: r.created_at, expiresAt: r.expires_at }));
}

/** Accept or decline one of my invitations. Accepting needs me to be free of any party and the party to have room. */
async function respond(userId, inviteId, accept) {
    const id = unwrap(v.id(inviteId));
    const result = await respondIn(userId, id, accept);
    if (result.voided) throw errors.conflict('This invitation is no longer open.'); // thrown after the transaction, so the revocation sticks
    return result;
}

async function respondIn(userId, id, accept) {
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, userId); // serialises this user's joins: one party at a time
        const [[peek]] = await conn.query('SELECT party_id FROM party_invites WHERE id = ? AND invitee_discord_id = ?', [id, user.discord_id]);
        if (!peek) throw errors.notFound('Invitation not found.');
        await conn.query('SELECT id FROM parties WHERE id = ? FOR UPDATE', [peek.party_id]); // lock order: party, then invitation
        const [[inv]] = await conn.query('SELECT * FROM party_invites WHERE id = ? AND invitee_discord_id = ? FOR UPDATE', [id, user.discord_id]);
        if (!inv) throw errors.notFound('Invitation not found.');
        if (inv.status !== 'pending') throw errors.conflict('This invitation is no longer open.');
        if (new Date(inv.expires_at).getTime() <= Date.now()) {
            await conn.query("UPDATE party_invites SET status = 'revoked' WHERE id = ?", [id]);
            throw errors.conflict('This invitation has expired. Ask for a new one.');
        }
        if (!accept) {
            await conn.query("UPDATE party_invites SET status = 'declined', responded_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
            return { accepted: false, party: null };
        }
        if (await myParty(conn, user.discord_id)) throw errors.conflict('You are already in a party. Leave it first.');
        // The invitation was the inviter's to make: if they are no longer in the party, it is void.
        const [[inviter]] = await conn.query('SELECT 1 AS x FROM party_members WHERE party_id = ? AND discord_id = ?', [inv.party_id, inv.invited_by]);
        if (!inviter) {
            await conn.query("UPDATE party_invites SET status = 'revoked' WHERE id = ?", [id]);
            return { voided: true };
        }
        const [[party]] = await conn.query('SELECT id, name FROM parties WHERE id = ?', [inv.party_id]);
        const [[m]] = await conn.query('SELECT COUNT(*) AS n FROM party_members WHERE party_id = ?', [party.id]);
        if (Number(m.n) >= LIMITS.MAX_PARTY_MEMBERS) throw errors.validation('This party is full.');
        await conn.query('INSERT INTO party_members (party_id, discord_id, public_id) VALUES (?, ?, ?)', [party.id, user.discord_id, newPublicId()]);
        await conn.query("UPDATE party_invites SET status = 'accepted' WHERE id = ?", [id]);
        // Any other open invitation of mine is moot now. Revoked, not declined: the other inviters must not get a decline cooldown.
        await conn.query("UPDATE party_invites SET status = 'revoked' WHERE invitee_discord_id = ? AND status = 'pending'", [user.discord_id]);
        return { accepted: true, party: { id: party.id, name: party.name } };
    });
}

/** Withdraw a pending invitation of my party (owner only). */
async function revoke(actorId, inviteId) {
    const id = unwrap(v.id(inviteId));
    return withTransaction(async (conn) => {
        const party = await lockMyParty(conn, actorId, { ownerOnly: true });
        const [res] = await conn.query("UPDATE party_invites SET status = 'revoked' WHERE id = ? AND party_id = ? AND status = 'pending'", [id, party.id]);
        if (!res.affectedRows) throw errors.notFound('Invitation not found.');
        return true;
    });
}

/** Leave my party. The owner cannot: they disband it. */
async function leave(userId) {
    return withTransaction(async (conn) => {
        const party = await lockMyParty(conn, userId);
        if (String(party.owner_id) === String(userId)) throw errors.forbidden('You own this party, so you cannot leave it. Disband it instead.');
        await conn.query('DELETE FROM party_members WHERE party_id = ? AND discord_id = ?', [party.id, String(userId)]);
        await conn.query("UPDATE party_invites SET status = 'revoked' WHERE party_id = ? AND invited_by = ? AND status = 'pending'", [party.id, String(userId)]);
        return true;
    });
}

/**
 * Remove a member from my party (owner only; never myself, the owner disbands instead). The member is addressed by the opaque member key
 * the status carries (the API), or by Discord ID when the bot already has one from a mention.
 */
async function kick(ownerId, target = {}) {
    return withTransaction(async (conn) => {
        const party = await lockMyParty(conn, ownerId, { ownerOnly: true });
        let row;
        if (target.discordId !== undefined && target.discordId !== null) {
            [[row]] = await conn.query('SELECT discord_id FROM party_members WHERE party_id = ? AND discord_id = ? FOR UPDATE', [party.id, String(target.discordId)]);
        } else {
            const key = String(target.memberKey || '');
            if (!/^[a-f0-9]{12}$/.test(key)) throw errors.notFound('Member not found.');
            [[row]] = await conn.query('SELECT discord_id FROM party_members WHERE party_id = ? AND public_id = ? FOR UPDATE', [party.id, key]);
        }
        if (!row) throw errors.notFound('Member not found.');
        if (String(row.discord_id) === String(ownerId)) throw errors.validation('You own this party, so you cannot remove yourself. Disband it instead.');
        await conn.query('DELETE FROM party_members WHERE party_id = ? AND discord_id = ?', [party.id, row.discord_id]);
        await conn.query("UPDATE party_invites SET status = 'revoked' WHERE party_id = ? AND invited_by = ? AND status = 'pending'", [party.id, row.discord_id]);
        return true;
    });
}

/** Delete the party for everyone (owner only). */
async function disband(userId) {
    return withTransaction(async (conn) => {
        const party = await lockMyParty(conn, userId, { ownerOnly: true });
        await conn.query('DELETE FROM parties WHERE id = ?', [party.id]);
        return true;
    });
}

/**
 * First completions the person made in the window (items counted for quests), on any list, and only since they joined the party:
 * work done before joining (or in another party) was not done for this one.
 */
async function weeklyCount(conn, discordId, period, joinedAt) {
    const [[row]] = await conn.query(
        `SELECT COUNT(*) AS n FROM items i
         WHERE ${actorSql('first_completed_by')} AND i.counts_for_quests = 1 AND i.first_completed_at >= ? AND i.first_completed_at < ? AND i.first_completed_at >= ?`,
        [discordId, discordId, await progressFloor(conn, discordId, period.startsAt), period.endsAt, joinedAt]
    );
    return Number(row.n);
}

/** Finished focus minutes the person logged in the window, only since they joined the party. */
async function weeklyFocusMinutes(conn, discordId, period, joinedAt) {
    const [[row]] = await conn.query(
        "SELECT COALESCE(SUM(minutes_credited), 0) AS n FROM focus_sessions WHERE discord_id = ? AND state = 'finished' AND finished_at >= ? AND finished_at < ? AND finished_at >= ?",
        [discordId, await progressFloor(conn, discordId, period.startsAt), period.endsAt, joinedAt]
    );
    return Number(row.n);
}

async function quest(conn, party, now) {
    const period = questPeriod('weekly', now, null); // one UTC week for the whole party
    const [rows] = await conn.query(
        `SELECT m.discord_id, m.public_id, m.joined_at, u.discord_username FROM party_members m JOIN users u ON u.discord_id = m.discord_id
         WHERE m.party_id = ? ORDER BY (m.discord_id = ?) DESC, m.joined_at, u.discord_username`,
        [party.id, party.owner_id]
    );
    const members = [];
    for (const r of rows) {
        members.push({
            discord_id: String(r.discord_id),
            memberKey: r.public_id,
            name: r.discord_username,
            count: await weeklyCount(conn, r.discord_id, period, r.joined_at),
            focus: await weeklyFocusMinutes(conn, r.discord_id, period, r.joined_at)
        });
    }
    // The target grows only with the members who took part for real (enough tasks to claim the reward themselves), so an idle seat,
    // a spare account or one stray task does not move it, and such a member does not count toward the progress either.
    const active = members.filter((m) => m.count >= PARTY_QUEST.MIN_OWN_TO_CLAIM);
    const target = PARTY_QUEST.PER_MEMBER_TARGET * Math.max(1, active.length);
    // One person's contribution is capped at their own share, so a single member cannot carry the whole party.
    const progress = active.reduce((n, m) => n + Math.min(m.count, PARTY_QUEST.PER_MEMBER_TARGET), 0);
    // The focus quest works the same way with minutes: the target grows with the members who focused, a share is capped.
    const focusing = members.filter((m) => m.focus >= 1).length;
    const focusTarget = PARTY_FOCUS_QUEST.PER_MEMBER_MINUTES * Math.max(1, focusing);
    const focusProgress = members.reduce((n, m) => n + Math.min(m.focus, PARTY_FOCUS_QUEST.PER_MEMBER_MINUTES), 0);
    return { period, members, target, progress, focusTarget, focusProgress };
}

/**
 * The party I am in with this week's quest, or null. Members are display names and counts, in the order they joined.
 * @returns {Promise<null | { party: { id: number, name: string, isOwner: boolean }, weekStart: string, resetsAt: string, perMember: number, minToClaim: number, yourCount: number, target: number, progress: number, reward: number, members: Array<{ memberKey: string, name: string|null, count: number, isYou: boolean, isOwner: boolean }>, invites: Array, limit: number, reached: boolean, claimed: boolean, claimable: boolean }>}
 */
async function status(userId, now = new Date()) {
    const conn = await getPool().getConnection();
    try {
        const me = String(userId);
        const party = await myParty(conn, me);
        if (!party) return null;
        const q = await quest(conn, party, now);
        const [[claim]] = await conn.query('SELECT 1 AS x FROM quest_claims WHERE discord_id = ? AND quest_key = ? AND period_start = ?', [me, `${PARTY_QUEST.KEY_PREFIX}${party.id}`, q.period.start]);
        const [[anyClaim]] = await conn.query("SELECT 1 AS x FROM quest_claims WHERE discord_id = ? AND LEFT(quest_key, 6) = 'PARTY_' AND period_start = ?", [me, q.period.start]);
        const [[user]] = await conn.query('SELECT gamification_enabled FROM users WHERE discord_id = ?', [me]);
        const isOwner = String(party.owner_id) === me;
        const reached = q.progress >= q.target;
        const mine = q.members.find((m) => m.discord_id === me);
        const yourCount = mine ? mine.count : 0;
        const yourMinutes = mine ? mine.focus : 0;
        const [[focusClaim]] = await conn.query('SELECT 1 AS x FROM quest_claims WHERE discord_id = ? AND LEFT(quest_key, 11) = ? AND period_start = ?', [me, PARTY_FOCUS_QUEST.KEY_PREFIX, q.period.start]);
        const focusReached = q.focusProgress >= q.focusTarget;
        // The board: this week's finished tasks and focus minutes, best first (ties by minutes, then in the order people joined).
        const board = q.members
            .map((m, index) => ({ memberKey: m.memberKey, name: m.name, count: m.count, focusMinutes: m.focus, isYou: m.discord_id === me, isOwner: m.discord_id === String(party.owner_id), index }))
            .sort((a, b) => b.count - a.count || b.focusMinutes - a.focusMinutes || a.index - b.index)
            .map(({ index, ...rest }, rank) => ({ rank: rank + 1, ...rest }));
        let invites = [];
        if (isOwner) {
            const [rows] = await conn.query(
                `SELECT i.id, i.created_at, i.expires_at, u.discord_username AS invitee_name FROM party_invites i JOIN users u ON u.discord_id = i.invitee_discord_id
                 WHERE i.party_id = ? AND i.status = 'pending' AND i.expires_at > CURRENT_TIMESTAMP ORDER BY i.id`,
                [party.id]
            );
            invites = rows.map((r) => ({ id: r.id, inviteeName: r.invitee_name, createdAt: r.created_at, expiresAt: r.expires_at }));
        }
        return {
            party: { id: party.id, name: party.name, isOwner },
            weekStart: q.period.start,
            resetsAt: q.period.endsAt.toISOString(),
            perMember: PARTY_QUEST.PER_MEMBER_TARGET,
            target: q.target,
            progress: q.progress,
            reward: PARTY_QUEST.REWARD,
            minToClaim: PARTY_QUEST.MIN_OWN_TO_CLAIM,
            yourCount,
            members: q.members.map((m) => ({ memberKey: m.memberKey, name: m.name, count: m.count, isYou: m.discord_id === me, isOwner: m.discord_id === String(party.owner_id) })),
            invites,
            limit: LIMITS.MAX_PARTY_MEMBERS,
            reached,
            claimed: Boolean(claim) || Boolean(anyClaim),
            claimable: reached && yourCount >= PARTY_QUEST.MIN_OWN_TO_CLAIM && !claim && !anyClaim && Boolean(user && user.gamification_enabled),
            board,
            focusQuest: {
                target: q.focusTarget,
                progress: q.focusProgress,
                reward: PARTY_FOCUS_QUEST.REWARD,
                minToClaim: PARTY_FOCUS_QUEST.MIN_OWN_MINUTES,
                perMember: PARTY_FOCUS_QUEST.PER_MEMBER_MINUTES,
                yourMinutes,
                reached: focusReached,
                claimed: Boolean(focusClaim),
                claimable: focusReached && yourMinutes >= PARTY_FOCUS_QUEST.MIN_OWN_MINUTES && !focusClaim && Boolean(user && user.gamification_enabled)
            }
        };
    } finally {
        conn.release();
    }
}

/** Claim this week's party reward: flat XP, once per person per week. */
async function claim(userId, now = new Date()) {
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, userId);
        requireGamification(user);
        const party = await myParty(conn, user.discord_id);
        if (!party) throw errors.notFound('You are not in a party.');
        const q = await quest(conn, party, now);
        if (q.progress < q.target) throw errors.validation(`The party quest isn't finished yet (${q.progress}/${q.target}).`);
        const own = q.members.find((m) => m.discord_id === String(user.discord_id));
        if (!own || own.count < PARTY_QUEST.MIN_OWN_TO_CLAIM) {
            throw errors.validation(`Finish at least ${PARTY_QUEST.MIN_OWN_TO_CLAIM} tasks yourself since joining this party this week to claim its reward (you have ${own ? own.count : 0}).`);
        }
        const [[already]] = await conn.query("SELECT 1 AS x FROM quest_claims WHERE discord_id = ? AND LEFT(quest_key, 6) = 'PARTY_' AND period_start = ?", [user.discord_id, q.period.start]);
        if (already) throw errors.conflict('You already claimed a party reward this week.');
        const [res] = await conn.query('INSERT INTO quest_claims (discord_id, quest_key, period_start, reward_xp) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id', [
            user.discord_id,
            `${PARTY_QUEST.KEY_PREFIX}${party.id}`,
            q.period.start,
            PARTY_QUEST.REWARD
        ]);
        if (res.affectedRows !== 1) throw errors.conflict('You already claimed this week\'s party reward.');
        const previousLevel = Number(user.player_level);
        const paid = await awardFlat(conn, user, 'party_quest', PARTY_QUEST.REWARD, { referenceId: res.insertId });
        const achievements = await unlockAchievements(conn, user);
        return {
            weekStart: q.period.start,
            xp: paid ? paid.xp : 0,
            balance: Number(user.player_xp),
            level: Number(user.player_level),
            leveledUp: Number(user.player_level) > previousLevel,
            achievements
        };
    });
}

/** Claim this week's party focus reward: flat XP, once per person per week. */
async function claimFocus(userId, now = new Date()) {
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, userId);
        requireGamification(user);
        const party = await myParty(conn, user.discord_id);
        if (!party) throw errors.notFound('You are not in a party.');
        const q = await quest(conn, party, now);
        if (q.focusProgress < q.focusTarget) throw errors.validation(`The party focus quest isn't finished yet (${q.focusProgress}/${q.focusTarget} minutes).`);
        const own = q.members.find((m) => m.discord_id === String(user.discord_id));
        if (!own || own.focus < PARTY_FOCUS_QUEST.MIN_OWN_MINUTES) {
            throw errors.validation(`Focus at least ${PARTY_FOCUS_QUEST.MIN_OWN_MINUTES} minutes yourself since joining this party this week to claim its reward (you have ${own ? own.focus : 0}).`);
        }
        const [[already]] = await conn.query('SELECT 1 AS x FROM quest_claims WHERE discord_id = ? AND LEFT(quest_key, 11) = ? AND period_start = ?', [user.discord_id, PARTY_FOCUS_QUEST.KEY_PREFIX, q.period.start]);
        if (already) throw errors.conflict('You already claimed a party focus reward this week.');
        const [res] = await conn.query('INSERT INTO quest_claims (discord_id, quest_key, period_start, reward_xp) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id', [
            user.discord_id,
            `${PARTY_FOCUS_QUEST.KEY_PREFIX}${party.id}`,
            q.period.start,
            PARTY_FOCUS_QUEST.REWARD
        ]);
        if (res.affectedRows !== 1) throw errors.conflict("You already claimed this week's party focus reward.");
        const previousLevel = Number(user.player_level);
        const paid = await awardFlat(conn, user, 'party_quest', PARTY_FOCUS_QUEST.REWARD, { referenceId: res.insertId });
        const achievements = await unlockAchievements(conn, user);
        return {
            weekStart: q.period.start,
            xp: paid ? paid.xp : 0,
            balance: Number(user.player_xp),
            level: Number(user.player_level),
            leveledUp: Number(user.player_level) > previousLevel,
            achievements
        };
    });
}

module.exports = { claimFocus, create, invite, listInvites, respond, revoke, leave, kick, disband, status, claim };
