/** Hangman (pure). Free to play; a win pays max(10, livesLeft × 10) base XP. */

'use strict';

const { HANGMAN_WORDS, HANGMAN_CONFIG, REWARDS } = require('../constants');
const { randomInt, secureRandom } = require('../random');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function start(rng = secureRandom) {
    return {
        word: HANGMAN_WORDS[randomInt(HANGMAN_WORDS.length, rng)],
        guessed: [],
        lives: HANGMAN_CONFIG.LIVES,
        finished: false,
        outcome: null
    };
}

function reward(livesLeft) {
    return Math.max(REWARDS.HANGMAN_MIN, livesLeft * REWARDS.HANGMAN_PER_LIFE);
}

function guess(prev, rawLetter) {
    const letter = String(rawLetter || '').toUpperCase();
    if (!ALPHABET.includes(letter)) throw new Error('Guess must be a single letter A-Z');
    const state = { ...prev, guessed: [...prev.guessed] };
    if (state.finished) throw new Error('Game already finished');
    if (state.guessed.includes(letter)) return state;

    state.guessed.push(letter);
    if (!state.word.includes(letter)) state.lives -= 1;

    if (state.lives <= 0) {
        state.finished = true;
        state.outcome = 'lost';
    } else if (state.word.split('').every((c) => state.guessed.includes(c))) {
        state.finished = true;
        state.outcome = 'won';
    }
    return state;
}

/** Client-safe view: the word is masked until the game ends. */
function publicView(state) {
    return {
        masked: state.word.split('').map((c) => (state.guessed.includes(c) ? c : null)),
        length: state.word.length,
        guessed: state.guessed,
        wrong: state.guessed.filter((c) => !state.word.includes(c)),
        lives: state.lives,
        maxLives: HANGMAN_CONFIG.LIVES,
        potentialReward: reward(state.lives),
        finished: state.finished,
        outcome: state.outcome,
        word: state.finished ? state.word : null
    };
}

module.exports = { ALPHABET, start, guess, reward, publicView };
