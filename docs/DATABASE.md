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
npm run db:migrate          # uses apps' .env-style variables from the current shell / .env
```

Both apps also run pending migrations on startup unless `MIGRATE_ON_START=false`, in which case they refuse to start if the schema is behind.

- Applied migrations are recorded in `schema_migrations (id, applied_at)`.
- A MySQL named lock (`taskquest_migrations`) stops two processes migrating at the same time.
- Migrations are JavaScript, not raw SQL. They check `information_schema` before every change, so they are idempotent and work on both MySQL 8 and MariaDB. The two disagree on syntax such as `ADD COLUMN IF NOT EXISTS`.

| Migration | Purpose |
|---|---|
| `001_initial_schema` | Creates every table for a fresh database (`CREATE TABLE IF NOT EXISTS`) |
| `002_upgrade_legacy` | Brings databases from older releases up to the 001 schema (see below). Does nothing on a fresh database. |

To add a migration, create `packages/shared/src/db/migrations/003_<name>.js` exporting `description` and `async up(h)`. Use the helpers on `h`: `exec`, `tableExists`, `columnExists`, `columnInfo`, `indexExists`, `addColumnIfMissing`, `addIndexIfMissing`, `addForeignKeyIfMissing`. Never edit a migration that has already been released.

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
| `lifetime_xp` | BIGINT | Total ever earned. Drives the level and XP achievements. |
| `player_level` | BIGINT | ⌊lifetime_xp / 100⌋ + 1 (kept in sync by `applyXP`) |
| `player_class` | ENUM(DEFAULT, HERO, GAMBLER, ASSASSIN, WIZARD, ARCHER, TANK) | Equipped class |
| `gamification_enabled`, `automation_enabled`, `auto_delete_old_lists` | BOOLEAN | Settings (default on) |
| `streak_count`, `last_daily_claim`, `last_active_day` | INT / DATETIME / DATE | Daily reward |
| `last_game_at` | DATETIME(3) | Free-game cooldown |
| `owns_hero` … `owns_tank` | BOOLEAN | Class ownership |
| `assassin_streak`, `assassin_stacks`, `wizard_counter`, `archer_streak`, `tank_stacks` | INT | Class counters, reset when switching class |
| `total_lists_created`, `total_items_added`, `total_items_completed` | INT | Monotonic counters for achievements |
| `skill_points` | INT | Legacy. Unused, kept for compatibility. |
| `created_at` | TIMESTAMP | |

Index: `(gamification_enabled, player_xp)` for the leaderboard.

### `lists`

`id` PK · `discord_id` FK · `name` VARCHAR(100) · `description` TEXT · `category` VARCHAR(50) · `deadline` DATE · `priority` ENUM(LOW, MEDIUM, HIGH) · `deadline_notified` BOOLEAN · `created_at`.

Unique key `(discord_id, name)`, index on `deadline`.

### `items`

`id` PK · `list_id` FK → `lists(id)` CASCADE · `name` VARCHAR(200) · `description` TEXT · `completed` BOOLEAN · `xp_awarded` BOOLEAN (completion XP already paid) · `completed_at` DATETIME · `position` INT · `created_at` · `updated_at` (auto-updated).

Index `(list_id, position)`.

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

### `web_sessions`

`session_id` VARCHAR(128) PK · `expires` INT UNSIGNED (unix seconds) · `data` MEDIUMTEXT (JSON). This holds web login sessions. Expired rows are purged every 15 minutes.

### `schema_migrations`

`id` VARCHAR(100) PK · `applied_at`.

## XP transaction sources

| Source | Sign | Meaning |
|---|---|---|
| `list_create`, `item_add`, `item_complete` | + | Task rewards |
| `daily` | + | Daily reward |
| `game_reward` | + | RPS, Hangman and arcade winnings. These count toward the free-game daily cap. |
| `blackjack_bet` | − | Bet escrow (and double down) |
| `blackjack_win`, `blackjack_blackjack` | + | Bet returned plus boosted winnings |
| `blackjack_push`, `blackjack_refund` | + | Bet returned (push or expired hand). Not lifetime XP. |
| `class_purchase`, `skill_purchase` | − | Spending |
| *legacy* `blackjack_loss`, `task_complete`, `item_create`, `manual` | ± | Written by pre-4.0 versions |

## Game session states

`active` → `won` · `lost` · `push` · `blackjack` · `expired` (timed out; bets refunded) · `cancelled` (quit, replaced by a new game, or an implausible arcade score).

## Automation queries

**Deadline reminders** (`tasks.getListsDueOn`): lists with `deadline = today (UTC)`, `deadline_notified = FALSE`, and an owner with `automation_enabled`.

**Old-list clean-up** (`tasks.cleanupOldLists`, 5 days by default). This is a single statement that deletes lists of users with `auto_delete_old_lists = TRUE` when either:

- the list has items, all completed, and the latest item change is more than 5 days old, or
- the deadline passed more than 5 days ago and the list has no items or unfinished items.

## Connection settings

See [`packages/shared/src/db/pool.js`](../packages/shared/src/db/pool.js):

- **Sessions run in UTC.** `timezone: 'Z'` plus `SET time_zone = '+00:00'` on every connection.
- **DATE columns are strings.** They come back as `'YYYY-MM-DD'`, which avoids timezone day-shifts.
- **Large BIGINTs stay exact.** `supportBigNumbers` is on, so values beyond 2^53 return as strings instead of losing precision.
- **TLS applies to `DB_URL` too.** `DB_SSL=true` enables it, and `DB_SSL_CA` supplies a PEM bundle. Certificate verification stays on unless `DB_SSL_REJECT_UNAUTHORIZED=false`, which logs a warning.

## Backups and maintenance

- Take a `mysqldump --single-transaction --routines taskquest` before upgrades.
- `xp_transactions` grows without bound. Archive rows older than the retention window you need. Only today's rows are used by caps, and the last 50 by the history view.
- `game_sessions` can be pruned the same way. Achievement checks count finished games, so archive into a summary table if you need lifetime game stats.
