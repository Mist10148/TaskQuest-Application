'use strict';

/**
 * Shared cache for the AI prioritizer (apps/ai/app/graphs/prioritize.py). Until now a result lived in the memory of the one AI
 * process that computed it, so with several instances each had to ask the model again. One row per (user, cache_key), where
 * cache_key is a hash of the open-task features and the requested limit, so any edit to a task misses it. Rows are valid for 5
 * minutes (the service checks created_at and deletes the user's stale rows when it writes). Same shape as ai_summary_cache.
 */

exports.description = 'AI prioritizer result cache, shared between AI service instances';

exports.up = async ({ exec }) => {
    await exec(`CREATE TABLE IF NOT EXISTS ai_prioritize_cache (
        discord_id VARCHAR(32) NOT NULL REFERENCES users (discord_id) ON DELETE CASCADE,
        cache_key VARCHAR(64) NOT NULL,
        result_json JSONB NOT NULL,
        created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (discord_id, cache_key)
    )`);
};
