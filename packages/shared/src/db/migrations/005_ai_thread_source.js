'use strict';

/**
 * Tag each AI chat thread with where it lives. Web chat threads ('web') show up
 * in the web app's thread list; Discord conversation memory ('discord', one
 * thread per user per channel) is kept out of it.
 */

exports.description = 'ai_chat_threads.source';

exports.up = async (h) => {
    await h.addColumnIfMissing('ai_chat_threads', 'source', "VARCHAR(16) NOT NULL DEFAULT 'web'");
};
