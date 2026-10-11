# Database

TaskQuest stores everything in one MySQL 8 or MariaDB 10.4+ database, which the bot and the web server share. The schema is owned by **versioned migrations** in [`packages/shared/src/db/migrations`](../packages/shared/src/db/migrations). Neither app changes the schema any other way.

## Contents

1. [Migrations](#migrations)
2. [Upgrading a legacy database](#upgrading-a-legacy-database)
3. [Tables](#tables)
4. [XP transaction sources](#xp-transaction-sources)
5. [Game session states](#game-session-states)
6. [Automation queries](#automation-queries)
7. [Connection settings](#connection-settings)
8. [Backups and maintenance](#backups-and-maintenance)

---

## Migrations

```bash
npm run db:migrate          # reads DB_* from the environment / the root .env
```

Both apps also run pending migrations on startup unless `MIGRATE_ON_START=false`, in which case they refuse to start if the schema is behind.

- Applied migrations are recorded in `schema_migrations (id, applied_at)`.
- A MySQL named lock (`taskquest_migrations`) stops two processes migrating at the same time.
- Migrations are JavaScript, not raw SQL. They check `information_schema` before every change, so they are idempotent and work on both MySQL 8 and MariaDB. The two disagree on syntax such as `ADD COLUMN IF NOT EXISTS`.

| Migration | Purpose |
|---|---|
| `001_initial_schema` | Creates every table for a fresh database (`CREATE TABLE IF NOT EXISTS`) |
| `002_upgrade_legacy` | Brings databases from older releases up to the 001 schema (see below). Does nothing on a fresh database. |
| `003_ai` | AI tables (embeddings, chat threads, checkpoints, usage, summary cache) and `users.ai_enabled` |
| `004_lists_updated_at` | `lists.updated_at`, so list-only edits are re-indexed by the AI service |
| `005_ai_thread_source` | `ai_chat_threads.source` (`web` or `discord`) |
| `006_ai_chat_format` | `users.ai_chat_format` (how the bot formats AI replies) |
| `007_item_fields` | Per-task `due_date`, `priority`, `tags`, `parent_id` (subtasks, self-referencing FK, cascade) and `recurrence` |
| `008_user_prefs` | `users.timezone`, `reminder_hour`, `weekly_digest`, `last_digest_at`, `calendar_token` (unique), `streak_freezes`, `xp_spent` (backfilled from `xp_transactions`); `lists.remind_at` and `overdue_notified` |
| `009_quest_claims` | `quest_claims`, the claim log that keeps a quest to one payout per period |
| `010_quest_integrity` | `items.first_completed_at`, `first_completed_high`, `counts_for_quests` (what quests count) and `repeat_anchor_day` (monthly repeats keep their day) |
| `011_class_rework` | Class rebalance and five new classes: `users.assassin_last_at` (Assassin decay), `gambler_streak` (Hot Hand), `assassin_bleed` (Bleed), `owns_monk` / `owns_artisan` / `owns_ranger` / `owns_necromancer` / `owns_paladin`, counters `monk_rhythm`, `monk_day`, `artisan_progress`, `necro_souls`, and `player_class` extended with MONK, ARTISAN, RANGER, NECROMANCER, PALADIN |
| `012_xp_sources` | New XP sources: `lists.cleared_at` (a list pays the list-cleared bonus once), `users.last_chest_streak` (streak chests pay once per run), `items.habit_streak` (habit streaks), `items.first_completed_early` / `first_completed_overdue` (quest facts recorded at the first completion), `users.prestige` and `users.lifetime_xp_total` (backfilled from `lifetime_xp`), and the `focus_sessions` table |
| `013_task_reminders` | `items.reminded_at` (the task's due-day DM went out) and `items.remind_at` (snooze); a new due date clears both |
| `014_templates` | The `task_templates` table |
| `015_timezone_days` | `users.timezone_changed_at` (throttles zone changes now that the zone sets the user's day) |
| `016_cosmetics` | The `user_cosmetics` table and `users.equipped_title`, `equipped_frame`, `equipped_accent` |
| `017_web_push` | The `push_subscriptions` table and `users.web_push` |
| `020_due_date_set_at` | `items.due_date_set_at` (when the due date was set or last changed; backfilled from `created_at`). Overdue and early effects apply only to a date set at least 24 hours before the completion |

To add a migration, create `packages/shared/src/db/migrations/NNN_<name>.js` exporting `description` and `async up(h)`. Use the helpers on `h`: `exec`, `tableExists`, `columnExists`, `columnInfo`, `indexExists`, `addColumnIfMissing`, `addIndexIfMissing`, `addForeignKeyIfMissing`. Never edit a migration that has already been released.

## Upgrading a legacy database

Point TaskQuest 4.0 at your existing database and start it, or run `npm run db:migrate`. Migration `002_upgrade_legacy` handles all three historical layouts:

| Source | What 002 does |
|---|---|
| Bot v3.8 runtime DDL (`database/db.js`) | Adds foreign keys with `ON DELETE CASCADE` and indexes. Adds missing columns. Removes items orphaned by deleted lists. |
| Bot v3.5 `schema.sql` / `UPDATED_DATABASE_SCHEMA.sql` | Converts `xp_transactions.source` and `game_sessions.state` from `ENUM` to `VARCHAR`. Converts INT XP columns to BIGINT. Renames `game_sessions.started_at` to `created_at`. Adds `game_data`. Leaves the old `blackjack_hands` table in place but unused. |
| Web v1.5 runtime ALTERs | Ensures `discord_username` and `discord_avatar` exist on both MySQL and MariaDB. |

It also:

- converts latin1 tables to `utf8mb4`, so emoji in names work. Legacy FKs are dropped first and recreated afterwards.
- merges the web's `BUY_CLASS` achievement into the bot's `FIRST_CLASS`.
- adds `users.lifetime_xp`, backfilled as `GREATEST(player_xp, (player_level - 1) * 100)`, so **no player's level drops**.
- marks already-completed items as `xp_awarded`, so they can't be re-paid.
- **refunds escrowed bets** of Blackjack hands left active by old code, then expires all old active sessions.
- inserts placeholder `users` rows for any orphaned `discord_id`, so the foreign keys can be added.

> Back up first (`mysqldump`). The upgrade has been tested against all three layouts on MariaDB 10.4 and in CI on MySQL 8.

The historical scripts are kept in [`db/legacy/`](../db/legacy) for reference. **Do not run them.** `UPDATED_DATABASE_SCHEMA.sql` drops every table.

## Tables

All tables use InnoDB and `utf8mb4`. Every per-user table has a foreign key to `users(discord_id)` with `ON DELETE CASCADE`.

### `users`

| Column | Type | Notes |
|---|---|---|
| `discord_id` | VARCHAR(32) PK | Discord snowflake |
| `discord_username`, `discord_avatar` | VARCHAR(100) | Cached at web login for the leaderboard |
| `player_xp` | BIGINT | Spendable balance |
| `lifetime_xp` | BIGINT | XP earned since the last prestige. Drives the level. |
| `lifetime_xp_total` | BIGINT | Total ever earned, never reset (kept in sync by `applyXP`). Drives the XP achievements and the lifetime leaderboard. |
| `prestige` | INT | Times the player has prestiged (0–10); each adds +2% XP |
| `last_chest_streak` | INT | Streak length of the last streak chest paid; a chest pays only above it, and a broken streak clears it |
| `player_level` | BIGINT | ⌊lifetime_xp / 100⌋ + 1 (kept in sync by `applyXP`) |
| `player_class` | ENUM(DEFAULT, HERO, GAMBLER, ASSASSIN, WIZARD, ARCHER, TANK, MONK, ARTISAN, RANGER, NECROMANCER, PALADIN) | Equipped class (the last five arrived with migration 011) |
| `gamification_enabled`, `automation_enabled`, `auto_delete_old_lists` | BOOLEAN | Settings (default on) |
| `streak_count`, `last_daily_claim`, `last_active_day` | INT / DATETIME / DATE | Daily reward |
| `last_game_at` | DATETIME(3) | Free-game cooldown |
| `owns_hero` … `owns_tank`, `owns_monk`, `owns_artisan`, `owns_ranger`, `owns_necromancer`, `owns_paladin` | BOOLEAN | Class ownership (one column per purchasable class, named `owns_<class>`) |
| `assassin_streak`, `assassin_stacks`, `wizard_counter`, `archer_streak`, `tank_stacks`, `gambler_streak`, `monk_rhythm`, `artisan_progress`, `necro_souls` | INT | Class counters, reset when switching class (`CLASS_COUNTER_RESET` in `db/progression.js`) |
| `assassin_last_at` | DATETIME NULL | Last Assassin action. After more than 36 h (48 h with Night Owl) the streak and stacks reset. Cleared on class switch. |
| `monk_day` | DATE NULL | Last day (in the user's time zone) the Monk acted (Rhythm counts consecutive days). Cleared on class switch. |
| `assassin_bleed` | INT | Actions left with the Bleed bonus after a crit. Not tied to a class, so it survives a class switch; cleared by a progress reset. |
| `total_lists_created`, `total_items_added`, `total_items_completed` | INT | Monotonic counters for achievements |
| `skill_points` | INT | Legacy. Unused, kept for compatibility. |
| `timezone` | VARCHAR(64) NULL | IANA zone (NULL = UTC), validated with `Intl`. Defines the user's day for daily caps, quests, the weekly review, stats and reminders. Changing it moves the day from then on (nothing is rewritten) and is limited to once per 24 hours. |
| `timezone_changed_at` | DATETIME NULL | When the zone last changed (NULL: never set). Enforces the 24-hour limit. |
| `reminder_hour` | TINYINT UNSIGNED, default 9 | Local hour reminders and the digest are sent |
| `weekly_digest`, `last_digest_at` | BOOLEAN / TIMESTAMP | Opt-in Monday summary DM and when it last went out |
| `calendar_token` | CHAR(32) NULL, unique | Secret of the calendar feed URL; NULL = feed off |
| `streak_freezes` | INT | Bought freezes held (max 3) |
| `equipped_title`, `equipped_frame`, `equipped_accent` | VARCHAR(40) NULL | The cosmetic (a key of `COSMETICS`) shown for each kind; cleared by a progress reset |
| `web_push` | TINYINT(1), default 1 | Send reminders to this user's subscribed browsers too (needs web push configured) |
| `xp_spent` | BIGINT | XP ever spent on classes, skills, freezes and cosmetics (spending achievements) |
| `ai_enabled`, `ai_chat_format` | TINYINT / VARCHAR(8) | AI opt-out and Discord reply format (migrations 003, 006) |
| `created_at` | TIMESTAMP | |

Index: `(gamification_enabled, player_xp)` for the leaderboard.

### `lists`

`id` PK · `discord_id` FK · `name` VARCHAR(100) · `description` TEXT · `category` VARCHAR(50) · `deadline` DATE · `priority` ENUM(LOW, MEDIUM, HIGH) · `deadline_notified` BOOLEAN · `overdue_notified` BOOLEAN · `remind_at` DATETIME (snooze: remind again at this time) · `cleared_at` DATETIME NULL (when the list-cleared bonus was paid; the Tidy Up quest counts it) · `cleared_by` VARCHAR(32) NULL (who was paid for clearing it; the Tidy Up quest counts that person) · `created_at` · `updated_at` (auto-updated on list edits; added by migration `004_lists_updated_at`).

`discord_id` is the **owner**. Unique key `(discord_id, name)`, index on `deadline`. Other people use a list through `list_members`; the rule for who may touch a list lives in `packages/shared/src/db/access.js` (owner, or a member with a role that is enough; anyone else gets NOT_FOUND).

### `items`

`id` PK · `list_id` FK → `lists(id)` CASCADE · `name` VARCHAR(200) · `description` TEXT · `completed` BOOLEAN · `xp_awarded` BOOLEAN (completion XP already paid) · `completed_at` DATETIME · `position` INT · `due_date` DATE · `priority` ENUM(LOW, MEDIUM, HIGH) · `tags` VARCHAR(255) (lower-case, comma separated, max 5) · `recurrence` ENUM(daily, weekly, monthly) · `parent_id` INT → `items(id)` CASCADE (subtask of; one level) · `first_completed_at` DATETIME and `first_completed_high` TINYINT (set once, when completion XP is first paid; quests count these, never `completed_at`) · `first_completed_early` / `first_completed_overdue` TINYINT NULL (whether that first completion was before / after the due date; NULL without a due date) · `habit_streak` INT (consecutive on-time completions of a repeating task, copied to each spawned copy) · `counts_for_quests` TINYINT (0 for imported and auto-spawned recurring rows) · `repeat_anchor_day` TINYINT (day of month a monthly repeat returns to) · `reminded_at` DATETIME (the due-day DM was sent) · `remind_at` DATETIME (snooze) · `created_by`, `completed_by`, `first_completed_by` VARCHAR(32) NULL (the **actor** of each event; quests, the weekly review, stats and the daily caps count a person's own actions, whoever owns the list; backfilled from the list owner by migration `018`; never sent to a client, which sees only `completed_by_name`) · `created_at` · `updated_at` (auto-updated).

Indexes `(list_id, position)`, `(parent_id)`, `(due_date)`, `(created_by, created_at)`, `(completed_by, completed_at)`, `(first_completed_by, first_completed_at)`. Positions are kept unique and contiguous (0..n-1) by `moveItem` / `reorderItems`. A row whose actor column is NULL (written by a script that skipped it) counts for its list's owner in every metric (`actorSql`).

### `list_members`

`list_id` FK → `lists(id)` CASCADE · `discord_id` FK → `users` CASCADE · `role` ENUM(viewer, editor, manager) · `public_id` CHAR(12) UNIQUE (random; the opaque member key the API uses, so a Discord ID never reaches another member) · `added_by` · `created_at`. Primary key `(list_id, discord_id)`. The owner has **no row** (an implicit manager). At most 10 rows plus pending invitations per list (`LIMITS.MAX_LIST_MEMBERS`).

### `list_invites`

`id` · `list_id` FK CASCADE · `invitee_discord_id` FK CASCADE · `role` · `invited_by` · `created_at` · `expires_at` DATETIME (7 days) · `status` ENUM(pending, accepted, declined, revoked). One live pending invitation per list and person is enforced by the service under the list's row lock (MariaDB has no partial unique index); an expired pending row is treated as not pending and is marked `revoked` when the person is invited again. Index `(invited_by, created_at)` serves the 30-invitations-a-day limit.

### `list_reminders` and `item_reminders`

A member's own reminder state, so each member is reminded once: `list_reminders(list_id, discord_id, deadline_notified, overdue_notified, remind_at)` and `item_reminders(item_id, discord_id, reminded_at, remind_at)`, both primary-keyed by the pair and cascading. The owner's state stays on `lists` / `items`. Rows are created lazily, removed when a member leaves, and `list_reminders` is cleared when the list's deadline changes.

### `parties`, `party_members`, `party_invites`

`parties(id, name VARCHAR(40), owner_id FK, created_at)` with a unique key `(owner_id, name)`. `party_members(party_id FK CASCADE, discord_id FK CASCADE, joined_at)`, primary key `(party_id, discord_id)` plus **UNIQUE `(discord_id)`**: one party per user, enforced by the database; the owner is a member too (at most 6, `LIMITS.MAX_PARTY_MEMBERS`). `party_invites` mirrors `list_invites` without a role. The weekly party quest has no table of its own: progress is derived from `items.first_completed_by`, and a claim is a `quest_claims` row with `quest_key = 'PARTY_<partyId>'` and the UTC week's Monday as `period_start` (the service allows one `PARTY_` claim per person per week). A progress reset removes the user's memberships and invitations, and disbands a party they own.

### `achievements`

`id` · `discord_id` FK · `achievement_key` VARCHAR(50) · `unlocked_at`. Unique key `(discord_id, achievement_key)`.

### `user_skills`

`id` · `discord_id` FK · `skill_id` VARCHAR(50) · `skill_level` INT · `unlocked_at`. Unique key `(discord_id, skill_id)`.

### `game_sessions`

| Column | Notes |
|---|---|
| `id`, `discord_id` FK | |
| `game_type` | `blackjack`, `rps`, `hangman`, `snake`, `dino`, `invaders` |
| `bet_amount` BIGINT | Escrowed bet. It doubles after a double down. |
| `state` VARCHAR(20) | See [states](#game-session-states) |
| `game_data` JSON | Engine state (deck/hands, word/guesses, arcade score). Never sent to clients raw. |
| `payout` BIGINT | Gross XP returned to the player, so net = `payout − bet_amount` |
| `created_at` TIMESTAMP(3), `ended_at` | |

Indexes `(discord_id, state, game_type)` and `(state, created_at)`.

### `xp_transactions`

`id` · `discord_id` FK · `amount` BIGINT (signed) · `source` VARCHAR(50) · `balance_before` · `balance_after` · `reference_id` (list, item or session ID) · `created_at`.

Indexes `(discord_id, created_at)` and `(discord_id, source, created_at)`. The second one is used by the daily caps.

### `quest_claims`

`id` · `discord_id` FK · `quest_key` VARCHAR(50) · `period_start` DATE · `reward_xp` INT · `claimed_at`. The unique key `(discord_id, quest_key, period_start)` is what makes a claim atomic: two clicks cannot both insert, so a quest pays once per period. Quest *progress* is not stored; it is computed from `items` (`first_completed_at`, `first_completed_high`, `counts_for_quests`, `created_at`) and `xp_transactions`.

The weekly review claim is stored here too, under `quest_key = 'WEEKLY_REVIEW'` with the week's Monday as `period_start`.

### `focus_sessions`

`id` · `discord_id` FK · `started_at` DATETIME · `minutes_planned` INT · `state` VARCHAR(12) (`active`, `finished`, `cancelled`, `expired`) · `finished_at` DATETIME · `minutes_credited` INT (what the server measured and credited) · `xp` INT (what was paid). Indexes `(discord_id, state)` and `(discord_id, finished_at)`. At most one row per user is `active`.

### `task_templates`

`id` · `discord_id` FK (cascade) · `name` VARCHAR(100) · `description` TEXT · `items` JSON (array of `{name, description?, priority?, tags?, recurrence?}`, at most 30; MariaDB stores it as text) · `created_at`. Unique key `(discord_id, name)`. At most 20 per user (`LIMITS.MAX_TEMPLATES_PER_USER`), enforced by the service under the user row lock. A progress reset deletes them with the quests. Applying a template uses the normal quest and task creation, so nothing about XP is stored here.

### `user_cosmetics`

`id` · `discord_id` FK (cascade) · `cosmetic_id` VARCHAR(40) (a key of `COSMETICS` in `constants.js`) · `acquired_at`. Unique key `(discord_id, cosmetic_id)`, so a cosmetic is owned once. Rows are inserted in the same transaction as the XP debit (`cosmetic_purchase`), under the user row lock. Prestige keeps them; a progress reset deletes them.

### `push_subscriptions`

`id` · `discord_id` FK (cascade) · `endpoint` TEXT (the push service URL, at most 2048 characters) · `endpoint_hash` CHAR(64) (SHA-256 of the endpoint; the unique key, since a TEXT column cannot be indexed whole) · `p256dh`, `auth` VARCHAR(255) (the browser's keys) · `created_at` · `last_used_at`. Index `(discord_id)`. At most 10 per user, enforced by the service under the user row lock. A subscription that answers 404 or 410 when a push is sent is deleted.

### `web_sessions`

`session_id` VARCHAR(128) PK · `expires` INT UNSIGNED (unix seconds) · `data` MEDIUMTEXT (JSON). This holds web login sessions. Expired rows are purged every 15 minutes.

### AI tables (migration `003_ai`)

Used only by the AI service (see [AI_INTEGRATION.md](AI_INTEGRATION.md)). All user-owned rows cascade-delete with the user.

| Table | Purpose |
|---|---|
| `ai_embeddings` | RAG vectors, one row per chunk: `discord_id` (NULL = global docs), `source_type` (`list`/`item`/`history`/`doc`), `source_id`, `list_id`, `content`, `content_hash` (SHA-256, skips unchanged text), `embedding` (float32 BLOB), `model`. Unique on `(source_type, source_id, model)`. |
| `ai_chat_threads` | Chat conversations: `id` (UUID, also the LangGraph `thread_id`), `discord_id`, `title`, `source` (`web` for web chat threads, `discord` for per-user, per-channel Discord memory; migration 005). |
| `ai_checkpoints`, `ai_checkpoint_writes` | LangGraph state snapshots per thread. |
| `ai_usage` | Daily per-user, per-feature request and token counts, used for quotas. |
| `ai_summary_cache` | Cached summaries keyed by `(discord_id, scope_key)` with an input hash. |

`users.ai_enabled` (TINYINT, default 1) lets a user opt out of AI features.

### `schema_migrations`

`id` VARCHAR(100) PK · `applied_at`.

## XP transaction sources

| Source | Sign | Meaning |
|---|---|---|
| `list_create`, `item_add`, `item_complete` | + | Task rewards |
| `daily` | + | Daily reward |
| `first_of_day`, `list_cleared`, `early_finish`, `overdue_clear`, `subtasks_done`, `habit_bonus` | + | Flat bonuses on a task's first completion (capped, see GAMEPLAY 5c) |
| `streak_chest`, `achievement_reward`, `focus_session`, `weekly_review`, `party_quest` | + | Flat bonuses from streaks, achievements, focus sessions, the weekly review and the party quest |
| `prestige` | − | The balance leaving at a prestige (not spending: `xp_spent` is unchanged) |
| `game_reward` | + | RPS, Hangman and arcade winnings. These count toward the free-game daily cap. |
| `blackjack_bet` | − | Bet escrow (and double down) |
| `blackjack_win`, `blackjack_blackjack` | + | Bet returned plus boosted winnings |
| `blackjack_push`, `blackjack_refund` | + | Bet returned (push or expired hand). Not lifetime XP. |
| `class_purchase`, `skill_purchase`, `streak_freeze`, `cosmetic_purchase` | − | Spending (counted in `xp_spent`) |
| *legacy* `blackjack_loss`, `task_complete`, `item_create`, `manual` | ± | Written by pre-4.0 versions |

## Game session states

`active` → `won` · `lost` · `push` · `blackjack` · `expired` (timed out; bets refunded) · `cancelled` (quit, replaced by a new game, or an implausible arcade score).

## Automation queries

**Deadline reminders** (`tasks.getReminderCandidates`): a deliberately wide net of lists that might need a message (snoozes that have ended, and lists due within the next day or the last 14 that still owe a due or overdue notice, for owners with `automation_enabled`). The bot then decides per user in their own time zone and at their `reminder_hour` (`decideReminder`): a *due* reminder on the deadline day (or up to 3 days late), one *overdue* notice the day after if tasks are still open, and a *snooze* reminder when `remind_at` passes. `deadline_notified` / `overdue_notified` are set only after the DM was sent or can never be sent (DMs closed, unknown user); other errors retry on the next hourly run. Changing a list's deadline resets `deadline_notified`, `overdue_notified` and `remind_at`.

**Task reminders** (`tasks.getTaskReminderCandidates`): open tasks with their own `due_date` (due within the next day or the last 14 days and not yet `reminded_at`, or whose `remind_at` snooze has ended) for owners with `automation_enabled`. A task due on the same day as its list's `deadline` is left to the list reminder. `decideTaskReminder` in the bot applies the owner's zone and `reminder_hour`; `markTaskReminderSent` sets `reminded_at` and clears `remind_at`, and `snoozeTask` sets `remind_at`. Changing a task's due date clears both.

**Old-list clean-up** (`tasks.cleanupOldLists`, 5 days by default). It deletes lists of users with `auto_delete_old_lists = TRUE` when the list has items, all completed, and the latest item change is more than 5 days old. Each list is locked and re-checked inside a transaction right before it is deleted, so a task added after the scan saves the list. Unfinished lists are never deleted, whatever their deadline. The function returns the deleted `{id, discord_id}` rows so the bot can drop their AI vectors.

## Connection settings

See [`packages/shared/src/db/pool.js`](../packages/shared/src/db/pool.js):

- **Sessions run in UTC.** `timezone: 'Z'` plus `SET time_zone = '+00:00'` on every connection.
- **Days are per user, not per session.** Sessions stay UTC, but every "today", week and month is a `[from, to)` pair of instants computed in JS from `users.timezone` (`packages/shared/src/tz.js`) and bound as parameters: daily caps and the focus count read `xp_transactions` / `focus_sessions` in that window, quest and review claims store the local date of the period start in `quest_claims.period_start`, and stats group 15-minute buckets into local days in JS. The weekly leaderboard is the exception: one global UTC week.
- **DATE columns are strings.** They come back as `'YYYY-MM-DD'`, which avoids timezone day-shifts.
- **Large BIGINTs stay exact.** `supportBigNumbers` is on, so values beyond 2^53 return as strings instead of losing precision.
- **TLS applies to `DB_URL` too.** `DB_SSL=true` enables it, and `DB_SSL_CA` supplies a PEM bundle. Certificate verification stays on unless `DB_SSL_REJECT_UNAUTHORIZED=false`, which logs a warning.

## Backups and maintenance

- Take a `mysqldump --single-transaction --routines taskquest` before upgrades.
- `xp_transactions` grows without bound. Archive rows older than the retention window you need. Only today's rows are used by caps, and the last 50 by the history view.
- `game_sessions` can be pruned the same way. Achievement checks count finished games, so archive into a summary table if you need lifetime game stats.
