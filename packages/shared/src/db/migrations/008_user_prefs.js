'use strict';

/**
 * Per-user preferences and counters for reminders (time zone, hour, snooze,
 * overdue notices), the weekly digest, the calendar feed token, streak
 * freezes and lifetime XP spent. xp_spent is backfilled from the XP log.
 */

exports.description = 'users timezone/reminder/digest/calendar/freeze/xp_spent, lists remind_at/overdue_notified';

exports.up = async (h) => {
    await h.addColumnIfMissing('users', 'timezone', 'VARCHAR(64) NULL DEFAULT NULL');
    await h.addColumnIfMissing('users', 'reminder_hour', 'TINYINT UNSIGNED NOT NULL DEFAULT 9');
    await h.addColumnIfMissing('users', 'weekly_digest', 'BOOLEAN NOT NULL DEFAULT FALSE');
    await h.addColumnIfMissing('users', 'last_digest_at', 'TIMESTAMP NULL DEFAULT NULL');
    await h.addColumnIfMissing('users', 'calendar_token', 'CHAR(32) NULL DEFAULT NULL');
    await h.addColumnIfMissing('users', 'streak_freezes', 'INT NOT NULL DEFAULT 0');
    const addedSpent = await h.addColumnIfMissing('users', 'xp_spent', 'BIGINT NOT NULL DEFAULT 0');
    await h.addIndexIfMissing('users', 'uq_users_calendar_token', 'UNIQUE INDEX uq_users_calendar_token (calendar_token)');

    await h.addColumnIfMissing('lists', 'remind_at', 'DATETIME NULL DEFAULT NULL');
    await h.addColumnIfMissing('lists', 'overdue_notified', 'BOOLEAN NOT NULL DEFAULT FALSE');

    if (addedSpent) {
        // Only class and skill purchases count as spending (not blackjack bets, which can come back).
        await h.exec(
            `UPDATE users u SET xp_spent = COALESCE((
                 SELECT -SUM(t.amount) FROM xp_transactions t
                 WHERE t.discord_id = u.discord_id AND t.source IN ('class_purchase', 'skill_purchase') AND t.amount < 0
             ), 0)`
        );
    }
};
