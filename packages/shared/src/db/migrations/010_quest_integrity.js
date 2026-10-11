'use strict';

/**
 * Quest integrity. Quest progress used to be derived from items.completed_at
 * (rewritten on every re-check), created_at (reset by imports) and the query-time
 * priority, so quests could be farmed. These columns record what actually
 * counted, once:
 *   first_completed_at    set at the moment completion XP is first awarded, never rewritten
 *   first_completed_high  whether the task was HIGH priority at that moment
 *   counts_for_quests     0 for imported rows and auto-spawned recurring copies
 * repeat_anchor_day keeps a monthly repeat on its original day of month
 * (Jan 31 -> Feb 28 -> Mar 31 instead of drifting to the 28th).
 */

exports.description = 'quest integrity columns and repeat anchor day';

exports.up = async (h) => {
    await h.addColumnIfMissing('items', 'first_completed_at', 'DATETIME NULL DEFAULT NULL');
    await h.addColumnIfMissing('items', 'counts_for_quests', 'TINYINT(1) NOT NULL DEFAULT 1');
    await h.addColumnIfMissing('items', 'first_completed_high', 'TINYINT(1) NULL DEFAULT NULL');
    await h.addColumnIfMissing('items', 'repeat_anchor_day', 'TINYINT UNSIGNED NULL DEFAULT NULL');
    // Backfill (safe to re-run: only rows not yet filled are touched).
    await h.exec(
        `UPDATE items i JOIN lists l ON l.id = i.list_id
         SET i.updated_at = i.updated_at,
             i.first_completed_at = COALESCE(i.completed_at, i.updated_at),
             i.first_completed_high = (COALESCE(i.priority, l.priority) = 'HIGH')
         WHERE i.xp_awarded = 1 AND i.first_completed_at IS NULL`
    );
};
