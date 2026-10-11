/** Pure cosmetics rules (no database): requirements and what to draw for an equipped set. */

'use strict';

const { COSMETICS, ACHIEVEMENTS } = require('./constants');

const isCosmeticId = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(COSMETICS, id);

function requirementText(req) {
    if (!req) return null;
    if (req.level) return `Reach level ${req.level}`;
    if (req.prestige) return `Prestige ${req.prestige === 1 ? 'once' : `${req.prestige} times`}`;
    if (req.achievement) return `Unlock the ${ACHIEVEMENTS[req.achievement]?.name || req.achievement} achievement`;
    return null;
}

/** Whether a user (row, plus the Set of achievement keys they hold) meets a cosmetic's requirement. */
function meetsRequirement(req, user, achievementKeys) {
    if (!req) return true;
    if (req.level && Number(user.player_level) < req.level) return false;
    if (req.prestige && Number(user.prestige) < req.prestige) return false;
    if (req.achievement && !achievementKeys.has(req.achievement)) return false;
    return true;
}

/**
 * What to draw for a user's equipped cosmetics (a users or leaderboard row): the title text, the frame
 * ring and the accent colours. Unknown ids (a removed cosmetic) are ignored. Never includes the Discord ID.
 */
function describeEquipped(row = {}) {
    const pick = (kind, col) => {
        const id = row[col];
        return isCosmeticId(id) && COSMETICS[id].kind === kind ? { id, ...COSMETICS[id] } : null;
    };
    const title = pick('title', 'equipped_title');
    const frame = pick('frame', 'equipped_frame');
    const accent = pick('accent', 'equipped_accent');
    return {
        title: title ? title.name : null,
        frame: frame ? { id: frame.id, name: frame.name, color: frame.color } : null,
        accent: accent ? { id: accent.id, name: accent.name, color: accent.color, colorDark: accent.colorDark } : null
    };
}

module.exports = { isCosmeticId, requirementText, meetsRequirement, describeEquipped };
