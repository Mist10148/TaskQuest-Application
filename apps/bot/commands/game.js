/**
 * /game — Blackjack, Rock Paper Scissors and Hangman.
 *
 * This module is only the Discord view. Game state, outcomes, payouts,
 * cooldowns and caps are handled by @taskquest/shared/db `games`, which
 * the web app uses too. State lives in the database, so games survive bot
 * restarts and double clicks cannot settle a hand twice.
 *
 * All game messages are ephemeral.
 */

const {
    SlashCommandBuilder,
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { games, users } = require('@taskquest/shared/db');
const shared = require('@taskquest/shared');
const { handleError, sendRewards } = require('../utils/respond');

const { BLACKJACK_CONFIG, REWARDS, LIMITS } = shared;
const { blackjack: bj, rps: rpsRules, hangman: hangmanRules } = shared.games;

const COLORS = { game: 0x9b59b6, win: 0x57f287, loss: 0xed4245, push: 0xfee75c, blackjack: 0xf1c40f };

const data = new SlashCommandBuilder().setName('game').setDescription('🎰 Play games to win XP!');

// ─── Shared components ───────────────────────────────────────────────────────

function gameSelectEmbed(balance) {
    return new EmbedBuilder()
        .setColor(COLORS.game)
        .setTitle('🎰 Game Center')
        .setDescription(`💰 **Your XP:** ${Number(balance).toLocaleString()}\n\nSelect a game to play:`)
        .addFields(
            { name: '🃏 Blackjack', value: 'Bet XP and beat the dealer to 21!', inline: true },
            { name: '✊ Rock Paper Scissors', value: `Risk-free: +${REWARDS.RPS_WIN} XP per win`, inline: true },
            { name: '📝 Hangman', value: 'Free: +10 XP per life left', inline: true }
        )
        .setFooter({ text: `Free games share a ${LIMITS.FREE_GAME_XP_PER_DAY} XP daily cap · only you can see this` });
}

function gameSelectMenu() {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('game_select')
            .setPlaceholder('Choose a game...')
            .addOptions([
                { label: 'Blackjack', value: 'blackjack', emoji: '🃏', description: 'Bet XP and beat the dealer to 21!' },
                { label: 'Rock Paper Scissors', value: 'rps', emoji: '✊', description: 'Win XP, no loss on defeat!' },
                { label: 'Hangman', value: 'hangman', emoji: '📝', description: 'Guess the word, earn XP!' }
            ])
    );
}

const backButton = () => new ButtonBuilder().setCustomId('game_back').setLabel('Back to Games').setStyle(ButtonStyle.Secondary);

const errorEmbed = (title, text) => new EmbedBuilder().setColor(COLORS.loss).setTitle(`❌ ${title}`).setDescription(text);

async function showMenu(interaction) {
    const user = await users.ensureUser(interaction.user.id);
    return interaction.editReply({ embeds: [gameSelectEmbed(user.player_xp)], components: [gameSelectMenu()] });
}

// ─── Blackjack views ─────────────────────────────────────────────────────────

const SUIT_EMOJI = { '♠': '♠️', '♥': '♥️', '♦': '♦️', '♣': '♣️' };
const formatHand = (hand) => hand.map((c) => (c ? `${c.rank}${SUIT_EMOJI[c.suit] || c.suit}` : '🂠')).join(' ');

function betEmbed(balance) {
    return new EmbedBuilder()
        .setColor(COLORS.game)
        .setTitle('🃏 Blackjack - Place Your Bet')
        .setDescription(`💰 **Your XP:** ${Number(balance).toLocaleString()}`)
        .addFields(
            { name: '📊 Bet Range', value: `Min: **${BLACKJACK_CONFIG.MIN_BET}** XP\nMax: **${bj.maxBet(balance)}** XP`, inline: true },
            { name: '💰 Payouts', value: 'Blackjack: **1.5x**\nWin: **1x**\nPush: bet returned', inline: true }
        )
        .setFooter({ text: 'Max bet is 25% of your XP (up to 1,000)' });
}

function betButtons(balance) {
    const max = bj.maxBet(balance);
    const buttons = [10, 25, 50, 100, 250]
        .filter((b) => b <= max)
        .map((b) => new ButtonBuilder().setCustomId(`bj_bet_${b}`).setLabel(`${b} XP`).setStyle(ButtonStyle.Primary));
    buttons.push(new ButtonBuilder().setCustomId('bj_bet_custom').setLabel('Custom').setEmoji('✏️').setStyle(ButtonStyle.Secondary));
    buttons.push(new ButtonBuilder().setCustomId('bj_bet_max').setLabel(`MAX (${max})`).setStyle(ButtonStyle.Danger));
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    rows.push(new ActionRowBuilder().addComponents(backButton()));
    return rows;
}

function handEmbed(view) {
    const embed = new EmbedBuilder()
        .setColor(COLORS.game)
        .setTitle('🃏 Blackjack')
        .setDescription(`💰 **Bet:** ${view.bet} XP${view.doubled ? ' (doubled)' : ''}`)
        .addFields(
            { name: `🎴 Your Hand (${view.playerValue.value}${view.playerValue.soft ? ' soft' : ''})`, value: formatHand(view.playerHand) },
            { name: `🎴 Dealer (${view.dealerValue.value}${view.finished ? '' : '+?'})`, value: formatHand(view.dealerHand) }
        );
    return embed;
}

function handButtons(view, balance) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('bj_hit').setLabel('Hit').setEmoji('🃏').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('bj_stand').setLabel('Stand').setEmoji('✋').setStyle(ButtonStyle.Success)
    );
    if (view.canDouble && balance >= view.bet) {
        row.addComponents(new ButtonBuilder().setCustomId('bj_double').setLabel('Double Down').setEmoji('💰').setStyle(ButtonStyle.Danger));
    }
    return [row];
}

function resultEmbed(result) {
    const { view, settlement, balance } = result;
    const titles = { blackjack: '🎉 BLACKJACK!', won: '✅ YOU WIN!', lost: '❌ YOU LOSE', push: '🤝 PUSH' };
    const net = settlement.net;
    const embed = new EmbedBuilder()
        .setColor({ blackjack: COLORS.blackjack, won: COLORS.win, lost: COLORS.loss, push: COLORS.push }[view.outcome])
        .setTitle(titles[view.outcome])
        .setDescription(`💰 **New Balance:** ${Number(balance).toLocaleString()} XP`)
        .addFields(
            { name: `🎴 Your Hand (${view.playerValue.value})`, value: formatHand(view.playerHand), inline: true },
            { name: `🎴 Dealer (${view.dealerValue.value})`, value: formatHand(view.dealerHand), inline: true },
            { name: '💵 Result', value: net > 0 ? `+${net} XP` : net < 0 ? `${net} XP` : '±0 XP (bet returned)' }
        )
        .setFooter({ text: 'Thanks for playing!' });
    if (settlement.bonusInfo?.details) embed.addFields({ name: '✨ Bonuses', value: settlement.bonusInfo.details.slice(0, 1024) });
    return embed;
}

const playAgainRow = (prefix) => [
    new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${prefix}_playagain`).setLabel('Play Again').setEmoji('🔄').setStyle(ButtonStyle.Success),
        backButton()
    )
];

async function renderBlackjack(interaction, result) {
    if (result.settlement) {
        await interaction.editReply({ embeds: [resultEmbed(result)], components: playAgainRow('bj') });
        return sendRewards(interaction, { achievements: result.settlement.achievements });
    }
    return interaction.editReply({ embeds: [handEmbed(result.view)], components: handButtons(result.view, result.balance) });
}

async function showBetScreen(interaction) {
    const active = await games.getActiveBlackjack(interaction.user.id);
    const user = await users.ensureUser(interaction.user.id);
    if (active) return interaction.editReply({ embeds: [handEmbed(active.view)], components: handButtons(active.view, user.player_xp) });
    if (Number(user.player_xp) < BLACKJACK_CONFIG.MIN_BET * 4) {
        return interaction.editReply({
            embeds: [errorEmbed('Not Enough XP', `You need at least **${BLACKJACK_CONFIG.MIN_BET * 4} XP** to bet the minimum of ${BLACKJACK_CONFIG.MIN_BET} (25% rule).\n\n💰 Balance: ${user.player_xp} XP`)],
            components: [gameSelectMenu()]
        });
    }
    return interaction.editReply({ embeds: [betEmbed(user.player_xp)], components: betButtons(user.player_xp) });
}

// ─── RPS views ───────────────────────────────────────────────────────────────

function rpsEmbed() {
    return new EmbedBuilder()
        .setColor(COLORS.game)
        .setTitle('✊ Rock Paper Scissors')
        .setDescription(`Choose your move!\n\n🏆 **Win:** +${REWARDS.RPS_WIN} XP (plus class/skill bonuses)\n❌ **Lose:** 0 XP\n🤝 **Tie:** 0 XP`)
        .setFooter({ text: 'Risk free!' });
}

function rpsButtons() {
    return [
        new ActionRowBuilder().addComponents(
            ...rpsRules.CHOICES.map((c) =>
                new ButtonBuilder().setCustomId(`rps_${c}`).setLabel(c[0].toUpperCase() + c.slice(1)).setEmoji(rpsRules.EMOJI[c]).setStyle(ButtonStyle.Primary)
            )
        ),
        new ActionRowBuilder().addComponents(backButton())
    ];
}

function rpsResultEmbed(r) {
    const titles = { won: '🎉 You Win!', lost: '😢 You Lose!', push: "🤝 It's a Tie!" };
    const colors = { won: COLORS.win, lost: COLORS.loss, push: COLORS.push };
    const xpText = r.outcome === 'won' ? (r.xpGained > 0 ? `+${r.xpGained} XP` : 'Daily free-game XP cap reached') : '±0 XP';
    return new EmbedBuilder()
        .setColor(colors[r.outcome])
        .setTitle(titles[r.outcome])
        .setDescription(
            `You chose ${rpsRules.EMOJI[r.player]} **${r.player.toUpperCase()}**\nBot chose ${rpsRules.EMOJI[r.opponent]} **${r.opponent.toUpperCase()}**`
        )
        .addFields({ name: '💰 XP', value: xpText, inline: true }, { name: '💵 Balance', value: `${Number(r.balance).toLocaleString()} XP`, inline: true })
        .setFooter({ text: 'Play again? Pick a move!' });
}

// ─── Hangman views ───────────────────────────────────────────────────────────

const HANGMAN_STAGES = [
    '```\n  +---+\n      |\n      |\n      |\n      |\n=========```',
    '```\n  +---+\n  O   |\n      |\n      |\n      |\n=========```',
    '```\n  +---+\n  O   |\n  |   |\n      |\n      |\n=========```',
    '```\n  +---+\n  O   |\n /|   |\n      |\n      |\n=========```',
    '```\n  +---+\n  O   |\n /|\\  |\n      |\n      |\n=========```',
    '```\n  +---+\n  O   |\n /|\\  |\n /    |\n      |\n=========```',
    '```\n  +---+\n  O   |\n /|\\  |\n / \\  |\n      |\n=========```'
];

function hangmanEmbed(view) {
    const word = view.masked.map((c) => c || '_').join(' ');
    const stage = HANGMAN_STAGES[view.maxLives - view.lives] || HANGMAN_STAGES[6];
    return new EmbedBuilder()
        .setColor(COLORS.game)
        .setTitle('📝 Hangman')
        .setDescription(`${stage}\n\n**Word:** ${word}`)
        .addFields(
            { name: '❤️ Lives', value: `${'❤️'.repeat(view.lives)}${'🖤'.repeat(view.maxLives - view.lives)}`, inline: true },
            { name: '🔤 Guessed', value: view.guessed.join(', ') || 'None', inline: true },
            { name: '🏆 Reward', value: `${view.potentialReward} XP`, inline: true }
        )
        .setFooter({ text: 'Pick a letter!' });
}

/** Two menus (A–M, N–Z) so all 26 letters are always reachable. */
function hangmanComponents(view) {
    const available = hangmanRules.ALPHABET.filter((l) => !view.guessed.includes(l));
    const rows = [];
    for (const [half, letters] of [
        ['a', available.filter((l) => l <= 'M')],
        ['n', available.filter((l) => l > 'M')]
    ]) {
        if (!letters.length) continue;
        rows.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`hm_letter_select_${half}`)
                    .setPlaceholder(half === 'a' ? '🔤 Letters A–M' : '🔤 Letters N–Z')
                    .addOptions(letters.map((l) => ({ label: l, value: `letter_${l}` })))
            )
        );
    }
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('hm_quit').setLabel('Quit Game').setEmoji('🚪').setStyle(ButtonStyle.Danger)));
    return rows;
}

function hangmanEndEmbed(r) {
    const won = r.view.outcome === 'won';
    return new EmbedBuilder()
        .setColor(won ? COLORS.win : COLORS.loss)
        .setTitle(won ? '🎉 You Won!' : '💀 Game Over!')
        .setDescription(`${won ? '' : `${HANGMAN_STAGES[6]}\n\n`}The word was: **${r.view.word}**`)
        .addFields(
            { name: '💰 XP Earned', value: won ? (r.xpGained > 0 ? `+${r.xpGained} XP` : 'Daily free-game XP cap reached') : '0 XP', inline: true },
            { name: '💵 Balance', value: `${Number(r.balance).toLocaleString()} XP`, inline: true }
        );
}

async function startHangman(interaction) {
    const r = await games.startHangman(interaction.user.id);
    return interaction.editReply({ embeds: [hangmanEmbed(r.view)], components: hangmanComponents(r.view) });
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const active = await games.getActiveBlackjack(interaction.user.id);
        if (active) {
            const user = await users.ensureUser(interaction.user.id);
            return interaction.editReply({ embeds: [handEmbed(active.view)], components: handButtons(active.view, user.player_xp) });
        }
        return showMenu(interaction);
    } catch (err) {
        return handleError(interaction, err);
    }
}

async function handleSelectMenu(interaction) {
    await interaction.deferUpdate();
    try {
        const selected = interaction.values[0];
        if (selected === 'blackjack') return showBetScreen(interaction);
        if (selected === 'rps') return interaction.editReply({ embeds: [rpsEmbed()], components: rpsButtons() });
        if (selected === 'hangman') return startHangman(interaction);
        return showMenu(interaction);
    } catch (err) {
        return handleError(interaction, err);
    }
}

/** Custom bet needs a modal, which cannot be shown after deferring. */
async function handleButtonNoDefer(interaction) {
    if (interaction.customId !== 'bj_bet_custom') return;
    return interaction.showModal(
        new ModalBuilder()
            .setCustomId('bj_bet_modal')
            .setTitle('Enter Bet Amount')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('bet_amount')
                        .setLabel('Bet Amount (XP)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setPlaceholder(`${BLACKJACK_CONFIG.MIN_BET} – ${BLACKJACK_CONFIG.HARD_CAP}`)
                        .setMinLength(1)
                        .setMaxLength(7)
                )
            )
    );
}

async function handleButton(interaction) {
    await interaction.deferUpdate();
    const id = interaction.customId;
    const userId = interaction.user.id;
    try {
        if (id === 'game_back') return showMenu(interaction);

        if (id.startsWith('bj_bet_')) {
            const user = await users.ensureUser(userId);
            const raw = id.slice('bj_bet_'.length);
            const bet = raw === 'max' ? bj.maxBet(Number(user.player_xp)) : Number(raw);
            return renderBlackjack(interaction, await games.startBlackjack(userId, bet));
        }
        if (id === 'bj_hit' || id === 'bj_stand' || id === 'bj_double') {
            return renderBlackjack(interaction, await games.blackjackAction(userId, id.slice(3)));
        }
        if (id === 'bj_playagain') return showBetScreen(interaction);

        if (id.startsWith('rps_')) {
            const r = await games.playRps(userId, id.slice(4));
            await interaction.editReply({ embeds: [rpsResultEmbed(r)], components: rpsButtons() });
            return sendRewards(interaction, { achievements: r.achievements });
        }

        if (id === 'hm_playagain') return startHangman(interaction);
        if (id === 'hm_quit') {
            await games.quitGame(userId, 'hangman');
            return interaction.editReply({
                embeds: [new EmbedBuilder().setColor(COLORS.push).setTitle('🚪 Game Quit').setDescription('You quit the Hangman game.')],
                components: [gameSelectMenu()]
            });
        }
    } catch (err) {
        return handleError(interaction, err);
    }
}

async function handleModal(interaction) {
    if (interaction.customId !== 'bj_bet_modal') return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const bet = Number(interaction.fields.getTextInputValue('bet_amount').trim());
        return renderBlackjack(interaction, await games.startBlackjack(interaction.user.id, bet));
    } catch (err) {
        return handleError(interaction, err);
    }
}

async function handleHangmanSelect(interaction) {
    await interaction.deferUpdate();
    try {
        const selected = interaction.values[0] || '';
        if (!selected.startsWith('letter_')) return;
        const r = await games.hangmanGuess(interaction.user.id, selected.slice('letter_'.length));
        if (!r.view.finished) return interaction.editReply({ embeds: [hangmanEmbed(r.view)], components: hangmanComponents(r.view) });
        await interaction.editReply({ embeds: [hangmanEndEmbed(r)], components: playAgainRow('hm') });
        return sendRewards(interaction, { achievements: r.achievements });
    } catch (err) {
        return handleError(interaction, err);
    }
}

module.exports = {
    data,
    execute,
    handleButton,
    handleButtonNoDefer,
    handleSelectMenu,
    handleModal,
    handleHangmanSelect
};
