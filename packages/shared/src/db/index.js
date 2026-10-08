/** @taskquest/shared/db — database access shared by the bot and the web API. */

'use strict';

const pool = require('./pool');
const migrate = require('./migrate');

module.exports = { ...pool, ...migrate };
