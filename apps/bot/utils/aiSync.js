/**
 * Keeps the AI service's search index in step with edits made in Discord.
 * The web server re-indexes after its own writes; without this, bot edits
 * only reached the index on the AI service's periodic reconcile pass.
 * Every call is fire-and-forget and a no-op when AI is disabled.
 */

'use strict';

const { createAiClient } = require('@taskquest/shared/ai');

let client;
const ai = () => (client ||= createAiClient());

module.exports = {
    reindex(discordId, listId) {
        if (listId) ai().reindex(discordId, listId);
    },
    forget(discordId, listId) {
        if (listId) ai().forget(discordId, listId);
    },
    // exported for tests
    _setClient: (c) => {
        client = c;
    }
};
