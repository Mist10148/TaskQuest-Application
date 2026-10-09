'use strict';

/**
 * How the Discord bot formats conversation replies for a user: plain text
 * messages ('text') or embeds ('embed'). Set with /ai-format.
 */

exports.description = 'users.ai_chat_format';

exports.up = async (h) => {
    await h.addColumnIfMissing('users', 'ai_chat_format', "VARCHAR(8) NOT NULL DEFAULT 'text'");
};
