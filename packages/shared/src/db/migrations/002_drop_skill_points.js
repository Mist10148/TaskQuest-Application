'use strict';

/**
 * Drops users.skill_points. It dates from the skill-point era (before skills cost XP), nothing has written
 * it since the 4.0 merge, and the API's only use of it was to echo a constant 0. Idempotent: the baseline still
 * creates the column on a new database, and this removes it again; running it twice is a no-op.
 */

exports.description = 'Drop the unused users.skill_points column';

exports.up = async ({ exec }) => {
    await exec('ALTER TABLE users DROP COLUMN IF EXISTS skill_points');
};
