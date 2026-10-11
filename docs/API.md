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
| 403 | `AI_OPTED_OUT` | The user turned AI features off in Settings |
| 429 | `COOLDOWN` / `RATE_LIMITED` / `AI_QUOTA` | Free-game cooldown (with a `Retry-After` header); rate limit; daily AI request limit reached |
| 503 | `AI_DISABLED` / `AI_UNAVAILABLE` | AI is not enabled on this server; the AI service is down or timed out |
| 500 | `INTERNAL` | Bug. Details are logged server-side only. |

- **Rate limits.** General API: 900 requests per 15 min per user (or IP). Login endpoints: 30 per 15 min per IP. `/api/games/*`: 90 per minute. `/api/ai/*`: 20 per minute per user (plus a daily per-user request quota enforced by the AI service).
- **Reward fields.** Actions that can grant XP return `xpResult` and `newAchievements`:

```jsonc
"xpResult": {            // null when no XP was granted (XP off, daily cap, already paid)
  "baseXP": 10, "finalXP": 47,
  "bonusInfo": { "type": "ARCHER_HIT", "details": "Base: 10 | 🎯 Hit x4 +10 💥+32", "classBonus": 42, "skillBonus": 0, "critBonus": 0, "totalBonus": 37 },
  "balanceAfter": 1290, "newLevel": 13, "leveledUp": false, "capped": false
},
"newAchievements": [ { "key": "FIRST_COMPLETE", "name": "First Victory", "description": "...", "emoji": "✅", "category": "completions", "xp": 25 } ]   // xp: the reward paid for it (25; 0 when XP is off)
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
| GET | `/api/auth/me` | 🔒 | `{ discord:{discordId,username,globalName,avatar}, user, lists:{total}, items:{total,completed}, achievements:<count>, games:{played,won,lost,draws}, skills:[...], userAchievements:[{achievement_key,unlocked_at}], features:{ai, aiAvailable} }`. `features.ai` is true when the server has AI on and the user has not opted out; `aiAvailable` is the server-wide flag. |
| POST | `/api/auth/logout` | — | Destroys the session, clears the cookie. `{success:true}` |

## User

| Method | Path | Body | Response |
|---|---|---|---|
| GET 🔒 | `/api/user` | — | Same as `/me` without `discord`/`userAchievements` |
| PATCH 🔒 | `/api/user` | `{gamification_enabled?, automation_enabled?, auto_delete_old_lists?, ai_enabled?, weekly_digest?}` (booleans), `{timezone?: IANA name\|null, reminder_hour?: 0–23}`; ≥1 field. An unknown zone is `400`. | Updated `users` row |
| POST 🔒 | `/api/user/daily` | — | See below |
| GET 🔒 | `/api/user/xp-history` (alias `/api/xp/history`) | — | Last 50 `xp_transactions` |
| POST 🔒 | `/api/user/reset` | `{"confirm":"RESET"}` | Deletes lists, task templates, achievements, skills, games and XP history, and resets stats (including `xp_spent` and streak freezes). Also asks the AI service to forget the user's vectors, chat threads and cached summaries. `{success, message}` |
| GET 🔒 | `/api/user/prestige` | — | `{prestige, title, nextTitle, bonusPercent, nextBonusPercent, level, minLevel, max, eligible}` |
| POST 🔒 | `/api/user/prestige` | `{"confirm":"PRESTIGE"}` | Resets balance, level, class, class ownership, skills, class counters and freezes; keeps achievements, quest claims, tasks and the daily streak. `{success, prestige, title, bonusPercent, levelBefore, balanceLost, balance, level, newAchievements}`. `400` below level 30 or without the confirmation, `409` after 10 prestiges, `403` when XP is off. `/api/user` also reports `user.prestige`, `user.prestige_title` and `user.lifetime_xp_total` (the never-reset total; `lifetime_xp` restarts with each prestige). |
| POST 🔒 | `/api/user/streak-freeze` | — | Buys one streak freeze (150 XP, max 3 held; 120 XP and 5 with the Freeze Cache skill). `{success, freezes, cost, max, newBalance, newAchievements}`. `409` at the cap, `400 INSUFFICIENT_XP`. |
| GET 🔒 | `/api/user/export` | — | Download of everything you own as JSON (`{app, version, exportedAt, lists:[{name, description, category, priority, deadline, items:[{id, parent_id, name, description, completed, due_date, priority, tags, recurrence}]}]}`). |
| GET 🔒 | `/api/user/export.csv` | — | One row per task (`list, task, subtask_of, done, due_date, priority, tags, repeat, list_deadline, list_category`). Cells that start with `=`, `+`, `-` or `@` get a leading `'` so spreadsheets don't run them as formulas. |
| POST 🔒 | `/api/user/import` | An export document (body limit **1 MB** on this route only; max 100 lists, 500 tasks per list, 1000 in total, and no more than 200 lists / 5000 tasks in your account counting what you already have; a subtask under another subtask is rejected) | `201 {success, lists, items}`. All or nothing. Name clashes get an `(imported)` suffix, existing lists are never touched, and **no XP, counters or achievements are granted**; completed tasks arrive already paid, so they cannot be re-earned. |
| POST 🔒 | `/api/import/csv` | `{csv: string (≤ 1,000,000 characters), dryRun?: boolean}` | Spreadsheet import with the same rules as `/api/user/import` (all or nothing, per-account quota, no XP, counters or achievements, imported tasks never count for quests). Reads TaskQuest's own CSV export or a generic file whose first row names columns, case-insensitively: `list` (default quest `Imported`), `task`/`name`/`title`, `description`, `due`/`due_date`/`deadline`, `priority`, `tags` (separated by `;` or `,`), `repeat`/`recurrence`, `done`/`completed` (`true/false`, `yes/no`, `1/0`), plus the export's `subtask_of`, `list_deadline`, `list_category`. Quotes, doubled quotes, CRLF, a BOM and line breaks inside cells are handled, and `;` is detected as the delimiter. Rows with the same list name share one quest; a clashing name gets an `(imported)` suffix. Every row is validated first. `dryRun: true` returns `200 {ok, rows, lists, items, preview:[{row, list, task, due_date, priority, tags, completed}], errors, errorCount}` and writes nothing. Otherwise `201 {success, rows, lists, items}`, or `400` with `details: {errors:[{row, message}], errorCount}` (the first 100 problems; `row` is the file row, the header being row 1) and nothing imported. Body limit 2 MB on this route. |
| GET 🔒 | `/api/user/calendar-token` | — | `{token}` (null when the feed is off). The token is a secret, so `/api/auth/me` and `/api/user` only report `user.has_calendar_token`. |
| POST 🔒 | `/api/user/calendar-token` | — | Creates or rotates the secret calendar feed token. `{token}` |
| DELETE 🔒 | `/api/user/calendar-token` | — | Turns the feed off. `{success:true}` |

Daily reward response (`200` in both cases):

```jsonc
// claimed (freezeUsed: a bought streak freeze saved a streak that would have broken)
{ "success": true, "baseXP": 100, "classBonus": 25, "streakBonus": 10, "skillDailyBonus": 0,
  "surpriseBonus": 0,            // Daily Surprise: 0 or 50
  "chest": null,                 // {streak: 7, xp: 100} when this claim reaches a 7/14/30 day streak (paid on top of totalXP)
  "totalXP": 135, "bonusInfo": {...}, "streak": 3, "streakBroken": false, "streakPreserved": false, "freezeUsed": false,
  "newBalance": 1435, "newLevel": 15, "leveledUp": false, "newAchievements": [] }
// on cooldown
{ "success": false, "error": "Already claimed", "remaining": 51234567, "streak": 3 }
```

## Lists and items

All routes are 🔒 and owner-scoped. Another user's IDs return `404`.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/lists` | — | `[{...list, itemsTotal, itemsCompleted}]`, newest first |
| GET | `/api/lists/search?q=…&scope=lists\|tasks\|all` | `q` 1–100 characters (required), `scope` (default `lists`) | `{lists:[list rows], tasks:[{id, name, description, completed, parent_id, due_date, list_id, list_name}]}`; the part not in scope is `[]`. `lists` matches quest name, category and description; `tasks` matches task names and descriptions. Case-insensitive, `%` and `_` are matched literally, owner-scoped, and bounded (50 tasks, 100 quests). Declared before `/:id`. |
| POST | `/api/lists` | `{name, description?, category?, priority?: "LOW"\|"MEDIUM"\|"HIGH"\|null, deadline?: "YYYY-MM-DD"\|null}` | `201 {...list, xpResult, newAchievements}`. `409` on duplicate name. |
| GET | `/api/lists/:id` | — | `{...list, items:[...]}` (items by position) |
| PATCH | `/api/lists/:id` | Any subset of the create fields (≥1). Changing `deadline` re-arms the reminder. | Updated list |
| DELETE | `/api/lists/:id` | — | `{success:true}` (items cascade) |
| POST | `/api/lists/:id/save-as-template` | `{name?}` (default: the quest's name) | `201` template (see [Templates](#templates)). Saves the quest's tasks, in order, as a flat list: subtasks become plain tasks, and completion state and due dates are dropped. `409` when the name is taken, `400` for a quest with no tasks or more than 30. |
| PATCH | `/api/lists/:id/reorder` | `{itemIds: [int]}`: every task id of the list, exactly once, in the new order | The list's items in the new order. Positions become 0..n-1. `400` if the ids are not exactly the list's tasks. |
| POST | `/api/lists/:listId/items` | `{name (1–200), description? (≤1000), due_date?: "YYYY-MM-DD"\|null, priority?, tags?: string\|string[], recurrence?: "daily"\|"weekly"\|"monthly"\|null, parent_id?: int\|null}` | `201 {...item, xpResult, newAchievements}` |
| PATCH | `/api/items/:id` | Any subset of the create fields, plus `position? (int ≥0)`; ≥1. A position moves the task there and closes the gaps. | Updated item (with `list_name`, `list_priority`) |
| PATCH | `/api/items/:id/toggle` | optional `{completed: boolean}` (no body toggles) | `{...item, completed, xpResult, bonuses, newAchievements, nextItem}`. XP only on the **first** completion. `bonuses` is `[{key, label, xp}]`, the flat extras paid with that first completion (`first_of_day`, `list_cleared`, `early_finish`, `overdue_clear`, `subtasks_done`, `habit_bonus`; see [GAMEPLAY](GAMEPLAY.md#5c-bonus-xp-sources)), empty when none. `nextItem` is the newly created copy when a repeating task is completed (else `null`). |
| DELETE | `/api/items/:id` | — | `{success:true}` |

Field limits: list name 1–100, category ≤ 50, description ≤ 1000. Deadlines and task due dates must be real calendar dates between 2000 and 2100.

**Task details.** A task can have its own `due_date`, `priority` (used for class and skill effects instead of the list's) and up to 5 `tags` (letters, numbers, `-` and `_`, ≤ 20 characters, stored lower-case as `"work,home"`). `recurrence` repeats it: completing a repeating task for the first time creates the next copy in the same transaction (monthly repeats clamp to short months, and a late completion never creates an already-overdue copy). A repeat grants no creation XP and is not counted as an added task. `parent_id` makes a task a **subtask**: the parent must be a top-level task of the same list, nesting is one level deep, and a task that has subtasks cannot become a subtask. Deleting a parent deletes its subtasks.

Completing tasks pays XP for the first **50 completions per UTC day** (like list and task creation, so an add / complete / delete loop cannot farm XP). A capped completion is still recorded and cannot be re-earned by un-checking and re-checking.

## Templates

All routes are 🔒 and owner-scoped (another user's template ID is `404`). A template is a name, an optional description and 1–30 tasks; each task keeps `name`, `description`, `priority`, `tags` and `recurrence` (never due dates). You can keep 20 templates; names are unique per user.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/templates` | — | `[{id, name, description, items:[{name, description?, priority?, tags?, recurrence?}], itemCount, created_at}]`, by name |
| POST | `/api/templates` | `{name (1–100), description? (≤1000), items: [1–30 × {name (1–200), description?, priority?, tags?, recurrence?}]}` | `201` template. `409` duplicate name, `400` invalid input or 20 templates already. |
| DELETE | `/api/templates/:id` | — | `{success:true}` |
| POST | `/api/templates/:id/apply` | `{listName?: string, listId?: int}` (not both) | `201 {list, items, created, xpResult, newAchievements}`. Without `listId` it creates a new quest named `listName` (a taken name is `409`) or, when omitted, the template's name, with today's date in your time zone added if that name is taken (`Name (2030-01-05)`). With `listId` the tasks are appended to that quest of yours (`created: false`). The quest and every task are rewarded like hand-made ones, so the daily list and task creation caps apply; `xpResult` is the total. Account limits (200 quests, 5000 tasks) apply: `400`. |

## Classes, skills, achievements, leaderboard

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/classes` | 🔒 | `{classes:[{key,name,emoji,cost,description,playstyle,owned,equipped}], currentClass, playerXP}` |
| POST | `/api/classes/:key/buy` | 🔒 | Buys and equips. `{success, user, newAchievements}`. `409` if owned, `400 INSUFFICIENT_XP`, `404` for unknown keys. |
| POST | `/api/classes/:key/equip` | 🔒 | `403` if not owned. Switching resets class counters. |
| GET | `/api/skills` | 🔒 | `{skillTrees:[{classKey,name,emoji,description,classOwned,skills:[{id,name,emoji,description,maxLevel,cost,requires,currentLevel}]}], skillPoints, userXP, playerClass}` |
| POST | `/api/skills/:skillId/unlock` | 🔒 | Unlocks or levels up one skill (cost per level). The tree is derived on the server; any `classKey` in the body is ignored. `{success, skill:{skill_id, skill_level}, balance}` |
| GET | `/api/achievements` | 🔒 | `{achievements:[{key,name,emoji,description,category,unlocked,unlockedAt}], unlockedCount, totalCount}` |
| GET | `/api/leaderboard?by=&class=` | — | Top 10: `[{rank, username, avatarUrl, xp, lifetimeXp, prestige, prestigeTitle, score, level, playerClass, streak, gamesPlayed, tasksCompleted, isYou}]` (`lifetimeXp` is the never-reset total). `by` is `lifetime` (default), `weekly` (XP earned since Monday 00:00 UTC, earning sources only), `streak` or `xp` (current balance); `class` filters by class key. `score` is the value the board ranks by. `weekly` and `streak` only list players with a score above 0. No Discord IDs. |
| GET | `/api/leaderboard/me?by=&class=` | 🔒 | `{rank}` on that board, within the class when `class` is given (null when XP is off, no score on `weekly`/`streak`, or you are not that class) |

## Quests

Daily, weekly and monthly quests (periods are UTC: the day; Monday 00:00 to Monday 00:00; the 1st to the 1st). Progress is computed from your real activity; a claim pays flat XP (no class or skill modifiers) once per period. Exactly one of the four rotating weekly quests (`WEEKLY_ROT_A`..`D`, chosen by ISO week number mod 4) is listed and claimable each week; the other three answer `404` and are not listed. `BOSS_COMPLETE_50` is the monthly boss.

| Method | Path | Body | Response |
|---|---|---|---|
| GET 🔒 | `/api/quests` | — | `{quests:[{key, name, emoji, description, period: "daily"\|"weekly"\|"monthly", rotating, target, reward, progress, claimed, claimable, periodStart, resetsAt}]}` |
| POST 🔒 | `/api/quests/:key/claim` | — | `{success, key, name, reward, balance, level, leveledUp, newAchievements}`. `400` if unfinished, `409` if already claimed this period, `404` for an unknown key, `403` when XP is off. |

## Focus sessions

A server-timed work timer. The server measures the time; the client only says start and finish. All routes are 🔒.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/focus` | — | `{active: {sessionId, startedAt, minutes, endsAt}\|null, today: {sessions, xp, remainingSessions, remainingXP}, config: {minMinutes, maxMinutes, xpPerMinute, xpPerDay, sessionsPerDay}}` |
| POST | `/api/focus/start` | `{minutes: integer 10–90}` | `{success, sessionId, startedAt, minutes, endsAt}`. Cancels any unfinished session. `409` once 8 sessions finished today, `400` for a bad length. |
| POST | `/api/focus/finish` | `{sessionId}` | `{success, sessionId, state: "finished"\|"cancelled"\|"expired", minutesCredited, xp, capped, balance, level, leveledUp, newAchievements}`. Credits min(planned, elapsed) minutes if at least 10 passed and pays floor(minutes × 0.6) XP under 100 XP a day (`capped: true` when trimmed). Earlier than 10 minutes cancels with no XP; after 3 hours expires with none. `404` for someone else's or an unknown session, `409` if already over. |

## Weekly review

| Method | Path | Body | Response |
|---|---|---|---|
| GET 🔒 | `/api/review` | — | `{weekStart, resetsAt, completed, xpEarned, claimed, claimable, streak, reward}` for the current UTC week |
| POST 🔒 | `/api/review/claim` | — | `{success, weekStart, xp, balance, level, leveledUp, newAchievements}`. Once per week (`409`); `400` unless you finished at least one task this week; `403` when XP is off. |

## Statistics

Read-only numbers for the web Stats page. Days are UTC days; only your own data is ever read.

| Method | Path | Query | Response |
|---|---|---|---|
| GET 🔒 | `/api/stats/xp-history` | `days` = `7`, `30` (default) or `90`; anything else is `400` | `[{date: "YYYY-MM-DD", xp, tasksCompleted}]`, oldest first, today last, one entry per day (zeros for quiet days). `xp` sums earning sources only (spending never lowers a day); `tasksCompleted` counts tasks by the day they were first completed. |
| GET 🔒 | `/api/stats/summary` | — | `{streak, tasksCompleted7d, xpBySource30d: [{source, label, xp}], busiestWeekday: {index (0 = Sunday), name, count} \| null}`. `xpBySource30d` covers the last 30 days, largest first. `busiestWeekday` looks at completions over the last 90 days. |

## Calendar feed

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/calendar/<token>.ics` | the token | An RFC 5545 feed of list deadlines and task due dates (all-day events, completed ones marked ✓). Calendar apps cannot send cookies, so the 32-character secret in the URL is the credential. Unknown and revoked tokens both return `404`. Create, rotate or revoke it with `/api/user/calendar-token`. |

## Games (server-authoritative)

All routes are 🔒. Outcomes, shuffles and payouts are decided on the server. Clients only send decisions. Games other than Blackjack and arcade runs respect a 3-second cooldown and a shared free-game cap of 500 XP per day. When XP is turned off, every game route returns `403 GAMIFICATION_DISABLED`.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/games/config` | — | Bet limits, rewards, arcade caps, cooldown |
| GET | `/api/games/allowance` | — | `{cap, usedXP, remainingXP, resetsAt}`: today's shared free-game XP allowance |
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

## AI (optional)

Only available when the server runs with `AI_ENABLED=true` (see [AI_INTEGRATION.md](AI_INTEGRATION.md)). Otherwise every route returns `503 AI_DISABLED`. All routes are 🔒, count toward the AI rate limit, and are scoped to the logged-in user: the Discord ID is taken from the session, never from the request.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/ai/ping` | — | `{pong:true}` (checks the whole path to the AI service) |
| POST | `/api/ai/summary` | `{mode:"list", listId}` · `{mode:"digest"}` · `{mode:"recap", range?:"day"\|"week"}` | `{mode, headline, highlights[], blockers[], next_steps[], referenced_ids[], cached}` |
| POST | `/api/ai/prioritize` | `{limit?: 1–20}` | `{ranked:[{id, listId, name, rank, score, reason, priority, deadline, isOverdue, progress, suggestedPriority}], focusMessage, usedFallback, cached}` |
| POST | `/api/ai/chat` | `{threadId?, message (1–2000 chars)}` | **SSE stream** (below). Creates a thread when `threadId` is omitted. |
| POST | `/api/ai/chat/:threadId/resume` | `{approved: boolean}` | SSE stream. Only valid while the thread waits on a `confirm` event (else `409`). |
| GET | `/api/ai/threads` | — | `{threads:[{id, title, created_at, updated_at}]}` |
| GET | `/api/ai/threads/:threadId` | — | Thread plus `messages:[{role, text}]` and `pendingConfirm:[…]` (a confirmation still waiting) |
| DELETE | `/api/ai/threads/:threadId` | — | `{success:true}` (also deletes its checkpoints) |

`/api/ai/prioritize` never fails because Gemini is down or the quota is used up: it falls back to a deterministic ranking and sets `usedFallback: true`. Priority changes it suggests are *suggestions*; apply one with the normal `PATCH /api/lists/:id`.

### Chat stream events

```
event: token    data: {"text": "You have "}
event: sources  data: [{"id":"L42","title":"Math homework"}]
event: tool     data: {"name":"complete_item","status":"done|declined|error","xpResult":{...},"newAchievements":[...]}
event: confirm  data: {"id":"call-id","action":"complete_item","args":{"item_id":"I311"},"preview":"Mark \"Ch. 4 problems\" as done?"}
event: error    data: {"message":"..."}
event: done     data: {"threadId":"...","usage":{"input":123,"output":45}}
```

A `confirm` event pauses the turn. Nothing has been changed yet. Answer with `POST /api/ai/chat/:threadId/resume {approved}`; the changes run only on `true`, through the same services as the normal endpoints, so XP and achievements are awarded exactly as usual (they arrive in the `tool` event). A thread's pending confirmation survives a page reload (`pendingConfirm`).

## Internal API (service to service)

`/internal/*` is **not** for browsers: it has no session or CSRF layer and is only mounted when `AI_ENABLED=true`. Every request must carry the shared `X-AI-Token` (checked in constant time; a wrong or missing token returns `404`, so the routes do not reveal themselves). The AI service calls these after the user confirmed an action in chat; they run through the same services as the public API, so XP, caps and achievements behave identically. The acting Discord ID comes from the trusted caller in the body.

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/internal/lists` | `{discordId, name, description?, category?, priority?, deadline?, items?: string[] (≤20)}` | Create a list (and optional tasks) |
| POST | `/internal/lists/:id/items` | `{discordId, name, description?, due_date?, priority?, tags?, recurrence?, parent_id?}` | Add a task with its own fields (same validation as `POST /api/lists/:id/items`) |
| PATCH | `/internal/items/:id` | `{discordId, name?, description?, due_date?, priority?, tags?, recurrence?, parent_id?}` (at least one field; no `position`) | Change a task's own fields. 404 when the task is not the user's |
| POST | `/internal/items/:id/subtasks` | `{discordId, names: string[] (2-8)}` | Break a top-level task down: creates the subtasks under it in one transaction (all or none) and returns `{parent, items, newAchievements, xpResult}`. 400 when the task is itself a subtask, 404 when it is not the user's |
| PATCH | `/internal/items/:id/toggle` | `{discordId, completed?}` | Complete or reopen a task |
| PATCH | `/internal/lists/:id` | `{discordId, priority?, deadline?}` | Change a list's priority or deadline |

The reverse direction (Express and the bot to the AI service: `POST /internal/index`, `POST /internal/forget`) is documented in [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md). `POST /internal/forget` with only a `discordId` removes everything stored about the user: vectors, chat threads with their checkpoints, and cached summaries (the daily usage counter is kept, so a reset cannot refill the AI quota).

## Removed in 4.0

| Endpoint | Reason |
|---|---|
| `POST /api/games/result` | It trusted client-reported outcomes and payouts (anyone could mint XP). Replaced by the server-authoritative game endpoints above. |
