# Architecture

This document describes how the TaskQuest Bot is put together: processes, modules, startup, interaction routing, state, and how XP moves through the system. For what the product does, see [PRD.md](PRD.md). For the command surface, see [COMMANDS.md](COMMANDS.md).

## 1. System context

```
   Discord users
        │  slash commands, buttons, select menus, modals
        ▼
┌────────────────────────────────────┐        ┌──────────────────────────┐
│ TaskQuest Bot process (Node.js)    │ MySQL  │ MySQL / TiDB Cloud /     │
│  discord.js client                 │◄──────►│ MariaDB                  │
│  command + utils modules           │  pool  │ (users, lists, items,    │
│  timers (reminders, cleanup, TTL)  │        │  game_sessions, ...)     │
│  HTTP status server (PORT)         │        └──────────────────────────┘
└────────────────────────────────────┘
        ▲
        │ GET /  (JSON status, used by Render keep-alive pings)
   Platform health / uptime checks
```

The bot is a single Node.js process. It holds one Discord gateway connection, one HTTP server, and one MySQL connection pool. Nothing is clustered or sharded.

## 2. Module map

| Path | Responsibility | Imports |
|---|---|---|
| `index.js` | Process entry point. Creates the Discord client and HTTP server, registers timers, routes every interaction. | `database/db`, `commands/*`, `utils/games/sessionManager` |
| `deploy-commands.js` | One-off script that registers slash commands with Discord's REST API. Not loaded at runtime. | `discord.js` REST |
| `commands/list.js` | `/list` and every list and item interaction: buttons, selects, modals, autocomplete support. | `database/db`, `utils/ui`, `utils/gameLogic` |
| `commands/game.js` | `/game` and all three mini-games. | `utils/games/*`, `utils/ui`, `utils/gameLogic` |
| `commands/gamification.js` | Gamification commands (`/ping`, `/daily`, `/automation`, `/profile`, `/achievements`, `/class`, `/leaderboard`, `/toggle`, `/help`, `/app`) and class and skill interactions. | `database/db`, `utils/ui`, `utils/gameLogic` |
| `database/db.js` | Connection pool, schema creation and migrations, all query helpers grouped by domain. | `mysql2/promise` |
| `database/schema.sql` | Reference schema with foreign keys, indexes and tables the bot does not auto-create. Applied manually. | none |
| `utils/gameLogic.js` | Class definitions and costs, skill trees, XP formulas, achievement definitions and checks, streak helper. | none |
| `utils/gamification.js` | A near-duplicate of `commands/gamification.js` that `index.js` does not import. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md). | `utils/ui`, `utils/gameLogic` |
| `utils/ui.js` | Builders for embeds, buttons, select menus, colours and emoji. No database access. | `discord.js` |
| `utils/games/deck.js` | Card deck, hand values, dealer play and outcome logic. | none |
| `utils/games/sessionManager.js` | Creates, reads, updates and ends game sessions. Expires stale sessions. | `database/db` |
| `utils/games/xpTransaction.js` | Applies XP changes inside a locked transaction and writes an audit row. | `database/db` |

Dependencies point inward: commands call utils and the database. Utils other than `games/` do not reach into commands. The database layer does not know about Discord.

## 3. Process startup

The order below comes from `index.js`.

1. **Environment.** `dotenv` loads `.env`. If `DISCORD_TOKEN` is missing, the process logs an error and exits with code 1.
2. **HTTP status server.** Starts on `PORT` (default 3000). Every request returns JSON `{ status: "online", bot: "TaskQuest", version, uptime }`. It does not check the database or Discord.
3. **Discord client.** Created with the `Guilds`, `GuildMembers` and `DirectMessages` intents, and the `Channel` partial. Event handlers are registered.
4. **Login.** `client.login(DISCORD_TOKEN)`.
5. **Ready handler.** When Discord reports the client ready:
   1. `db.initializeDatabase()` creates missing tables and runs migrations. Failure is logged and the bot keeps running.
   2. `sessionManager.expireOldSessions()` runs once.
   3. Presence is set to "Playing /game".
   4. Timers start (see section 6).

Database initialisation happens after login, not before. A database outage at startup therefore leaves the bot online but unable to answer data requests.

## 4. Interaction routing

All interactions arrive at one `InteractionCreate` listener in `index.js`. The listener is wrapped in a try/catch. On error it logs the stack and tries to send an ephemeral "An error occurred" reply, using `followUp` or `reply` depending on state.

Routing is by interaction kind, then by `customId` prefix or exact match.

```
InteractionCreate
├── autocomplete            → list names for /list (option `name`), max 25, case-insensitive contains
├── chatInput command
│   ├── list                → commands/list.execute
│   ├── game                → commands/game.execute
│   ├── ping, daily, automation, profile, achievements,
│   │   class (as classShop), leaderboard, toggle, help, app
│   │                       → commands/gamification
├── button
│   ├── list-owned ids      → list.handleButton
│   │   (sort_*, filter_*, search_, refresh_, edit_, view_, item_*, list_*,
│   │    rename_, yes_, no_, metadone_, create, back)
│   ├── class/skill ids     → gamification.handleClassButton
│   │   (cbuy_, ceq_, cx_, class_*, skill_*)
│   ├── ach_*               → gamification.handleAchievementPagination
│   ├── bj_bet_custom       → game.handleButtonNoDefer  (must show a modal, so no deferral)
│   ├── bj_*, game_*, rps_*, hm_* → game.handleButton
│   └── anything else       → "Button expired or unknown"
├── select menu
│   ├── game_select         → game.handleSelectMenu
│   ├── hm_letter_select    → game.handleHangmanSelect
│   ├── class_select, skill_select → gamification
│   └── anything else       → list.handleSelectMenu
└── modal submit
    ├── bj_bet_modal        → game.handleModal
    └── anything else       → list.handleModal
```

Note: the `class_select` and `skill_select` branches are reached only if the menu IDs match. Several list interactions are routed by prefix, so new `customId`s need to be added to the matching prefix list.

## 5. Interaction response pattern

Discord requires a response within three seconds. Each handler picks one of three patterns:

| Pattern | Used by | Why |
|---|---|---|
| Immediate `reply` | Most list views, `/profile`, `/help`, `/ping` | Fast, no database work, or database work quick enough. |
| `deferReply` (ephemeral) then `editReply` | `/game`, game buttons and selects | Database round-trips to TiDB Cloud can exceed three seconds. |
| `deferUpdate` then `editReply` | Game button and select handlers | Updates the existing message in place. |

`handleButtonNoDefer` in `game.js` is the exception. Showing a modal is the response, so the handler must not defer first.

## 6. Timers and background work

| Job | Starts | Interval | What it does | Source |
|---|---|---|---|---|
| Deadline reminders | 5 seconds after ready | Hourly | Finds lists due on the UTC date with `deadline_notified = FALSE` for users with automation on. Sends one DM per list, then marks it notified. | `index.js` `checkDeadlines`, `db.getListsDueToday`, `db.markDeadlineNotified` |
| Old list cleanup | 10 seconds after ready | Every 24 hours | Deletes lists that meet the cleanup rules, for users with `auto_delete_old_lists` on. See [DATABASE.md](DATABASE.md#list-cleanup-rules). | `index.js` `cleanupOldLists`, `db.cleanupOldLists` |
| Game session expiry | At ready, then every 15 minutes | 15 minutes | Sets `state = 'expired'` on active sessions older than 30 minutes. | `sessionManager.expireOldSessions` |

Timers are plain `setInterval` and `setTimeout` calls, so they stop when the process stops. There is no persistent job queue.

## 7. State

### 7.1 Durable state (MySQL)

Everything that must survive a restart lives in the database:

- Users, their XP, level, class, owned classes, streak, last daily claim and settings.
- Lists and items.
- Achievements and unlocked skills.
- Game sessions, including active Blackjack hands.
- The XP transaction log.

### 7.2 In-memory state

These maps live in the process. They are lost on restart.

| Map | Owner | Holds | Effect of loss |
|---|---|---|---|
| `pageState` | `gamification.js` | Current page of `/achievements` per user | Pagination resets to page 1 |
| `classViewState` | `gamification.js` | Which class is shown in the class browser | Browser reopens on DEFAULT |
| `swapState` | `list.js` | First item picked in an item swap, keyed by user and list | The swap prompt shows "Expired" |
| `hangmanGames` | `game.js` | Active Hangman game per user | Game is gone; the player must start again |

List mode (VIEW or EDIT) is not stored in memory. It is encoded in each button's `customId`, so a list screen keeps working after a restart.

The Blackjack session is durable because `sessionManager` stores it in `game_sessions` and `blackjack_hands`. Hangman is not.

## 8. The list state machine

`commands/list.js` treats a list as being in one of two modes:

```
          sel_list / open list
   ┌──────────────────────────────┐
   │             VIEW             │  read-only: sorts, search, refresh
   └──────────────┬───────────────┘
                  │ edit_<listId>
                  ▼
   ┌──────────────────────────────┐
   │             EDIT             │  add, edit, delete, complete, reorder,
   │                              │  category, priority, rename, delete list
   └──────────────┬───────────────┘
                  │ view_<listId>
                  ▼
                VIEW
```

The overview (all lists) is a third screen with filters, sorts, and a create button. Each screen is re-rendered in place with `editReply` or `update`.

## 9. XP flow

Two paths change XP. Both end in the same `users.player_xp` column.

### 9.1 Locked transactions (games)

`utils/games/xpTransaction.js` `processXPTransaction(userId, amount, source, referenceId)`:

1. Takes a connection from the pool and starts a transaction.
2. `SELECT ... FOR UPDATE` on the user row. Rejects an unknown user.
3. Rejects the change if the resulting balance would be negative.
4. Updates `player_xp` and inserts an `xp_transactions` row with the balance before and after.
5. Commits. On error it rolls back and rethrows. The connection is always released.

Game payouts and bets use this path. It has no idempotency key, so a retried call writes a second row.

### 9.2 Direct updates (lists, daily, classes, skills)

List actions, `/daily`, and class and skill purchases compute the new XP in memory and write it with `db.updateUser`. These writes are not transactional and do not take a row lock. Two concurrent actions from one user can overwrite each other's XP. The `/daily` path also writes an `xp_transactions` row, but not through `processXPTransaction`.

Level is computed as `floor(XP / 100) + 1` when shown. Spending XP does not update the stored `player_level`.

## 10. Gamification calculation

For list actions and `/daily`, the base XP is passed through `calculateFinalXP(user, skills, base)` in `utils/gameLogic.js`. It returns the final XP, a bonus breakdown, and any class counter updates. The counters are saved with `db.updateUser`. After XP is awarded, the code calls `checkAchievements` (see [KNOWN_ISSUES.md](KNOWN_ISSUES.md) for the signature mismatch).

Formulas are in [GAMEPLAY.md](GAMEPLAY.md).

## 11. Rendering

`utils/ui.js` builds every embed, button row, select menu and modal reference. It does not query the database. Callers pass in data and receive Discord builders. This keeps display changes separate from data changes.

Colours and emoji are defined as constants at the top of the file. Priority colours, class colours and skill state colours are all in one place.

## 12. Error handling and shutdown

- **Interaction errors.** Caught in the top-level listener, logged with stack, and reported to the user as ephemeral text.
- **Unhandled promise rejections.** Logged. The process continues.
- **Uncaught exceptions.** Logged, then the process exits after one second.
- **Graceful shutdown.** Handled only for `SIGINT`. The handler closes the database pool, closes the HTTP server, destroys the Discord client and exits with code 0.
- **Render shutdown.** Render sends `SIGTERM`, which is not handled. The process ends without closing the pool. See [DEPLOYMENT.md](DEPLOYMENT.md#7-shutdown).

## 13. Logging

Logging goes through a small `log(emoji, category, message)` helper in `index.js` that prints a timestamp. `LOG_LEVEL` is documented in `.env.example` but is not read. Logs have no levels and no structured output.

## 14. Dependencies

| Package | Version range | Purpose |
|---|---|---|
| `discord.js` | `^14.14.1` | Gateway, REST, builders |
| `mysql2` | `^3.6.5` | MySQL driver and pool |
| `dotenv` | `^16.3.1` | Environment loading |

Node.js 18 or later is required by `engines` in `package.json`. The current code uses `node --watch` in the `dev` script, which needs Node 18.11 or later.

## 15. Known architectural limits

- One process. No horizontal scaling.
- Several state maps are in memory and lost on restart.
- Database initialisation runs after login. A failed initialisation does not stop the bot from accepting interactions that then fail.
- Shutdown is not graceful on the platform the repository targets.
- Two copies of the gamification command logic exist, and only one is loaded.
- The list cleanup job loops over lists with several queries each, which does not scale to large user counts.

Each of these is listed with its file reference in [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
