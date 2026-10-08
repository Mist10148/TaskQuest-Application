/** Rock–paper–scissors (pure). Risk free: wins pay REWARDS.RPS_WIN base XP. */

'use strict';

const { randomInt, secureRandom } = require('../random');

const CHOICES = ['rock', 'paper', 'scissors'];
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const EMOJI = { rock: '🪨', paper: '📄', scissors: '✂️' };

function isChoice(value) {
    return CHOICES.includes(value);
}

/** @returns {{ player, opponent, outcome: 'won'|'lost'|'push' }} */
function play(player, rng = secureRandom) {
    if (!isChoice(player)) throw new Error('Invalid choice');
    const opponent = CHOICES[randomInt(3, rng)];
    let outcome = 'lost';
    if (player === opponent) outcome = 'push';
    else if (BEATS[player] === opponent) outcome = 'won';
    return { player, opponent, outcome };
}

module.exports = { CHOICES, BEATS, EMOJI, isChoice, play };
