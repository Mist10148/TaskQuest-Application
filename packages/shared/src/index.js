/**
 * @taskquest/shared — pure game rules shared by the bot and the web API.
 * Database helpers live in '@taskquest/shared/db'.
 */

'use strict';

const constants = require('./constants');
const xp = require('./xp');
const achievements = require('./achievements');
const validation = require('./validation');
const random = require('./random');
const dates = require('./dates');
const { questPeriod } = require('./quests');
const blackjack = require('./games/blackjack');
const rps = require('./games/rps');
const hangman = require('./games/hangman');
const arcade = require('./games/arcade');
const { TaskQuestError, errors } = require('./errors');

module.exports = {
    ...constants,
    ...xp,
    ...achievements,
    TaskQuestError,
    errors,
    validation,
    random,
    ...dates,
    questPeriod,
    games: { blackjack, rps, hangman, arcade }
};
