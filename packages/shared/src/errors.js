'use strict';

/**
 * Expected, user-facing failures thrown by the shared services. The web API
 * maps `status` to an HTTP status; the bot shows `message` in an embed.
 * Anything that is not a TaskQuestError is an unexpected bug and must not be
 * shown to users verbatim.
 */
class TaskQuestError extends Error {
    constructor(code, message, status = 400, details = undefined) {
        super(message);
        this.name = 'TaskQuestError';
        this.code = code;
        this.status = status;
        if (details !== undefined) this.details = details;
    }
}

const errors = {
    validation: (msg) => new TaskQuestError('VALIDATION', msg, 400),
    notFound: (msg = 'Not found.') => new TaskQuestError('NOT_FOUND', msg, 404),
    conflict: (msg) => new TaskQuestError('CONFLICT', msg, 409),
    insufficientXP: (needed, balance) =>
        new TaskQuestError('INSUFFICIENT_XP', `Not enough XP (need ${needed}, have ${balance}).`, 400, { needed, balance }),
    forbidden: (msg) => new TaskQuestError('FORBIDDEN', msg, 403),
    gamificationDisabled: () =>
        new TaskQuestError('GAMIFICATION_DISABLED', 'Gamification is turned off. Turn it on in settings to use XP features.', 403),
    cooldown: (retryAfterMs) =>
        new TaskQuestError('COOLDOWN', 'Slow down! Try again in a moment.', 429, { retryAfterMs })
};

module.exports = { TaskQuestError, errors };
