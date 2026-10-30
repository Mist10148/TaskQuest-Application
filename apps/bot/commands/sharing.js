/**
 * Shared lists on Discord.
 *
 *   /share list:<name> user:<@user> role:<role>   invite someone (managers only); the invitee gets a DM with Accept / Decline
 *   /invites                                      the invitations waiting for me, with Accept / Decline
 *   /members list:<name>                          who is on a list and as what; managers can remove people
 *   /leave list:<name>                            leave a list someone else owns
 *
 * Everything is ephemeral and goes through db.sharing / db.access in @taskquest/shared, which decide who may do what
 * (a stranger gets "not found", a member with too weak a role gets a clear refusal). Members are shown by display name only;
 * the one place a Discord ID is used is the @mention of /share, which the bot already received from Discord.
 */

'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { tasks, users, sharing } = require('@taskquest/shared/db');
const { LIST_ROLES, INVITE_NEUTRAL_MESSAGE, errors, escapeDiscord } = require('@taskquest/shared');
const ui = require('../utils/ui');
const { autocompleteChoices, findList } = require('../utils/listChoice');
const { EPHEMERAL, handleError, idFrom } = require('../utils/respond');

const ROLE_BLURB = { viewer: 'can read the list', editor: 'can add, edit and complete tasks, and delete the ones they added', manager: 'can also edit the list and manage people' };
const roleChoices = LIST_ROLES.map((r) => ({ name: `${r} (${ROLE_BLURB[r]})`.slice(0, 100), value: r }));

const listOption = (o) => o.setName('list').setDescription('The list').setRequired(true).setAutocomplete(true).setMaxLength(100);

const shareData = new SlashCommandBuilder()
    .setName('share')
    .setDescription('👥 Invite someone to one of your lists')
    .addStringOption(listOption)
    .addUserOption((o) => o.setName('user').setDescription('Who to invite (they must have used TaskQuest before)').setRequired(true))
    .addStringOption((o) => o.setName('role').setDescription('What they may do (default: viewer)').addChoices(...roleChoices));
const invitesData = new SlashCommandBuilder().setName('invites').setDescription('📨 Invitations to shared lists waiting for you');
const membersData = new SlashCommandBuilder().setName('members').setDescription('👥 Who is on a shared list').addStringOption(listOption);
const leaveData = new SlashCommandBuilder().setName('leave').setDescription('🚪 Leave a list that was shared with you').addStringOption(listOption);

// ─── Autocomplete ────────────────────────────────────────────────────────────

/** Lists for the option menu: `/share` offers the ones you manage, `/members` the shared ones, `/leave` those you do not own. */
const AUTOCOMPLETE_FILTER = {
    share: (l) => l.role === 'manager',
    members: (l) => l.shared,
    leave: (l) => !l.is_owner
};

async function autocomplete(interaction) {
    try {
        const focused = interaction.options.getFocused(true);
        if (focused.name !== 'list') return await interaction.respond([]);
        const q = String(focused.value || '').toLowerCase();
        const keep = AUTOCOMPLETE_FILTER[interaction.commandName] || (() => true);
        const lists = await tasks.getLists(interaction.user.id, { sortBy: 'name', order: 'ASC' });
        return await interaction.respond(autocompleteChoices(lists, keep, q));
    } catch {
        return interaction.respond([]).catch(() => {});
    }
}

async function resolveList(interaction) {
    await users.ensureUser(interaction.user.id);
    const list = await findList(interaction.user.id, interaction.options.getString('list'));
    if (!list) {
        await interaction.editReply({ embeds: [ui.error('List not found', 'Pick one of your lists from the suggestions.')] });
        return null;
    }
    return list;
}

// ─── /share ──────────────────────────────────────────────────────────────────

const inviteButtons = (inviteId) =>
    new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`inv_accept_${inviteId}`).setLabel('Accept').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`inv_decline_${inviteId}`).setLabel('Decline').setEmoji('✖️').setStyle(ButtonStyle.Secondary)
    );

/** Names in an invitation come from other people: escaped, so they cannot add links, formatting or mentions to a message sent in the bot's name. */
function inviteEmbed({ listName, ownerName, invitedByName, role }) {
    const inviter = escapeDiscord(invitedByName, { max: 80 }) || 'Someone';
    const owner = escapeDiscord(ownerName, { max: 80 });
    return new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('👥 List invitation')
        .setDescription(
            `**${inviter}** invited you to **${escapeDiscord(listName, { max: 100 })}**${owner && owner !== inviter ? ` (owned by ${owner})` : ''} as **${role}**: you ${ROLE_BLURB[role]}.\n` +
                '-# XP you earn there is yours alone. The invitation is valid for 7 days; you can also answer it with /invites.'
        );
}

async function share(interaction) {
    await interaction.deferReply(EPHEMERAL);
    try {
        const list = await resolveList(interaction);
        if (!list) return;
        const target = interaction.options.getUser('user');
        if (target.bot) throw errors.validation('Bots cannot be invited.');
        const role = interaction.options.getString('role') || 'viewer';
        const inv = await sharing.invite(interaction.user.id, list.id, { discordId: target.id, role });
        if (!inv.sent) return await interaction.editReply({ embeds: [ui.info('Invitation', INVITE_NEUTRAL_MESSAGE)] });

        let dmNote = '';
        try {
            await target.send({
                embeds: [inviteEmbed({ listName: list.name, ownerName: list.owner_name, invitedByName: interaction.user.displayName || interaction.user.username, role })],
                components: [inviteButtons(inv.id)],
                allowedMentions: { parse: [] }
            });
        } catch {
            dmNote = '\n-# I could not send them a DM (their DMs are closed), but the invitation is waiting for them in **/invites**.';
        }
        await interaction.editReply({ embeds: [ui.success('Invitation sent', `**${escapeDiscord(inv.inviteeName || target.username, { max: 80 })}** was invited to **${escapeDiscord(list.name, { max: 100 })}** as **${role}**.${dmNote}`)] });
    } catch (err) {
        await handleError(interaction, err);
    }
}

// ─── /invites ────────────────────────────────────────────────────────────────

function invitesView(invites) {
    if (!invites.length) return { embeds: [ui.info('No invitations', 'Nobody has invited you to a list right now.')], components: [] };
    const shown = invites.slice(0, 5);
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📨 Invitations')
        .setDescription(shown.map((i, n) => `**${n + 1}.** **${escapeDiscord(i.listName, { max: 100 })}** · ${i.role} · from ${escapeDiscord(i.invitedByName || i.ownerName, { max: 80 }) || 'someone'}`).join('\n'))
        .setFooter({ text: invites.length > shown.length ? `Showing ${shown.length} of ${invites.length}` : 'They expire after 7 days.' });
    const components = shown.map((i, n) =>
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`inv_accept_${i.id}`).setLabel(`Accept ${n + 1}`).setEmoji('✅').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`inv_decline_${i.id}`).setLabel(`Decline ${n + 1}`).setStyle(ButtonStyle.Secondary)
        )
    );
    return { embeds: [embed], components };
}

async function invites(interaction) {
    await interaction.deferReply(EPHEMERAL);
    try {
        await users.ensureUser(interaction.user.id);
        await interaction.editReply(invitesView(await sharing.listInvites(interaction.user.id)));
    } catch (err) {
        await handleError(interaction, err);
    }
}

/** inv_accept_<id> / inv_decline_<id>: from the invitation DM or from /invites. Only the invitee's own click can succeed. */
async function handleInviteButton(interaction) {
    const accept = interaction.customId.startsWith('inv_accept_');
    const id = idFrom(interaction.customId, accept ? 'inv_accept_' : 'inv_decline_');
    try {
        // Acknowledge before the transaction: a cold database can outlast Discord's 3 seconds, and a late update would show
        // "This interaction failed" after the invitation was already accepted.
        await interaction.deferUpdate();
        const r = await sharing.respond(interaction.user.id, id, accept);
        const isInvitesView = Boolean(interaction.message?.embeds?.some?.((e) => (e.title || e.data?.title) === '📨 Invitations'));
        if (isInvitesView) {
            const note = r.accepted ? `Joined **${escapeDiscord(r.list.name, { max: 100 })}**.` : 'Invitation declined.';
            const view = invitesView(await sharing.listInvites(interaction.user.id));
            return await interaction.editReply({ ...view, content: note });
        }
        return await interaction.editReply({
            embeds: [r.accepted ? ui.success('Joined', `You can now open **${escapeDiscord(r.list.name, { max: 100 })}** with /list (your role: ${r.role}).`) : ui.info('Declined', 'Invitation declined.')],
            components: []
        });
    } catch (err) {
        // A stale button (already answered, expired, revoked) turns the message into the reason.
        if (interaction.deferred && !interaction.replied && interaction.message && (err.code === 'CONFLICT' || err.code === 'NOT_FOUND')) {
            return interaction.editReply({ embeds: [ui.info('No longer open', err.message)], components: [], content: '' }).catch(() => handleError(interaction, err));
        }
        return handleError(interaction, err);
    }
}

// ─── /members ────────────────────────────────────────────────────────────────

const ROLE_ICON = { manager: '🛡️', editor: '✏️', viewer: '👁️' };

async function membersView(userId, listId) {
    const data = await sharing.listMembers(userId, listId);
    const lines = data.members.map((m) => `${ROLE_ICON[m.role]} **${escapeDiscord(m.name, { max: 80 }) || 'Unknown'}** · ${m.isOwner ? 'owner' : m.role}${m.isYou ? ' (you)' : ''}`);
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`👥 ${data.list.name}`.slice(0, 256))
        .setDescription(lines.join('\n'))
        .setFooter({ text: `Your role: ${data.isOwner ? 'owner' : data.role} · up to ${data.limit} people besides the owner` });
    if (data.invites.length) embed.addFields({ name: 'Waiting for an answer', value: data.invites.map((i) => `${escapeDiscord(i.inviteeName, { max: 80 }) || 'Unknown'} · ${i.role}`).join('\n').slice(0, 1000) });
    const removable = data.members.filter((m) => !m.isOwner && !m.isYou && (data.isOwner || m.role !== 'manager'));
    const components = [];
    if (data.role === 'manager' && removable.length) {
        components.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`mem_rm_${data.list.id}`)
                    .setPlaceholder('Remove someone from this list…')
                    .addOptions(removable.slice(0, 25).map((m) => ({ label: String(m.name || 'Unknown').slice(0, 100), value: m.memberKey, description: m.role })))
            )
        );
    }
    return { embeds: [embed], components };
}

async function members(interaction) {
    await interaction.deferReply(EPHEMERAL);
    try {
        const list = await resolveList(interaction);
        if (!list) return;
        await interaction.editReply(await membersView(interaction.user.id, list.id));
    } catch (err) {
        await handleError(interaction, err);
    }
}

/** mem_rm_<listId>: a manager picked someone to remove. */
async function handleSelect(interaction) {
    try {
        const listId = idFrom(interaction.customId, 'mem_rm_');
        await interaction.deferUpdate(); // before the write and the reads (see handleInviteButton)
        await sharing.removeMember(interaction.user.id, listId, interaction.values[0]);
        const view = await membersView(interaction.user.id, listId);
        return await interaction.editReply({ ...view, content: 'Removed.' });
    } catch (err) {
        return handleError(interaction, err);
    }
}

// ─── /leave ──────────────────────────────────────────────────────────────────

async function leave(interaction) {
    await interaction.deferReply(EPHEMERAL);
    try {
        const list = await resolveList(interaction);
        if (!list) return;
        if (list.is_owner) throw errors.forbidden('You own this list, so you cannot leave it. Delete it with /list instead.');
        await interaction.editReply({
            embeds: [ui.warn('Leave this list?', `You will lose access to **${escapeDiscord(list.name, { max: 100 })}**. The owner can invite you again.`)],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`leave_yes_${list.id}`).setLabel('Leave').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('leave_no').setLabel('Stay').setStyle(ButtonStyle.Secondary)
                )
            ]
        });
    } catch (err) {
        await handleError(interaction, err);
    }
}

/** leave_yes_<listId> / leave_no */
async function handleLeaveButton(interaction) {
    try {
        if (interaction.customId === 'leave_no') return await interaction.update({ embeds: [ui.info('Cancelled', 'You are still on the list.')], components: [] });
        await interaction.deferUpdate(); // before the write (see handleInviteButton)
        await sharing.leave(interaction.user.id, idFrom(interaction.customId, 'leave_yes_'));
        return await interaction.editReply({ embeds: [ui.success('Left the list', 'You no longer have access to it.')], components: [] });
    } catch (err) {
        return handleError(interaction, err);
    }
}

module.exports = {
    shareData,
    invitesData,
    membersData,
    leaveData,
    share,
    invites,
    members,
    leave,
    autocomplete,
    autocompleteChoices,
    handleInviteButton,
    handleLeaveButton,
    handleSelect,
    invitesView,
    membersView,
    inviteEmbed
};
