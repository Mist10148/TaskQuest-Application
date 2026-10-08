/**
 * Blackjack engine (pure). State is a plain JSON object so it can be stored in
 * game_sessions.game_data and resumed by either the bot or the web API.
 *
 * Rules: one 52-card deck, dealer stands on all 17s, blackjack pays 3:2,
 * a win pays 1:1, a push returns the bet, double down on the first two cards.
 */

'use strict';

const { BLACKJACK_CONFIG } = require('../constants');
const { shuffle, secureRandom } = require('../random');

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function createDeck() {
    const deck = [];
    for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
    return deck;
}

function cardValue(card) {
    if (card.rank === 'A') return 11;
    if (['J', 'Q', 'K'].includes(card.rank)) return 10;
    return Number(card.rank);
}

/** { value, soft, bust } with aces counted as 1 when needed. */
function handValue(hand) {
    let value = 0;
    let aces = 0;
    for (const card of hand) {
        value += cardValue(card);
        if (card.rank === 'A') aces++;
    }
    while (value > 21 && aces > 0) {
        value -= 10;
        aces--;
    }
    return { value, soft: aces > 0, bust: value > 21 };
}

function isBlackjack(hand) {
    return hand.length === 2 && handValue(hand).value === 21;
}

/** Max bet allowed for a balance. */
function maxBet(balance) {
    return Math.min(Math.floor(Math.max(0, balance) * BLACKJACK_CONFIG.MAX_BET_PERCENT), BLACKJACK_CONFIG.HARD_CAP);
}

/** Validate a bet against a balance. Returns null when valid, else an error string. */
function validateBet(bet, balance) {
    if (!Number.isSafeInteger(bet) || bet <= 0) return 'Bet must be a positive whole number.';
    if (bet < BLACKJACK_CONFIG.MIN_BET) return `Minimum bet is ${BLACKJACK_CONFIG.MIN_BET} XP.`;
    const max = maxBet(balance);
    if (bet > max) return `Maximum bet is ${max} XP (25% of your balance, capped at ${BLACKJACK_CONFIG.HARD_CAP}).`;
    if (bet > balance) return 'Not enough XP.';
    return null;
}

function draw(state) {
    const card = state.deck.pop();
    if (!card) throw new Error('Deck exhausted');
    return card;
}

/** Deal a new hand. If either side has a natural, the hand is already finished. */
function deal(bet, rng = secureRandom) {
    const state = {
        bet,
        doubled: false,
        deck: shuffle(createDeck(), rng),
        playerHand: [],
        dealerHand: [],
        finished: false,
        outcome: null
    };
    state.playerHand.push(draw(state));
    state.dealerHand.push(draw(state));
    state.playerHand.push(draw(state));
    state.dealerHand.push(draw(state));

    if (isBlackjack(state.playerHand) || isBlackjack(state.dealerHand)) finish(state);
    return state;
}

function dealerPlay(state) {
    while (handValue(state.dealerHand).value < 17) state.dealerHand.push(draw(state));
}

function outcomeOf(playerHand, dealerHand) {
    const pBJ = isBlackjack(playerHand);
    const dBJ = isBlackjack(dealerHand);
    if (pBJ && dBJ) return 'push';
    if (pBJ) return 'blackjack';
    if (dBJ) return 'lost';
    const p = handValue(playerHand);
    const d = handValue(dealerHand);
    if (p.bust) return 'lost';
    if (d.bust) return 'won';
    if (p.value > d.value) return 'won';
    if (p.value < d.value) return 'lost';
    return 'push';
}

function finish(state) {
    state.finished = true;
    state.outcome = outcomeOf(state.playerHand, state.dealerHand);
    return state;
}

/**
 * Apply a player action. Returns the mutated copy of state.
 * @param {'hit'|'stand'|'double'} action
 */
function act(prevState, action) {
    const state = JSON.parse(JSON.stringify(prevState));
    if (state.finished) throw new Error('Hand already finished');

    if (action === 'hit') {
        state.playerHand.push(draw(state));
        if (handValue(state.playerHand).value >= 21) {
            if (!handValue(state.playerHand).bust) dealerPlay(state);
            finish(state);
        }
    } else if (action === 'stand') {
        dealerPlay(state);
        finish(state);
    } else if (action === 'double') {
        if (state.playerHand.length !== 2 || state.doubled) throw new Error('You can only double down on your first two cards');
        state.doubled = true;
        state.bet *= 2;
        state.playerHand.push(draw(state));
        if (!handValue(state.playerHand).bust) dealerPlay(state);
        finish(state);
    } else {
        throw new Error(`Unknown blackjack action: ${action}`);
    }
    return state;
}

/**
 * Gross return to the player (bet included) and net winnings, before any
 * class/skill bonus is applied to the winnings.
 */
function settle(state) {
    const bet = state.bet;
    switch (state.outcome) {
        case 'blackjack': {
            const winnings = Math.floor(bet * BLACKJACK_CONFIG.BLACKJACK_MULTIPLIER);
            return { winnings, returned: bet + winnings };
        }
        case 'won': {
            const winnings = Math.floor(bet * BLACKJACK_CONFIG.WIN_MULTIPLIER);
            return { winnings, returned: bet + winnings };
        }
        case 'push':
            return { winnings: 0, returned: bet };
        default:
            return { winnings: 0, returned: 0 };
    }
}

/** Client-safe view: hides the deck and, while playing, the dealer hole card. */
function publicView(state) {
    const hideHole = !state.finished;
    const dealerHand = hideHole ? [state.dealerHand[0], null] : state.dealerHand;
    return {
        bet: state.bet,
        doubled: state.doubled,
        finished: state.finished,
        outcome: state.outcome,
        playerHand: state.playerHand,
        playerValue: handValue(state.playerHand),
        dealerHand,
        dealerValue: handValue(hideHole ? [state.dealerHand[0]] : state.dealerHand),
        canDouble: !state.finished && !state.doubled && state.playerHand.length === 2
    };
}

module.exports = {
    SUITS,
    RANKS,
    createDeck,
    cardValue,
    handValue,
    isBlackjack,
    maxBet,
    validateBet,
    deal,
    act,
    settle,
    outcomeOf,
    publicView
};
