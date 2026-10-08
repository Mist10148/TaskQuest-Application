# Web API reference

Base path: `/api`. The API and the web app share one origin. In development, the Vite dev server on `:8080` proxies `/api` to `:3001`.

## Conventions

- **Authentication.** An HTTP-only session cookie `tq.sid` is set by the Discord login. Endpoints marked 🔒 return `401 {"error":"Not authenticated","code":"UNAUTHENTICATED"}` without it.
- **CSRF.** Every `POST`/`PATCH`/`PUT`/`DELETE` must send an `Origin` (or `Referer`) header matching `PUBLIC_URL` or `ALLOWED_ORIGINS`. A failure returns `403 CSRF`. Requests with a body must use `Content-Type: application/json`, otherwise they get `415`. Browsers using the bundled client satisfy both automatically.
- **Validation.** Bodies are validated with strict schemas, so unknown fields are rejected. Business rules (lengths, real dates, ownership) are enforced again by the shared services. The body limit is 16 KB.
- **Errors.** Errors return `{ "error": string, "code": string, "details"?: object }`:

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION` / `INSUFFICIENT_XP` | Bad input; not enough XP (`details: {needed, balance}`) |
| 401 | `UNAUTHENTICATED` | Not logged in |
| 403 | `FORBIDDEN` / `GAMIFICATION_DISABLED` / `CSRF` | Locked skill or class; XP turned off; cross-site request |
| 404 | `NOT_FOUND` | Missing, **or not yours** (ownership never leaks) |
| 409 | `CONFLICT` | Duplicate list name, already owned, game already finished |
| 413 / 415 | `VALIDATION` / `UNSUPPORTED_MEDIA_TYPE` | Body too large / not JSON |
| 429 | `COOLDOWN` / `RATE_LIMITED` | Free-game cooldown (with a `Retry-After` header); rate limit |
| 500 | `INTERNAL` | Bug. Details are logged server-side only. |

- **Rate limits.** General API: 900 requests per 15 min per user (or IP). Login endpoints: 30 per 15 min per IP. `/api/games/*`: 90 per minute.
- **Reward fields.** Actions that can grant XP return `xpResult` and `newAchievements`:

```jsonc
"xpResult": {            // null when no XP was granted (XP off, daily cap, already paid)
  "baseXP": 10, "finalXP": 47,
  "bonusInfo": { "type": "ARCHER_HIT", "details": "Base: 10 | 🎯 Hit x4 +10 💥+32", "classBonus": 42, "skillBonus": 0, "critBonus": 0, "totalBonus": 37 },
  "balanceAfter": 1290, "newLevel": 13, "leveledUp": false, "capped": false
},
"newAchievements": [ { "key": "FIRST_COMPLETE", "name": "First Victory", "description": "...", "emoji": "✅", "category": "completions" } ]
```

---

## Health and static data

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/health` | — | `200 {status:"ok", database:"connected", timestamp}` or `503 {status:"error", database:"unavailable"}` |
| GET | `/api/data/classes` | — | `CLASSES` map |
| GET | `/api/data/skills` | — | `SKILL_TREES` map |
| GET | `/api/data/achievements` | — | `ACHIEVEMENTS` map |

## Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/auth/discord` | — | Redirects to Discord (`scope=identify`, random `state`). |
| GET | `/api/auth/callback` | — | OAuth callback. On success it regenerates the session and redirects to `PUBLIC_URL/dashboard`. On failure it redirects to `PUBLIC_URL/?error=<access_denied\|invalid_state\|token_failed\|profile_failed\|session_failed>`. |
| GET | `/api/auth/me` | 🔒 | `{ discord:{discordId,username,globalName,avatar}, user, lists:{total}, items:{total,completed}, achievements:<count>, games:{played,won,lost,draws}, skills:[...], userAchievements:[{achievement_key,unlocked_at}] }` |
| POST | `/api/auth/logout` | — | Destroys the session, clears the cookie. `{success:true}` |

## User

| Method | Path | Body | Response |
|---|---|---|---|
| GET 🔒 | `/api/user` | — | Same as `/me` without `discord`/`userAchievements` |
| PATCH 🔒 | `/api/user` | `{gamification_enabled?, automation_enabled?, auto_delete_old_lists?}` (booleans, ≥1 field) | Updated `users` row |
| POST 🔒 | `/api/user/daily` | — | See below |
| GET 🔒 | `/api/user/xp-history` (alias `/api/xp/history`) | — | Last 50 `xp_transactions` |
| POST 🔒 | `/api/user/reset` | `{"confirm":"RESET"}` | Deletes lists, achievements, skills, games and XP history, and resets stats. `{success, message}` |

Daily reward response (`200` in both cases):

```jsonc
// claimed
{ "success": true, "baseXP": 100, "classBonus": 25, "streakBonus": 10, "skillDailyBonus": 0,
  "totalXP": 135, "bonusInfo": {...}, "streak": 3, "streakBroken": false, "streakPreserved": false,
  "newBalance": 1435, "newLevel": 15, "leveledUp": false, "newAchievements": [] }
// on cooldown
{ "success": false, "error": "Already claimed", "remaining": 51234567, "streak": 3 }
```

## Lists and items

All routes are 🔒 and owner-scoped. Another user's IDs return `404`.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/lists` | — | `[{...list, itemsTotal, itemsCompleted}]`, newest first |
| POST | `/api/lists` | `{name, description?, category?, priority?: "LOW"\|"MEDIUM"\|"HIGH"\|null, deadline?: "YYYY-MM-DD"\|null}` | `201 {...list, xpResult, newAchievements}`. `409` on duplicate name. |
| GET | `/api/lists/:id` | — | `{...list, items:[...]}` (items by position) |
| PATCH | `/api/lists/:id` | Any subset of the create fields (≥1). Changing `deadline` re-arms the reminder. | Updated list |
| DELETE | `/api/lists/:id` | — | `{success:true}` (items cascade) |
| POST | `/api/lists/:listId/items` | `{name (1–200), description? (≤1000)}` | `201 {...item, xpResult, newAchievements}` |
| PATCH | `/api/items/:id` | `{name?, description?, position? (int ≥0)}` (≥1) | Updated item (with `list_name`, `list_priority`) |
| PATCH | `/api/items/:id/toggle` | optional `{completed: boolean}` (no body toggles) | `{...item, completed, xpResult, newAchievements}`. XP only on the **first** completion. |
| DELETE | `/api/items/:id` | — | `{success:true}` |

Field limits: list name 1–100, category ≤ 50, description ≤ 1000. Deadlines must be real calendar dates between 2000 and 2100.

## Classes, skills, achievements, leaderboard

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/classes` | 🔒 | `{classes:[{key,name,emoji,cost,description,playstyle,owned,equipped}], currentClass, playerXP}` |
| POST | `/api/classes/:key/buy` | 🔒 | Buys and equips. `{success, user, newAchievements}`. `409` if owned, `400 INSUFFICIENT_XP`, `404` for unknown keys. |
| POST | `/api/classes/:key/equip` | 🔒 | `403` if not owned. Switching resets class counters. |
| GET | `/api/skills` | 🔒 | `{skillTrees:[{classKey,name,emoji,description,classOwned,skills:[{id,name,emoji,description,maxLevel,cost,requires,currentLevel}]}], skillPoints, userXP, playerClass}` |
| POST | `/api/skills/:skillId/unlock` | 🔒 | Unlocks or levels up one skill (cost per level). The tree is derived on the server; any `classKey` in the body is ignored. `{success, skill:{skill_id, skill_level}, balance}` |
| GET | `/api/achievements` | 🔒 | `{achievements:[{key,name,emoji,description,category,unlocked,unlockedAt}], unlockedCount, totalCount}` |
| GET | `/api/leaderboard` | — | Top 10: `[{rank, username, avatarUrl, xp, level, playerClass, streak, gamesPlayed, tasksCompleted, isYou}]`. No Discord IDs. |
| GET | `/api/leaderboard/me` | 🔒 | `{rank}` (null when XP is off) |

## Games (server-authoritative)

All routes are 🔒. Outcomes, shuffles and payouts are decided on the server. Clients only send decisions. Games other than Blackjack and arcade runs respect a 3-second cooldown and a shared free-game cap of 500 XP per day. When XP is turned off, every game route returns `403 GAMIFICATION_DISABLED`.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/games/config` | — | Bet limits, rewards, arcade caps, cooldown |
| GET | `/api/games/history` | — | Last 20 finished: `[{id, game_type, bet_amount, payout, net, state, created_at, ended_at}]` |
| GET | `/api/games/active` | — | `{blackjack: {sessionId, view}\|null, hangman: {sessionId, view}\|null}` |
| POST | `/api/games/blackjack/start` | `{bet: int}` | `BlackjackResult`. If a hand is already in progress, it is returned with `resumed:true` and no new bet is taken. |
| POST | `/api/games/blackjack/action` | `{action: "hit"\|"stand"\|"double"}` | `BlackjackResult`. `404` if there is no active hand. |
| POST | `/api/games/rps` | `{choice: "rock"\|"paper"\|"scissors"}` | `{player, opponent, outcome:"won"\|"lost"\|"push", xpGained, capped, bonusInfo, balance, achievements}` |
| POST | `/api/games/hangman/start` | — | `{sessionId, view}` (cancels any unfinished word) |
| POST | `/api/games/hangman/guess` | `{letter: "A"–"Z"}` | `{sessionId, view, xpGained, capped?, bonusInfo?, balance, achievements}` |
| POST | `/api/games/arcade/:type/start` | — (`type` = `snake`\|`dino`\|`invaders`) | `{sessionId}` |
| POST | `/api/games/arcade/:type/finish` | `{sessionId, score}` (points, not XP) | `{sessionId, gameType, score, xpGained, capped, bonusInfo, balance, achievements}`. An implausible score gets `400` and the run is cancelled. |
| POST | `/api/games/:type/quit` | — | `{success}` (hangman/arcade only) |

`BlackjackResult`:

```jsonc
{
  "sessionId": 42, "balance": 890, "maxBet": 222, "resumed": false,
  "view": {
    "bet": 100, "doubled": false, "finished": false, "outcome": null,     // outcome: won|lost|push|blackjack
    "playerHand": [{"rank":"8","suit":"♥"},{"rank":"8","suit":"♣"}], "playerValue": {"value":16,"soft":false,"bust":false},
    "dealerHand": [{"rank":"9","suit":"♣"}, null],                         // hole card hidden until finished
    "dealerValue": {"value":9,"soft":false,"bust":false}, "canDouble": true
  },
  "settlement": null   // when finished: { credited, net, bonusInfo, achievements }
}
```

Hangman `view`: `{masked:["Z",null,...], length, guessed, wrong, lives, maxLives, potentialReward, finished, outcome, word}`. `word` is `null` until the game ends.

## Removed in 4.0

| Endpoint | Reason |
|---|---|
| `POST /api/games/result` | It trusted client-reported outcomes and payouts (anyone could mint XP). Replaced by the server-authoritative game endpoints above. |
