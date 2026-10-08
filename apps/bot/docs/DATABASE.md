# Database

TaskQuest stores everything in MySQL-compatible storage. It targets MySQL 8, MariaDB and TiDB Cloud. The bot creates tables on startup, and `database/schema.sql` provides the complete reference.

- Connection and query helpers: `database/db.js`
- Reference schema: `database/schema.sql`
- Session and transaction code: `utils/games/sessionManager.js`, `utils/games/xpTransaction.js`

## Auto-created versus schema.sql

The bot runs `CREATE TABLE IF NOT EXISTS` for seven tables on startup. Some things it does not create, and some columns differ. The two sources are not identical.

| Area | Auto-created (`db.js`) | `schema.sql` |
|---|---|---|
| Tables | `users`, `lists`, `items`, `achievements`, `user_skills`, `game_sessions`, `xp_transactions` | Those seven, plus `blackjack_hands` |
| Foreign keys | None | `ON DELETE CASCADE` on child tables |
| Secondary indexes | None beyond primary and unique keys | Named indexes (listed in section 4) |
| XP columns | `BIGINT` | `INT` |
| `game_sessions` time column | `created_at` | `started_at` |
| `xp_transactions.source` | Free-form string | ENUM of known sources |
| `game_sessions.game_type` | String | ENUM: `blackjack`, `rps`, `hangman`, `slots` |
| `game_sessions.state` | String, default `active` | ENUM: `active`, `won`, `lost`, `push`, `blackjack`, `expired`, `cancelled` |
| `users.auto_delete_old_lists` | Added by migration | Not present |

**What this means in practice.**

- **Rock-Paper-Scissors, Hangman and daily rewards** work with auto-created tables.
- **Blackjack** needs `blackjack_hands` and `game_sessions.started_at`. Neither is created automatically, so Blackjack fails on a fresh install unless you apply `schema.sql`.
- `sessionManager.js` expires old sessions with `started_at`, so the expiry sweep also needs the `schema.sql` column.

To use the full schema on a new database, run `database/schema.sql` once before starting the bot. Note that it contains `CREATE DATABASE` at the top, so remove that line or select the database first.

## Tables

### `users`

One row per Discord user. Created on first interaction.

| Column | Type | Default | Notes |
|---|---|---|---|
| `discord_id` | VARCHAR(32) | none | Primary key |
| `player_xp` | BIGINT | 0 | The only currency |
| `player_level` | BIGINT | 1 | Not recalculated when XP is spent |
| `player_class` | ENUM | `DEFAULT` | `DEFAULT`, `HERO`, `GAMBLER`, `ASSASSIN`, `WIZARD`, `ARCHER`, `TANK` |
| `gamification_enabled` | BOOLEAN | TRUE | Set by `/toggle` |
| `automation_enabled` | BOOLEAN | TRUE | Set by `/automation` |
| `auto_delete_old_lists` | BOOLEAN | TRUE | Added by migration. No command changes it. |
| `streak_count` | INT | 0 | Daily streak |
| `last_active_day` | DATE | NULL | Used by the calendar-day streak helper |
| `last_daily_claim` | DATETIME | NULL | Cooldown anchor for `/daily` |
| `owns_hero`, `owns_gambler`, `owns_assassin`, `owns_wizard`, `owns_archer`, `owns_tank` | BOOLEAN | FALSE | Class ownership |
| `assassin_streak`, `assassin_stacks` | INT | 0 | Class counters |
| `wizard_counter` | INT | 0 | Class counter |
| `archer_streak` | INT | 0 | Class counter |
| `tank_stacks` | INT | 0 | Class counter |
| `total_items_added` | INT | 0 | Used by achievements |
| `total_items_completed` | INT | 0 | Incremented on each completion; never decremented |
| `total_lists_created` | INT | 0 | Used by achievements |
| `skill_points` | INT | 0 | Not used by the current skill purchase flow |
| `created_at` | TIMESTAMP | now | |

### `lists`

| Column | Type | Notes |
|---|---|---|
| `id` | INT, auto-increment | Primary key |
| `discord_id` | VARCHAR(32) | Owner |
| `name` | VARCHAR(100) | Unique per owner (`UNIQUE (discord_id, name)`) |
| `description` | TEXT | |
| `category` | VARCHAR(50) | Free text. Common values have emoji in the UI. |
| `deadline` | DATE | `YYYY-MM-DD`. Nullable. |
| `priority` | ENUM | `LOW`, `MEDIUM`, `HIGH`, or NULL |
| `deadline_notified` | BOOLEAN | FALSE by default. Reset when the list is edited. |
| `created_at` | TIMESTAMP | |

### `items`

| Column | Type | Notes |
|---|---|---|
| `id` | INT, auto-increment | Primary key |
| `list_id` | INT | The list it belongs to |
| `name` | VARCHAR(200) | |
| `description` | TEXT | |
| `completed` | BOOLEAN | |
| `position` | INT | Order within the list. Max plus one on insert. |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | Added by migration. Updated on every change. |

### `achievements`

| Column | Type | Notes |
|---|---|---|
| `id` | INT, auto-increment | |
| `discord_id` | VARCHAR(32) | |
| `achievement_key` | VARCHAR(50) | Key from `ACHIEVEMENTS` in `gameLogic.js` |
| `unlocked_at` | TIMESTAMP | |

`UNIQUE (discord_id, achievement_key)`. A duplicate insert returns false rather than raising an error.

### `user_skills`

| Column | Type | Notes |
|---|---|---|
| `id` | INT, auto-increment | |
| `discord_id` | VARCHAR(32) | |
| `skill_id` | VARCHAR(50) | Skill key, such as `hero_valor` |
| `skill_level` | INT | Default 1 |
| `unlocked_at` | TIMESTAMP | |

`UNIQUE (discord_id, skill_id)`.

### `game_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | INT, auto-increment | |
| `discord_id` | VARCHAR(32) | |
| `game_type` | VARCHAR(20) | `blackjack`, `rps`, `hangman` (and `slots` in `schema.sql` only) |
| `bet_amount` | BIGINT | Bet taken at start |
| `state` | VARCHAR(20) | `active` by default |
| `game_data` | JSON | Game-specific state |
| `payout` | BIGINT | Set when settled |
| `created_at` | TIMESTAMP | `started_at` in `schema.sql` |
| `ended_at` | TIMESTAMP | Set when settled or expired |

### `blackjack_hands` (schema.sql only)

| Column | Type | Notes |
|---|---|---|
| `session_id` | INT | Unique. Foreign key to `game_sessions`. |
| `player_hand` | JSON | Cards |
| `dealer_hand` | JSON | Cards |
| `deck_state` | JSON | Remaining cards |
| `player_value` | INT | |
| `dealer_value` | INT | |
| `last_action` | VARCHAR(20) | |

### `xp_transactions`

An append-only audit log of XP changes.

| Column | Type | Notes |
|---|---|---|
| `id` | INT, auto-increment | |
| `discord_id` | VARCHAR(32) | |
| `amount` | BIGINT | Positive or negative |
| `source` | VARCHAR(50) | See the list below |
| `balance_before`, `balance_after` | BIGINT | |
| `reference_id` | INT | NULL. Links to a game session, where applicable. |
| `created_at` | TIMESTAMP | |

Sources written by the current code include `daily`, `game_reward`, `blackjack_win`, `blackjack_loss`, `blackjack_push` and `blackjack_blackjack`. The `schema.sql` ENUM also lists `task_complete`, `list_create`, `item_add`, `class_purchase` and `manual`. A search of the code did not find those last values being written, so they may be unused.

## Indexes and foreign keys (schema.sql)

| Table | Index | Columns |
|---|---|---|
| `user_skills` | `idx_discord_skills` | `discord_id` |
| `lists` | `idx_discord` | `discord_id` |
| `lists` | `idx_deadline` | `deadline` |
| `items` | `idx_list` | `list_id` |
| `xp_transactions` | `idx_user_xp` | `discord_id` |
| `xp_transactions` | `idx_source` | `source` |
| `xp_transactions` | `idx_reference` | `reference_id` |
| `game_sessions` | `idx_user_game` | `discord_id`, `game_type` |
| `game_sessions` | `idx_state` | `state` |
| `game_sessions` | `idx_active` | `discord_id`, `state` |

`schema.sql` also has a block of Blackjack indexes near the end of the file. `achievements` has no index beyond its unique key.

Foreign keys with `ON DELETE CASCADE` link `user_skills`, `lists`, `achievements`, `xp_transactions`, `game_sessions` and `blackjack_hands` to their parents, and `items` to `lists`. Auto-created tables have no foreign keys.

## Migrations

On each start, `db.js` runs a few statements inside try/catch blocks:

- `ADD COLUMN IF NOT EXISTS` for `users.auto_delete_old_lists` and `items.updated_at`. This syntax exists in MariaDB and TiDB but not in MySQL 8, so on MySQL 8 these migrations fail silently and the columns are missing.
- `MODIFY` on the XP and level columns to `BIGINT`. This runs on every boot.

Errors in migrations are swallowed. Check the logs if a column seems to be missing.

## Data-access API (db.js)

Functions are grouped by domain. Each helper runs its own statement and does not share a transaction, except `xpTransaction.js`, which has its own locked transaction.

| Domain | Functions |
|---|---|
| Pool and setup | `getPool`, `initializeDatabase`, `closePool` |
| Users | `getUser`, `createUser` (INSERT IGNORE), `getOrCreateUser`, `updateUser`, `toggleAutomation`, `toggleGamification`, `getGameStats`, `getLeaderboard` |
| Deadlines | `getListsDueToday`, `markDeadlineNotified` |
| Lists | `createList`, `getLists`, `getListByName`, `getListById`, `updateList`, `deleteList`, `searchLists`, `getListStats` |
| Items | `addItem`, `getItems`, `getItemById`, `updateItem`, `deleteItem`, `toggleItemComplete`, `swapItemPositions` |
| Achievements | `getAchievements`, `unlockAchievement` |
| Skills | `getUserSkills`, `hasSkill`, `unlockSkill`, `upgradeSkill`, `addSkillPoints` |
| Games | `recordGameResult` |
| Stats | `getUserStats` |
| Maintenance | `cleanupOldLists` |

Notable behaviour:

- `getPool` uses `DB_URL` if set. Otherwise it uses the individual `DB_*` values, with a connection limit of 10.
- SSL is enabled only when `DB_SSL` is `true`. Certificates are verified unless `DB_SSL_REJECT_UNAUTHORIZED` is `false`.
- `DB_POOL_SIZE` and `DB_TIMEZONE` from `.env.example` are not read.
- `createList` increments `total_lists_created`.
- `addItem` increments `total_items_added`.
- `toggleItemComplete` increments `total_items_completed` when an item becomes complete, and does not decrement it when the item becomes incomplete.
- `getLists` sorts on a whitelist of columns, so the sort parameter cannot inject SQL.
- `searchLists` queries a `notes` column that does not exist in either schema. Searches with this function will fail. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
- `recordGameResult(discordId, gameType, state, xpGained, betAmount)` inserts a `game_sessions` row. Payout is the bet plus XP gained for a win or blackjack, the bet for a push, and zero for a loss.
- `getLeaderboard(limit)` returns users with gamification enabled, ordered by XP.
- `getUserStats` runs several queries. The leaderboard calls it once per entry, which is an N+1 pattern.

## Transactions

Only `processXPTransaction` in `utils/games/xpTransaction.js` uses a transaction. It locks the user row with `SELECT ... FOR UPDATE`, updates `player_xp`, inserts an audit row, and commits. Other XP writes use plain updates.

## Session expiry

`sessionManager.expireOldSessions` sets `state = 'expired'` on active sessions older than 30 minutes. It runs at startup and every 15 minutes. It does not refund bets. Expired sessions count as losses in `getUserStats`.

Only one active session per user and game type is intended. The check is a SELECT followed by an INSERT with no unique constraint, so two concurrent `/game` calls can create two sessions.

## List cleanup rules

Old list cleanup runs every 24 hours for users with `auto_delete_old_lists` set. The default is on, and no command changes it.

A list is deleted when either:

1. Every item is complete, and the oldest item `updated_at` is at least 5 days old.
2. The list deadline is at least 5 days in the past, and the list has incomplete items or no items.

Lists with no deadline and no items are never deleted. Each list costs several queries, so the job scales poorly with many users.

## Reminder query

The hourly reminder job calls `getListsDueToday`, which selects lists where `deadline` equals the current UTC date, `deadline_notified` is FALSE, and the owner has `automation_enabled`. Each list is then marked with `markDeadlineNotified`.
