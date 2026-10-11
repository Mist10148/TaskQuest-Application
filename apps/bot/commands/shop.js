/**
 * /shop - spend XP on cosmetics: titles, avatar frames and profile accents.
 *
 * Everything is ephemeral. The list shows each item's state (owned, equipped, locked, price); the
 * select menu picks one, and the detail screen offers the single action that applies: Buy (with the
 * price and the balance after), Equip or Unequip. Buying and equipping go through the shared
 * cosmetics service, which locks the user row, so a double click cannot charge twice.
 */

'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { cosmetics } = require('@taskquest/shared/db');
const { COSMETIC_KINDS, COSMETICS } = require('@taskquest/shared');
const ui = require('../utils/ui');
const { EPHEMERAL, handleError, sendRewards } = require('../utils/respond');

const KINDS = {
    title: { label: 'Titles', emoji: '🏷️', blurb: 'Shown next to your name in /profile, on the leaderboard and on the web.' },
    frame: { label: 'Frames', emoji: '🖼️', blurb: 'A ring around your avatar on the web app.' },
    accent: { label: 'Accents', emoji: '🎨', blurb: 'Colours your name on your web profile.' }
};

const data = new SlashCommandBuilder()
    .setName('shop')
    .setDescription('🛍️ Spend XP on titles, avatar frames and profile colours')
    .addStringOption((o) =>
        o
            .setName('section')
            .setDescription('What to browse (default: titles)')
            .addChoices(...COSMETIC_KINDS.map((k) => ({ name: KINDS[k].label, value: k })))
    );

const isKind = (k) => COSMETIC_KINDS.includes(k);

/** One line per item for the list embed. */
function itemLine(item) {
    const state = item.equipped ? '✅ equipped' : item.owned ? '🎒 owned' : item.locked ? `🔒 ${item.lockedReason}` : `${item.cost.toLocaleString()} XP${item.affordable ? '' : ' (not enough XP)'}`;
    return `**${item.name}**: ${state}`;
}

/** The list for one section with the tab buttons and the item picker. @param {object} shop result of listCosmetics */
function renderList(shop, kind = 'title') {
    const k = isKind(kind) ? kind : 'title';
    const items = shop.items.filter((i) => i.kind === k);
    const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle(`${KINDS[k].emoji} Shop: ${KINDS[k].label}`)
        .setDescription([`${KINDS[k].blurb}`, `You have **${Number(shop.balance).toLocaleString()} XP**.`, '', ...items.map(itemLine)].join('\n').slice(0, 4000))
        .setFooter({ text: 'Cosmetics never change how you earn XP, and you keep them when you prestige.' });
    const tabs = new ActionRowBuilder().addComponents(
        ...COSMETIC_KINDS.map((t) =>
            new ButtonBuilder().setCustomId(`shop_tab_${t}`).setLabel(KINDS[t].label).setStyle(t === k ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(t === k)
        )
    );
    const rows = [tabs];
    if (items.length) {
        rows.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`shop_pick_${k}`)
                    .setPlaceholder('Pick an item to buy or equip...')
                    .addOptions(items.slice(0, 25).map((i) => ({ label: i.name.slice(0, 100), value: i.id, description: (i.equipped ? 'Equipped' : i.owned ? 'Owned' : i.locked ? `Locked: ${i.lockedReason}` : `${i.cost} XP`).slice(0, 100) })))
            )
        );
    }
    return { embeds: [embed], components: rows };
}

/** The screen for one picked item: the one action that applies, plus Back. */
function renderDetail(shop, item) {
    const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle(`${KINDS[item.kind].emoji} ${item.name}`);
    const buttons = [];
    if (item.equipped) {
        embed.setDescription('This is equipped right now.');
        buttons.push(new ButtonBuilder().setCustomId(`shop_unequip_${item.kind}`).setLabel('Unequip').setStyle(ButtonStyle.Secondary));
    } else if (item.owned) {
        embed.setDescription('You own this.');
        buttons.push(new ButtonBuilder().setCustomId(`shop_equip_${item.id}`).setLabel('Equip').setStyle(ButtonStyle.Success));
    } else if (item.locked) {
        embed.setDescription(`🔒 Locked: ${item.lockedReason}.\nPrice: **${item.cost.toLocaleString()} XP**.`);
    } else {
        const after = Number(shop.balance) - item.cost;
        embed.setDescription(
            item.affordable
                ? `Price: **${item.cost.toLocaleString()} XP**\nBalance after: **${after.toLocaleString()} XP**`
                : `Price: **${item.cost.toLocaleString()} XP**. You need **${(-after).toLocaleString()}** more XP.`
        );
        buttons.push(new ButtonBuilder().setCustomId(`shop_buy_${item.id}`).setLabel(`Buy for ${item.cost.toLocaleString()} XP`).setStyle(ButtonStyle.Primary).setDisabled(!item.affordable));
    }
    buttons.push(new ButtonBuilder().setCustomId(`shop_tab_${item.kind}`).setLabel('Back').setStyle(ButtonStyle.Secondary));
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(...buttons)] };
}

async function execute(interaction) {
    await interaction.deferReply(EPHEMERAL);
    try {
        const kind = interaction.options.getString('section') || 'title';
        await interaction.editReply(renderList(await cosmetics.listCosmetics(interaction.user.id), kind));
    } catch (err) {
        await handleError(interaction, err);
    }
}

const isId = (id) => Object.prototype.hasOwnProperty.call(COSMETICS, id);

/** shop_tab_<kind>, shop_buy_<id>, shop_equip_<id>, shop_unequip_<kind>. */
async function handleButton(interaction) {
    await interaction.deferUpdate();
    try {
        const userId = interaction.user.id;
        const id = interaction.customId;
        const detail = async (cosmeticId, banner) => {
            const shop = await cosmetics.listCosmetics(userId);
            const payload = renderDetail(shop, shop.items.find((i) => i.id === cosmeticId));
            return interaction.editReply(banner ? { ...payload, embeds: [banner, ...payload.embeds] } : payload);
        };
        if (id.startsWith('shop_tab_')) {
            return await interaction.editReply(renderList(await cosmetics.listCosmetics(userId), id.slice('shop_tab_'.length)));
        }
        if (id.startsWith('shop_buy_')) {
            const bought = await cosmetics.buyCosmetic(userId, id.slice('shop_buy_'.length));
            await detail(bought.id, ui.success(`Bought ${bought.name}`, `Balance: ${Number(bought.balance).toLocaleString()} XP.`));
            return await sendRewards(interaction, { achievements: bought.achievements });
        }
        if (id.startsWith('shop_equip_')) {
            const cosmeticId = id.slice('shop_equip_'.length);
            if (!isId(cosmeticId)) return await interaction.editReply(renderList(await cosmetics.listCosmetics(userId)));
            await cosmetics.equipCosmetic(userId, COSMETICS[cosmeticId].kind, cosmeticId);
            return await detail(cosmeticId, ui.success('Equipped'));
        }
        if (id.startsWith('shop_unequip_')) {
            const kind = id.slice('shop_unequip_'.length);
            if (!isKind(kind)) return await interaction.editReply(renderList(await cosmetics.listCosmetics(userId)));
            await cosmetics.equipCosmetic(userId, kind, null);
            return await interaction.editReply(renderList(await cosmetics.listCosmetics(userId), kind));
        }
    } catch (err) {
        return handleError(interaction, err);
    }
}

/** shop_pick_<kind>: show the picked item. */
async function handleSelect(interaction) {
    await interaction.deferUpdate();
    try {
        const picked = interaction.values?.[0];
        const shop = await cosmetics.listCosmetics(interaction.user.id);
        const item = shop.items.find((i) => i.id === picked);
        await interaction.editReply(item ? renderDetail(shop, item) : renderList(shop));
    } catch (err) {
        await handleError(interaction, err);
    }
}

module.exports = { data, execute, handleButton, handleSelect, renderList, renderDetail, KINDS };
