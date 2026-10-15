/**
 * @taskquest/shared/db — database access shared by the bot and the web API.
 *
 * Services enforce ownership, validation and atomic XP accounting. They throw
 * TaskQuestError for expected failures (see ../errors.js).
 */

'use strict';

const pool = require('./pool');
const migrate = require('./migrate');
const users = require('./users');
const progression = require('./progression');
const tasks = require('./tasks');
const games = require('./games');
const quests = require('./quests');
const transfer = require('./transfer');
const focus = require('./focus');
const review = require('./review');
const templates = require('./templates');
const stats = require('./stats');
const cosmetics = require('./cosmetics');
const push = require('./push');
const access = require('./access');
const sharing = require('./sharing');
const parties = require('./parties');
const goals = require('./goals');

module.exports = { ...pool, ...migrate, users, progression, tasks, games, quests, transfer, focus, review, stats, templates, cosmetics, push, access, sharing, parties, goals };
