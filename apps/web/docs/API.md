# TaskQuest API Reference

Base URL: the value of `VITE_API_URL` on the frontend, or `http://localhost:3001` locally. Every path below starts with `/api`.

This document covers v1.5 as implemented in `server/index.js`. For the game rules behind the XP values in responses, see [GAME_MECHANICS.md](GAME_MECHANICS.md).

---

## Contents

1. [Conventions](#1-conventions)
2. [Authentication and sessions](#2-authentication-and-sessions)
3. [Auth endpoints](#3-auth-endpoints)
4. [User endpoints](#4-user-endpoints)
5. [Lists and items](#5-lists-and-items)
6. [Classes](#6-classes)
7. [Skills](#7-skills)
8. [Achievements](#8-achievements)
9. [Games](#9-games)
10. [Leaderboard](#10-leaderboard)
11. [XP history](#11-xp-history)
12. [Static data](#12-static-data)
13. [Health](#13-health)
14. [Data model](#14-data-model)
15. [Known API issues](#15-known-api-issues)

---

## 1. Conventions

- **Format:** JSON request and response bodies. The server parses bodies with `express.json()` at the default size limit.
- **Errors:** `{ "error": "<message>" }` with an HTTP status code. Unhandled failures return `500` with a generic message.
- **Auth:** Endpoints marked **auth** require a session cookie. Without one, the response is `401 { "error": "Not authenticated" }`.
- **IDs:** Discord user IDs are strings. List and item IDs are integers.
- **Gamification flag:** When a user's `gamification_enabled` is off, XP-granting endpoints award the raw base amount with no class or skill modifiers.
- **XP result object:** Endpoints that award XP return `xpResult`:
  ```json
  {
    "balanceBefore": 120,
    "balanceAfter": 135,
    "newLevel": 2,
    "finalXP": 15,
    "baseXP": 10,
    "bonusInfo": { "type": "HERO", "details": "Base: 10 | ⚔️ Hero +25 | ...", "skillBonus": 0, "critBonus": 0, "totalBonus": 25 }
  }
  ```
  `bonusInfo.details` is empty when no bonus applied.
- **Achievements in responses:** Endpoints that can unlock achievements return `newAchievements`, an array of `{ key, name, description, emoji, category }`.
- **CORS:** Only the origin in `FRONTEND_URL` is allowed, with `credentials: true`. The frontend must send requests with `credentials: 'include'`.

---

## 2. Authentication and sessions

Login uses Discord OAuth2 with the `identify` scope. There is no `state` parameter (see [SECURITY.md](../SECURITY.md#oauth-state)).

1. The browser navigates to `GET /api/auth/discord`.
2. The server redirects to Discord's authorize page.
3. Discord redirects to `GET /api/auth/callback?code=...`.
4. The server exchanges the code for an access token, fetches `GET https://discord.com/api/users/@me`, calls `getOrCreateUser`, stores the profile in the session, and redirects to `${FRONTEND_URL}/dashboard`.

The access token is discarded after login. The server holds no Discord token.

**Session cookie**

| Attribute | Development | Production (`NODE_ENV=production`) |
|---|---|---|
| Name | `connect.sid` (express-session default) | same |
| `HttpOnly` | yes | yes |
| `Secure` | no | yes |
| `SameSite` | `Lax` | `None` |
| Max age | 7 days | 7 days |

The session store is the in-memory default. Sessions are lost on every restart. The server sets `trust proxy` to 1, so it reads the client IP and protocol from the first proxy hop.

**Session contents** (`req.session.user`):
```json
{ "discordId": "123456789012345678", "username": "name", "globalName": "Display Name", "avatar": "hash-or-null", "discriminator": "0" }
```

---

## 3. Auth endpoints

### `GET /api/auth/discord`
- **Auth:** none
- **Response:** `302` redirect to `https://discord.com/api/oauth2/authorize` with `client_id`, `redirect_uri`, `response_type=code` and `scope=identify`.

### `GET /api/auth/callback`
- **Auth:** none
- **Query:** `code` (from Discord)
- **Success:** `302` to `${FRONTEND_URL}/dashboard`.
- **Failure:** `302` to a **relative** path on the API host:
  | Redirect | Cause |
  |---|---|
  | `/?error=no_code` | No `code` query parameter. |
  | `/?error=token_failed` | Discord did not return an access token. |
  | `/?error=oauth_failed` | Any other exception. |

  ⚠️ These redirects go to the API host, not the frontend, so the user lands on the API root rather than the app. See [Known API issues](#15-known-api-issues).

### `GET /api/auth/me`
- **Auth:** required
- **Response `200`:**
  ```json
  {
    "discord": { "discordId": "...", "username": "...", "globalName": "...", "avatar": "...", "discriminator": "0" },
    "user": { /* full users row, see Data model */ },
    "lists": { "total": 3 },
    "items": { "total": 25, "completed": 10 },
    "achievements": 4,
    "games": { "played": 12, "won": 6, "lost": 5, "draws": 1 },
    "skills": [ { "skill_id": "default_xp_boost", "skill_level": 2 } ],
    "userAchievements": [ { "achievement_key": "FIRST_LIST", "unlocked_at": "..." } ]
  }
  ```
- **Errors:** `401`, `500 { "error": "Failed to get user" }`.
- **Note:** `user` is `SELECT *` from `users`, so it includes `discord_id` and every class counter.

### `POST /api/auth/logout`
- **Auth:** none (⚠️ see [Known API issues](#15-known-api-issues))
- **Response `200`:** `{ "success": true }`
- The session is destroyed. The cookie is not explicitly cleared, and the response is `success: true` even if destruction fails.

---

## 4. User endpoints

### `GET /api/user`
- **Auth:** required
- **Response `200`:** `{ user, lists, items, achievements, games, skills }`. Same stats shape as `/api/auth/me` without `discord`, `userAchievements`.
- **Errors:** `500 { "error": "Failed to get user" }`.

### `PATCH /api/user`
- **Auth:** required
- **Body:** any of
  | Field | Type | Effect |
  |---|---|---|
  | `gamification_enabled` | boolean | Turns XP modifiers on or off, and includes the user in the leaderboard. |
  | `automation_enabled` | boolean | Stored only. No server behaviour uses it yet. |
  | `auto_delete_old_lists` | boolean | Stored only. No server behaviour uses it yet. |
- **Response `200`:** the updated `users` row.
- ⚠️ If the body contains none of these fields, the server builds `UPDATE users SET  WHERE ...` and returns `500`. Values are not coerced to booleans.

### `POST /api/user/daily`
- **Auth:** required
- **Body:** none
- **Success `200`:**
  ```json
  {
    "success": true,
    "baseXP": 100,
    "classBonus": 25,
    "streakBonus": 10,
    "skillDailyBonus": 10,
    "totalXP": 145,
    "bonusInfo": { "type": "HERO", "details": "..." },
    "streak": 3,
    "streakBroken": false,
    "newBalance": 1245,
    "newLevel": 13,
    "newAchievements": []
  }
  ```
- **Already claimed `200`:** `{ "success": false, "error": "Already claimed", "remaining": 3600000, "streak": 3, "newAchievements": [] }`. `remaining` is in milliseconds. This returns **HTTP 200**, so check `success` rather than the status code.
- **Rules:** 24-hour cooldown, 48-hour streak window, and a streak bonus capped at +50. See [GAME_MECHANICS.md §6](GAME_MECHANICS.md#6-daily-reward-and-streaks).

### `POST /api/user/reset`
- **Auth:** required
- **Body:** none
- **Response `200`:** `{ "success": true, "message": "..." }`
- Deletes the user's lists (and their items), achievements, game sessions, XP transactions and skills. Then it resets `player_xp`, `player_level`, `player_class`, `streak_count`, `last_active_day` and the class counters to defaults. Class ownership flags are reset as well.
- There is **no server-side confirmation**, so the frontend's `RESET` text box is the only guard. This is irreversible.

---

## 5. Lists and items

### `GET /api/lists`
- **Auth:** required
- **Response `200`:** array of list rows, each with `itemsTotal` and `itemsCompleted`.
- ⚠️ One query per list (N+1).

### `POST /api/lists`
- **Auth:** required
- **Body:**
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `name` | string | yes | Not validated. A missing name causes a 500. |
  | `description` | string | no | |
  | `category` | string | no | Free text. The UI uses School, Work, Personal, Health, Finance, Shopping, Fitness, Other. |
  | `priority` | string | no | Free text. The UI uses HIGH, MEDIUM, LOW. |
  | `deadline` | string (date) | no | |
- **Response `200`:** the new list row, plus `newAchievements` and `xpResult` (base 10 XP).

### `GET /api/lists/:id`
- **Auth:** required
- **Response `200`:** the list row with an `items` array.
- **Errors:** `404 { "error": "List not found" }` if the list does not belong to the caller.

### `PATCH /api/lists/:id`
- **Auth:** required
- **Body:** any of `name`, `description`, `category`, `priority`, `deadline`.
- **Response `200`:** the updated list row.
- ⚠️ An empty body produces invalid SQL and a `500`.

### `DELETE /api/lists/:id`
- **Auth:** required
- **Response `200`:** `{ "success": true }`. Items are expected to be removed by a foreign-key cascade (`db.js` comments say so; confirm against the live schema).

### `POST /api/lists/:listId/items`
- **Auth:** required
- **Body:** `{ "name": string, "description"?: string }`
- **Response `200`:** the new item, plus `newAchievements` and `xpResult` (base 5 XP).
- **Errors:** `404 { "error": "List not found" }` if the list is not the caller's.

### `PATCH /api/items/:id`
- **Auth:** required
- **Body:** any of `name`, `description`, `position`. `position` is used for drag-and-drop ordering.
- **Response `200`:** the updated item.
- ⚠️ **No ownership check.** Any authenticated user can edit any item by ID. See [SECURITY.md](../SECURITY.md#item-ownership).

### `PATCH /api/items/:id/toggle`
- **Auth:** required
- **Body:** none
- **Response `200`:** `{ ...item, newAchievements, xpResult }`. Base XP of 10 is awarded only when the item becomes completed. If the item does not exist, the response is `{ newAchievements, xpResult: null }` with `item` null.
- ⚠️ **No ownership check.** The caller is credited the XP and completion count even for another user's item. Toggling off and on again awards XP each time. See [SECURITY.md](../SECURITY.md#xp-farming).

### `DELETE /api/items/:id`
- **Auth:** required
- **Response `200`:** `{ "success": true }`
- ⚠️ **No ownership check.**

---

## 6. Classes

### `GET /api/classes`
- **Auth:** required
- **Response `200`:**
  ```json
  {
    "classes": [
      { "key": "HERO", "name": "Hero", "emoji": "⚔️", "cost": 500, "description": "...", "playstyle": "...", "owned": false, "equipped": false }
    ],
    "currentClass": "DEFAULT",
    "playerXP": 1200
  }
  ```

### `POST /api/classes/:key/buy`
- **Auth:** required
- **Path:** `key` is one of `DEFAULT`, `HERO`, `GAMBLER`, `ASSASSIN`, `WIZARD`, `ARCHER`, `TANK`.
- **Success `200`:** `{ "success": true, "user": { ... }, "newAchievements": [] }`. The class is also equipped.
- **Errors:**
  | Status | Body | Cause |
  |---|---|---|
  | 404 | `Class not found` | Unknown key. |
  | 400 | `Already owned` | Already purchased. |
  | 400 | `Not enough XP` | `player_xp` below cost. |
- ⚠️ Writes `player_xp` directly, with no ledger row, and does not recompute `player_level`. Read-modify-write without a transaction, so concurrent purchases can double-spend.

### `POST /api/classes/:key/equip`
- **Auth:** required
- **Success `200`:** `{ "success": true, "user": { ... } }`. Resets the class counters (`assassin_streak`, `assassin_stacks`, `wizard_counter`, `archer_streak`, `tank_stacks`) to 0.
- **Errors:** `400 { "error": "Class not owned" }`. `DEFAULT` can always be equipped.

---

## 7. Skills

### `GET /api/skills`
- **Auth:** required
- **Response `200`:**
  ```json
  {
    "skillTrees": [
      {
        "classKey": "HERO",
        "name": "Hero",
        "description": "...",
        "classOwned": true,
        "skills": [
          { "id": "hero_valor", "name": "Valor", "emoji": "⚔️", "description": "...", "cost": 100, "maxLevel": 3, "requires": null, "currentLevel": 1 }
        ]
      }
    ],
    "skillPoints": 0,
    "userXP": 1200,
    "playerClass": "HERO"
  }
  ```
- ⚠️ `classOwned` is computed with `=== 1`, which breaks if the driver returns a boolean.

### `POST /api/skills/:skillId/unlock`
- **Auth:** required
- **Path:** `skillId` (for example `hero_valor`).
- **Body:** `{ "classKey": "HERO" }`
- **Success `200`:** `{ "success": true, "skill": { ... } }`
- **Errors:**
  | Status | Body | Cause |
  |---|---|---|
  | 404 | `Skill not found` | Unknown `skillId`. |
  | 403 | `You must own the <CLASS> class to unlock this skill` | Class not owned. |
  | 400 | `Skill already maxed` | Level equals `maxLevel`. |
  | 400 | `Not enough XP` | Balance below cost. |
  | 400 | `Prerequisite not met` | Prerequisite skill is at level 0. |
- The cost is flat per level. See [GAME_MECHANICS.md §5](GAME_MECHANICS.md#5-skills).

---

## 8. Achievements

### `GET /api/achievements`
- **Auth:** required
- **Response `200`:**
  ```json
  {
    "achievements": [
      { "key": "FIRST_LIST", "name": "Getting Started", "description": "Create your first list", "emoji": "📋", "category": "lists", "unlocked": true, "unlockedAt": "2026-01-02T10:00:00.000Z" }
    ],
    "unlockedCount": 4,
    "totalCount": 24
  }
  ```

---

## 9. Games

### `GET /api/games/history`
- **Auth:** required
- **Response `200`:** the 20 most recent `game_sessions` rows with state other than `active`, ordered by `ended_at` descending.

### `POST /api/games/result`
- **Auth:** required
- **Body:**
  | Field | Type | Notes |
  |---|---|---|
  | `gameType` | string | `snake`, `dino`, `invaders` (free), `rps`, `hangman`, or any other value for the blackjack path. |
  | `result` | string | `won`, `lost`, `blackjack`, `push`, `bust` or `expired` are the values the stats read. |
  | `bet` | number | Stake. Not validated against balance or limits. |
  | `payout` | number | For free arcade games this **is** the XP earned. For betting games it is the gross return. |
- **Response `200`:** `{ "success": true, "xpChange": 42, "bonusInfo": { ... } or null, "newBalance": 1287, "newAchievements": [] }`
- **Effect:** Always writes a `game_sessions` row. XP is applied per the rules in [GAME_MECHANICS.md §8](GAME_MECHANICS.md#8-mini-games).

⚠️ **The server trusts all four fields.** It does not verify that the game was played, does not check bet limits, does not cap payouts, and does not coerce types. A client can report any payout. This is the most serious integrity gap in the API. See [SECURITY.md](../SECURITY.md#client-trusted-game-results).

---

## 10. Leaderboard

### `GET /api/leaderboard`
- **Auth:** **none** (public)
- **Response `200`:** an array of up to 10 entries:
  ```json
  [
    { "rank": 1, "discordId": "...", "username": "...", "avatar": "...", "xp": 4200, "level": 43, "playerClass": "WIZARD", "streak": 12, "gamesPlayed": 30, "tasksCompleted": 180 }
  ]
  ```
- Only users with `gamification_enabled` are listed. The endpoint exposes Discord IDs, usernames and avatars publicly.
- ⚠️ Roughly five queries per entry, uncached.

---

## 11. XP history

### `GET /api/xp/history`
- **Auth:** required
- **Response `200`:** the 50 most recent `xp_transactions` rows for the caller.
- The frontend client defines this endpoint but does not display it yet.

---

## 12. Static data

These endpoints are public and return the game definitions used by the server. The frontend currently uses its own copies.

| Endpoint | Returns |
|---|---|
| `GET /api/data/classes` | The `CLASSES` object: name, emoji, cost, description, playstyle for each class. |
| `GET /api/data/skills` | `SKILL_TREES`. Skill `effect` functions are dropped by JSON serialisation. |
| `GET /api/data/achievements` | `ACHIEVEMENTS`, keyed by achievement key. |

---

## 13. Health

### `GET /api/health`
- **Auth:** none
- **Response `200`:** `{ "status": "ok", "database": "connected", "timestamp": "2026-10-08T12:00:00.000Z" }`
- **Response `500`:** `{ "status": "error", "database": "disconnected", "error": "<raw error message>" }`
- Used by Render's health check. ⚠️ The raw error message can expose database host details. See [SECURITY.md](../SECURITY.md#information-disclosure).

---

## 14. Data model

These tables live in the MySQL database shared with the Discord bot. This repository does not define them. Column lists below are the columns the web app reads or writes. Types are inferred from queries, so confirm them against the bot's schema.

### `users`
| Column | Purpose |
|---|---|
| `discord_id` | Primary key. Discord user ID. |
| `discord_username`, `discord_avatar` | Profile cache, updated on login. |
| `player_xp` | Spendable XP balance. |
| `player_level` | Derived: `floor(player_xp / 100) + 1`. |
| `player_class` | Equipped class key. |
| `skill_points` | Read but never written. |
| `streak_count`, `last_daily_claim`, `last_active_day` | Daily reward state. |
| `total_lists_created`, `total_items_added`, `total_items_completed` | Monotonic counters for achievements. |
| `owns_hero`, `owns_gambler`, `owns_assassin`, `owns_wizard`, `owns_archer`, `owns_tank` | Class ownership flags. |
| `assassin_streak`, `assassin_stacks`, `wizard_counter`, `archer_streak`, `tank_stacks` | Class counters. |
| `gamification_enabled`, `automation_enabled`, `auto_delete_old_lists` | Settings. |

### `lists`
`id`, `discord_id`, `name`, `description`, `category`, `priority`, `deadline`, `created_at`.

### `items`
`id`, `list_id` (foreign key to `lists.id`, cascade delete), `name`, `description`, `position`, `completed`.

### `user_skills`
`discord_id`, `skill_id`, `skill_level`. Needs a unique key on `(discord_id, skill_id)` for `ON DUPLICATE KEY`.

### `achievements`
`discord_id`, `achievement_key`, `unlocked_at`. Needs a unique key for `INSERT IGNORE`.

### `game_sessions`
`id`, `discord_id`, `game_type` (`VARCHAR(20)`), `bet_amount`, `state`, `payout`, `ended_at`. `state` values read by the stats are `won`, `lost`, `blackjack`, `push`, `bust`, `expired`, and `active` for in-progress games.

### `xp_transactions`
`id`, `discord_id`, `amount`, `source`, `balance_before`, `balance_after`, `created_at`. Sources written: `list_create`, `item_create`, `task_complete`, `daily`, `game_reward`.

### Migrations run by the server
- On pool creation: `ALTER TABLE game_sessions MODIFY COLUMN game_type VARCHAR(20)`.
- On login: `ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_username VARCHAR(100), ADD COLUMN IF NOT EXISTS discord_avatar VARCHAR(100)`. Errors are ignored.

---

## 15. Known API issues

| # | Issue | Affected |
|---|---|---|
| 1 | Client-trusted game results | `POST /api/games/result` |
| 2 | No ownership check on items | `PATCH`/`DELETE /api/items/:id`, `PATCH /api/items/:id/toggle` |
| 3 | No input validation or type coercion | All `POST`/`PATCH` bodies |
| 4 | Empty `PATCH` bodies produce invalid SQL and a 500 | `/api/user`, `/api/lists/:id`, `/api/items/:id` |
| 5 | No rate limiting | All |
| 6 | No OAuth `state` parameter | `/api/auth/callback` |
| 7 | Callback errors redirect to the API host, not the frontend | `/api/auth/callback` |
| 8 | Logout does not require auth and does not clear the cookie | `/api/auth/logout` |
| 9 | Unknown `/api/*` paths hang in production (catch-all returns nothing) | Any unknown `/api` route when `NODE_ENV=production` |
| 10 | Raw error text returned from health check | `/api/health` |
| 11 | Public leaderboard exposes Discord IDs and avatars | `/api/leaderboard` |
| 12 | N+1 queries | `/api/lists`, `/api/leaderboard` |

Details and mitigations are in [SECURITY.md](../SECURITY.md).
