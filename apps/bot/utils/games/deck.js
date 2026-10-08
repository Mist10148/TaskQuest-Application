/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🃏 DECK UTILITY - Standard 52-card deck logic for Blackjack
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/**
 * Create a fresh 52-card deck
 */
function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ rank, suit });
        }
    }
    return deck;
}

/**
 * Fisher-Yates shuffle (cryptographically fair)
 */
function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Get card value for blackjack
 * - Number cards: face value
 * - Face cards (J, Q, K): 10
 * - Ace: 11 (soft) or 1 (hard) - handled in calculateHandValue
 */
function getCardValue(card) {
    if (['J', 'Q', 'K'].includes(card.rank)) return 10;
    if (card.rank === 'A') return 11; // Ace starts as 11
    return parseInt(card.rank);
}

/**
 * Calculate hand value with soft/hard ace logic
 * Returns { value: number, soft: boolean }
 */
function calculateHandValue(hand) {
    let value = 0;
    let aces = 0;
    
    for (const card of hand) {
        if (card.rank === 'A') {
            aces++;
            value += 11;
        } else {
            value += getCardValue(card);
        }
    }
    
    // Convert aces from 11 to 1 if busting
    while (value > 21 && aces > 0) {
        value -= 10;
        aces--;
    }
    
    return {
        value,
        soft: aces > 0 && value <= 21, // Has an ace counted as 11
        bust: value > 21
    };
}

/**
 * Check if hand is blackjack (21 with 2 cards)
 */
function isBlackjack(hand) {
    return hand.length === 2 && calculateHandValue(hand).value === 21;
}

/**
 * Format card for display
 */
function formatCard(card, hidden = false) {
    if (hidden) return '🂠';
    const suitEmoji = { '♠': '♠️', '♥': '♥️', '♦': '♦️', '♣': '♣️' };
    return `${card.rank}${suitEmoji[card.suit] || card.suit}`;
}

/**
 * Format hand for display
 */
function formatHand(hand, hideSecond = false) {
    return hand.map((card, i) => {
        if (hideSecond && i === 1) return '🂠';
        return formatCard(card);
    }).join(' ');
}

/**
 * Draw card(s) from deck
 */
function drawCards(deck, count = 1) {
    const drawn = [];
    for (let i = 0; i < count && deck.length > 0; i++) {
        drawn.push(deck.pop());
    }
    return { drawn, deck };
}

/**
 * Deal initial blackjack hands
 * Returns { playerHand, dealerHand, deck }
 */
function dealInitialHands(deck) {
    const result = { playerHand: [], dealerHand: [], deck: [...deck] };
    
    // Deal alternating: player, dealer, player, dealer
    for (let i = 0; i < 2; i++) {
        let draw = drawCards(result.deck, 1);
        result.playerHand.push(draw.drawn[0]);
        result.deck = draw.deck;
        
        draw = drawCards(result.deck, 1);
        result.dealerHand.push(draw.drawn[0]);
        result.deck = draw.deck;
    }
    
    return result;
}

/**
 * Dealer plays according to standard rules (stands on soft 17)
 */
function dealerPlay(dealerHand, deck) {
    let hand = [...dealerHand];
    let currentDeck = [...deck];
    
    while (true) {
        const { value, soft } = calculateHandValue(hand);
        
        // Dealer stands on 17+ (including soft 17)
        if (value >= 17) break;
        
        // Dealer hits
        const { drawn, deck: newDeck } = drawCards(currentDeck, 1);
        if (drawn.length === 0) break; // Deck empty (shouldn't happen)
        hand.push(drawn[0]);
        currentDeck = newDeck;
    }
    
    return { hand, deck: currentDeck };
}

/**
 * Determine game outcome
 * Returns: 'blackjack' | 'win' | 'loss' | 'push'
 */
function determineOutcome(playerHand, dealerHand) {
    const playerBJ = isBlackjack(playerHand);
    const dealerBJ = isBlackjack(dealerHand);
    const playerValue = calculateHandValue(playerHand);
    const dealerValue = calculateHandValue(dealerHand);
    
    // Both blackjack = push
    if (playerBJ && dealerBJ) return 'push';
    
    // Player blackjack wins
    if (playerBJ) return 'blackjack';
    
    // Dealer blackjack wins
    if (dealerBJ) return 'loss';
    
    // Player bust = loss
    if (playerValue.bust) return 'loss';
    
    // Dealer bust = win
    if (dealerValue.bust) return 'win';
    
    // Compare values
    if (playerValue.value > dealerValue.value) return 'win';
    if (playerValue.value < dealerValue.value) return 'loss';
    
    return 'push';
}

module.exports = {
    SUITS, RANKS,
    createDeck, shuffleDeck,
    getCardValue, calculateHandValue,
    isBlackjack, formatCard, formatHand,
    drawCards, dealInitialHands, dealerPlay,
    determineOutcome
};
