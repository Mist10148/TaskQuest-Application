/**
 * /party - a small group (up to 6) with a shared weekly quest.
 *
 *   /party status                 this week's party quest and who contributed (names and counts only), with a Claim button
 *   /party create name:<name>     start a party (you can be in one at a time)
 *   /party invite user:<@user>    owner only; the invitee gets a DM with Accept / Decline
 *   /party invites                invitations waiting for you (also where a closed-DM invite ends up)
 *   /party kick user:<@user>      owner only; remove a member
 *   /party leave | /party disband
 *
 * Everything is ephemeral (it shows XP) and goes through db.parties in @taskquest/shared, which enforces who may do what.
 */

'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { parties, users } = require('@taskquest/shared/db');
const { errors, escapeDiscord, INVITE_NEUTRAL_MESSAGE } = require('@taskquest/shared');
const ui = require('../utils/ui');
const { EPHEMERAL, handleError, idFrom, sendRewards } = require('../utils/respond');

const data = new SlashCommandBuilder()
    .setName('party')
    .setDescription('🎉 Team up for a shared weekly quest')
    .addSubcommand((s) => s.setName('status').setDescription('This week\'s party quest'))
    .addSubcommand((s) => s.setName('create').setDescription('Start a party').addStringOption((o) => o.setName('name').setDescription('Party name').setRequired(true).setMaxLength(40)))
    .addSubcommand((s) => s.setName('invite').setDescription('Invite someone to your party (owner only)').addUserOption((o) => o.setName('user').setDescription('Who to invite (they must have used TaskQuest before)').setRequired(true)))
    .addSubcommand((s) => s.setName('invites').setDescription('Party invitations waiting for you'))
    .addSubcommand((s) => s.setName('kick').setDescription('Remove a member from your party (owner only)').addUserOption((o) => o.setName('user').setDescription('Who to remove').setRequired(true)))
    .addSubcommand((s) => s.setName('leave').setDescription('Leave your party'))
    .addSubcommand((s) => s.setName('disband').setDescription('Delete your party for everyone (owner only)'));

const bar = (progress, target) => {
    const filled = Math.min(8, Math.round((progress / Math.max(1, target)) * 8));
    return `${'▰'.repeat(filled)}${'▱'.repeat(8 - filled)}`;
};

/** The status embed and, when the reward is ready, the Claim button. */
function render(st) {
    if (!st) {
        return { embeds: [ui.info('No party yet', 'Start one with **/party create**, or accept an invitation with **/party invites**.')], components: [] };
    }
    const lines = st.members.map((m) => `${m.isOwner ? '👑' : '•'} **${escapeDiscord(m.name, { max: 80 }) || 'Unknown'}**${m.isYou ? ' (you)' : ''} · ${m.count} this week`);
    const ownLeft = Math.max(0, st.minToClaim - st.yourCount);
    const state = st.claimed
        ? '✅ claimed'
        : st.claimable
          ? '🎁 ready to claim!'
          : st.reached
            ? ownLeft > 0
                ? `done, but you need ${st.minToClaim} tasks of your own to claim (${ownLeft} to go)`
                : 'done, but the reward is not claimable (XP is off?)'
            : `${st.progress}/${st.target}`;
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🎉 ${escapeDiscord(st.party.name, { max: 40 })}`)
        .setDescription(
            `**Party quest:** finish ${st.perMember} tasks per active member together this week (at least ${st.minToClaim} of your own to claim) · +${st.reward} XP each\n${bar(st.progress, st.target)} ${state}\n\n${lines.join('\n')}`
        )
        .setFooter({ text: 'The week runs Monday to Monday in UTC for everyone. Only the first completion of a task counts.' });
    if (st.board && st.board.length > 1) {
        embed.addFields({
            name: 'This week\'s board',
            value: st.board.map((r) => `${r.rank}. **${escapeDiscord(r.name, { max: 80 }) || 'Unknown'}**${r.isYou ? ' (you)' : ''} · ${r.count} tasks · ${r.focusMinutes} min`).join('\n').slice(0, 1000)
        });
    }
    const fq = st.focusQuest;
    if (fq) {
        const fstate = fq.claimed ? '✅ claimed' : fq.claimable ? '🎁 ready to claim!' : fq.reached ? `done, but you need ${fq.minToClaim} focus minutes of your own (you have ${fq.yourMinutes})` : `${fq.progress}/${fq.target} min`;
        embed.addFields({ name: `⏱️ Focus together · +${fq.reward} XP each`, value: `${bar(fq.progress, fq.target)} ${fstate}` });
    }
    if (st.invites.length) embed.addFields({ name: 'Waiting for an answer', value: st.invites.map((i) => escapeDiscord(i.inviteeName, { max: 80 }) || 'Unknown').join(', ').slice(0, 1000) });
    const buttons = [];
    if (st.claimable) buttons.push(new ButtonBuilder().setCustomId('party_claim').setLabel('Claim reward').setEmoji('🎁').setStyle(ButtonStyle.Success));
    if (fq && fq.claimable) buttons.push(new ButtonBuilder().setCustomId('party_claim_focus').setLabel('Claim focus reward').setEmoji('⏱️').setStyle(ButtonStyle.Success));
    const components = buttons.length ? [new ActionRowBuilder().addComponents(...buttons)] : [];
    return { embeds: [embed], components };
}

const inviteButtons = (id) =>
    new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`party_accept_${id}`).setLabel('Join').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`party_decline_${id}`).setLabel('Decline').setStyle(ButtonStyle.Secondary)
    );

function invitesView(list) {
    if (!list.length) return { embeds: [ui.info('No invitations', 'Nobody has invited you to a party right now.')], components: [] };
    const shown = list.slice(0, 5);
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📨 Party invitations')
        .setDescription(shown.map((i, n) => `**${n + 1}.** **${escapeDiscord(i.partyName, { max: 40 })}** · owner ${escapeDiscord(i.ownerName, { max: 80 }) || 'someone'}`).join('\n'))
        .setFooter({ text: 'You can be in one party at a time.' });
    const components = shown.map((i, n) =>
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`party_accept_${i.id}`).setLabel(`Join ${n + 1}`).setEmoji('✅').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`party_decline_${i.id}`).setLabel(`Decline ${n + 1}`).setStyle(ButtonStyle.Secondary)
        )
    );
    return { embeds: [embed], components };
}

async function execute(interaction) {
    await interaction.deferReply(EPHEMERAL);
    try {
        const userId = interaction.user.id;
        await users.ensureUser(userId);
        const sub = interaction.options.getSubcommand ? interaction.options.getSubcommand() : 'status';
        if (sub === 'status') return await interaction.editReply(render(await parties.status(userId)));

        if (sub === 'create') {
            const created = await parties.create(userId, interaction.options.getString('name'));
            return await interaction.editReply({ embeds: [ui.success('Party created', `**${escapeDiscord(created.name, { max: 40 })}** is ready. Invite people with **/party invite**.`)] });
        }
        if (sub === 'invite') {
            const target = interaction.options.getUser('user');
            if (target.bot) throw errors.validation('Bots cannot be invited.');
            const inv = await parties.invite(userId, { discordId: target.id });
            if (!inv.sent) return await interaction.editReply({ embeds: [ui.info('Invitation', INVITE_NEUTRAL_MESSAGE)] });
            let note = '';
            try {
                await target.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0x5865f2)
                            .setTitle('🎉 Party invitation')
                            .setDescription(`**${escapeDiscord(interaction.user.displayName || interaction.user.username, { max: 80 }) || 'Someone'}** invited you to the party **${escapeDiscord(inv.partyName, { max: 40 })}**.\n-# Finish tasks together for a shared weekly quest. Valid for 7 days; you can also answer with /party invites.`)
                    ],
                    components: [inviteButtons(inv.id)],
                    allowedMentions: { parse: [] }
                });
            } catch {
                note = '\n-# I could not send them a DM (their DMs are closed), but the invitation is waiting for them in **/party invites**.';
            }
            return await interaction.editReply({ embeds: [ui.success('Invitation sent', `**${escapeDiscord(inv.inviteeName || target.username, { max: 80 })}** was invited to **${escapeDiscord(inv.partyName, { max: 40 })}**.${note}`)] });
        }
        if (sub === 'kick') {
            const target = interaction.options.getUser('user');
            await parties.kick(userId, { discordId: target.id });
            return await interaction.editReply({ embeds: [ui.success('Member removed', `**${escapeDiscord(target.displayName || target.username, { max: 80 })}** is no longer in your party.`)] });
        }
        if (sub === 'invites') return await interaction.editReply(invitesView(await parties.listInvites(userId)));
        if (sub === 'leave') {
            await parties.leave(userId);
            return await interaction.editReply({ embeds: [ui.success('Left the party', 'You are no longer in a party.')] });
        }
        if (sub === 'disband') {
            const st = await parties.status(userId);
            if (!st) throw errors.notFound('You are not in a party.');
            if (!st.party.isOwner) throw errors.forbidden('Only the owner of the party can do that.');
            return await interaction.editReply({
                embeds: [ui.warn('Disband the party?', `**${escapeDiscord(st.party.name, { max: 40 })}** will be deleted for all ${st.members.length} members.`)],
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('party_disband_yes').setLabel('Disband').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('party_disband_no').setLabel('Keep it').setStyle(ButtonStyle.Secondary)
                    )
                ]
            });
        }
    } catch (err) {
        await handleError(interaction, err);
    }
}

/** party_claim, party_accept_<id>, party_decline_<id>, party_disband_yes / party_disband_no */
async function handleButton(interaction) {
    const id = interaction.customId;
    try {
        if (id === 'party_claim') {
            await interaction.deferUpdate();
            const r = await parties.claim(interaction.user.id);
            await interaction.editReply(render(await parties.status(interaction.user.id)));
            await interaction.followUp({ embeds: [ui.success('Party reward claimed', `+${r.xp} XP. Balance: ${Number(r.balance).toLocaleString()} XP.`)], ...EPHEMERAL });
            return await sendRewards(interaction, { achievements: r.achievements });
        }
        if (id === 'party_claim_focus') {
            await interaction.deferUpdate();
            const r = await parties.claimFocus(interaction.user.id);
            await interaction.editReply(render(await parties.status(interaction.user.id)));
            await interaction.followUp({ embeds: [ui.success('Party focus reward claimed', `+${r.xp} XP. Balance: ${Number(r.balance).toLocaleString()} XP.`)], ...EPHEMERAL });
            return await sendRewards(interaction, { achievements: r.achievements });
        }
        if (id === 'party_disband_no') return await interaction.update({ embeds: [ui.info('Cancelled', 'The party stays.')], components: [] });
        // The rest write first: acknowledge so a slow database cannot outlast Discord's 3 seconds after the change is made.
        await interaction.deferUpdate();
        if (id === 'party_disband_yes') {
            await parties.disband(interaction.user.id);
            return await interaction.editReply({ embeds: [ui.success('Party disbanded', 'It is gone for everyone.')], components: [] });
        }
        const accept = id.startsWith('party_accept_');
        const inviteId = idFrom(id, accept ? 'party_accept_' : 'party_decline_');
        const r = await parties.respond(interaction.user.id, inviteId, accept);
        const inList = Boolean(interaction.message?.embeds?.some?.((e) => (e.title || e.data?.title) === '📨 Party invitations'));
        if (inList) return await interaction.editReply({ ...invitesView(await parties.listInvites(interaction.user.id)), content: r.accepted ? `Joined **${escapeDiscord(r.party.name, { max: 40 })}**.` : 'Invitation declined.' });
        return await interaction.editReply({
            embeds: [r.accepted ? ui.success('Joined the party', `Welcome to **${escapeDiscord(r.party.name, { max: 40 })}**. See the quest with /party status.`) : ui.info('Declined', 'Invitation declined.')],
            components: []
        });
    } catch (err) {
        if (interaction.deferred && !interaction.replied && (err.code === 'CONFLICT' || err.code === 'NOT_FOUND') && /^party_(accept|decline)_/.test(id)) {
            return interaction.editReply({ embeds: [ui.info('No longer open', err.message)], components: [], content: '' }).catch(() => handleError(interaction, err));
        }
        return handleError(interaction, err);
    }
}

module.exports = { data, execute, handleButton, render, invitesView };
