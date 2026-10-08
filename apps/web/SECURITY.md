# Security

This document lists the known security and integrity issues in TaskQuest Web v1.5, how each one can be exploited, what to do about it, and how to report a new problem.

**Read this before exposing a deployment to anyone other than trusted testers.**

---

## Reporting a vulnerability

Do not open a public issue for a security problem.

- Use GitHub's private vulnerability reporting for the repository, if it is enabled. Otherwise contact the maintainer privately. This repository does not list a security contact.
- Include the affected endpoint or file, steps to reproduce, and the impact you observed.
- Do not test against another person's account or data. Use accounts you control.

There is no bug bounty and no response-time commitment at present.

---

## Summary

| Severity | Issue | Status |
|---|---|---|
| Critical | [Game results trusted from the client](#client-trusted-game-results) | Open |
| Critical | [No ownership check on item routes](#item-ownership) | Open |
| Critical | [Secrets committed in `server/.env`](#committed-secrets) | Open |
| Critical | [Public fallback session secret](#session-secret) | Open |
| High | [XP farming through toggling and recreation](#xp-farming) | Open |
| High | [No rate limiting](#no-rate-limiting) | Open |
| High | [Race conditions in balances and claims](#race-conditions) | Open |
| High | [OAuth without a `state` parameter](#oauth-state) | Open |
| High | [Sessions held in memory](#session-storage) | Open |
| Medium | [Missing input validation](#input-validation) | Open |
| Medium | [Health endpoint leaks error detail](#information-disclosure) | Open |
| Medium | [Public leaderboard exposes Discord IDs](#public-leaderboard) | Open (by design, to be reviewed) |
| Low | [Logout and error-handling gaps](#logout-and-error-handling) | Open |
| Low | [Unhandled API routes hang in production](#logout-and-error-handling) | Open |

Ratings are the maintainer's judgement from reading the code. No penetration test has been performed.

---

## Known issues

### Client-trusted game results

**Where:** `POST /api/games/result` in `server/index.js`.

**What happens:** The handler reads `gameType`, `result`, `bet` and `payout` from the request body and applies them. It does not:

- verify that a game was played or that a result is plausible,
- check that `bet` is positive, numeric or within the user's balance,
- cap `payout` or the XP that results from it,
- coerce types, so strings can concatenate and negative values can flip signs.

For the free arcade games (`snake`, `dino`, `invaders`), `payout` is the XP awarded. A request such as `{"gameType":"snake","result":"won","payout":1000000}` credits a million base XP, which is then multiplied by any class and skill bonuses.

**Impact:** Unlimited XP for any account. The leaderboard and achievements become meaningless, and betting games can be drained or inflated.

**Mitigation (recommended):**
1. Enforce bet limits on the server: a minimum of 10, a maximum of `min(25% of balance, 1000)`, and a balance check. Take the stake from the balance before the game resolves.
2. Move game resolution to the server. For blackjack, RPS and hangman, the server should draw the cards, the CPU choice and the word, and keep the state in `game_sessions` with a round ID.
3. For arcade games, either move the scoring to the server, or cap the XP per game and per time window, and reject scores that are impossible for the elapsed time.
4. Validate types and reject anything outside the allowed `result` values.

---

### Item ownership

**Where:** `PATCH /api/items/:id`, `DELETE /api/items/:id` and `PATCH /api/items/:id/toggle`. The database functions `updateItem`, `deleteItem` and `toggleItemComplete` in `server/db.js` take an item ID and no owner.

**What happens:** The routes require a session but do not check that the item belongs to a list owned by the caller. Any signed-in user can edit, delete or toggle any item by its numeric ID.

**Impact:** Cross-account data tampering. Toggling someone else's item to complete also credits the caller with XP and completion counts, because `toggleItemComplete` is passed the caller's ID.

**Mitigation:** Join `items` to `lists` and require `lists.discord_id = ?` with the session user, in each query. Return `404` for items the caller does not own, so existence is not revealed. Add a test that a second account cannot modify the first account's item.

---

### Committed secrets

**Where:** `server/.env` is tracked by git. The repository has no `.gitignore`.

**What happens:** The file defines `DISCORD_CLIENT_SECRET`, `SESSION_SECRET` and `DB_PASSWORD`, alongside non-secret settings. Anyone with read access to the repository, including its history, can read whatever values were committed.

This document does not reproduce the values. Their presence in git history is the issue.

**Impact:** If any committed value is real, an attacker can impersonate the Discord application, forge session cookies, or connect to the database.

**Mitigation:**
1. Treat every value that was ever committed as compromised. Rotate them: reset the Discord client secret in the Developer Portal, generate a new `SESSION_SECRET`, and change the database password.
2. Add a `.gitignore` that covers at least `.env`, `.env.*` (except `.env.example`), `node_modules/`, `dist/` and `.claude/settings.local.json`.
3. Remove the file from tracking with `git rm --cached server/.env`.
4. Optionally rewrite history to remove the file. This rewrites commits and requires a force push, so do it only with explicit agreement from everyone who has a clone.
5. Keep only `.env.example` files in the repository, with placeholder values.

---

### Session secret

**Where:** `server/index.js`, `session({ secret: ... })`.

**What happens:** If `SESSION_SECRET` is unset, the server signs sessions with the string `taskquest-secret-change-in-production`, which is public in this repository. The server does not refuse to start.

**Impact:** Anyone who knows the fallback can forge a session cookie for any `discordId`, which is full account takeover.

**Mitigation:** Refuse to start when `NODE_ENV=production` and `SESSION_SECRET` is missing or shorter than 32 characters. Remove the fallback.

---

### XP farming

**Where:** `PATCH /api/items/:id/toggle`, `POST /api/lists`, `POST /api/lists/:listId/items`, `DELETE` routes.

**What happens:**
- Toggling an item to complete awards 10 base XP each time it becomes complete, and each completion increments `total_items_completed`. Toggling off and on again repeats the award.
- Creating and deleting lists or items repeats the create-time XP and the `total_*` counters.
- Achievements based on these counters can be farmed.

Because XP is spendable, farming also lets an attacker buy every class and skill quickly.

**Impact:** Inflated XP, levels and leaderboard standing. Devalued achievements.

**Mitigation:**
- Award completion XP only once per item, by recording an `awarded_at` or `xp_awarded` flag on the item and never clearing it.
- Count lifetime completions and creations separately from the balance, and make them monotonic.
- Consider a per-day cap on task XP.

---

### Race conditions

**Where:** `addXPTransaction` and `claimDaily` in `server/db.js`, class and skill purchase handlers in `server/index.js`.

**What happens:** XP is read, changed in memory, then written, with no transaction and no row lock. The daily claim checks the cooldown, then writes, so two concurrent requests can both pass the check.

**Impact:**
- Two daily claims in the same moment both pay out.
- A purchase that reads a stale balance can double-spend, buying a class or skill twice for one balance.
- XP events in parallel can overwrite one another's balance.

**Mitigation:** Run each balance change inside a transaction with `SELECT ... FOR UPDATE` on the user row, or use an atomic `UPDATE users SET player_xp = player_xp + ? WHERE discord_id = ? AND player_xp >= ?` and check `affectedRows`. For the daily claim, update `last_daily_claim` conditionally in the same statement.

---

### OAuth state

**Where:** `GET /api/auth/discord` and `GET /api/auth/callback`.

**What happens:** The authorisation request does not include a `state` value, and the callback does not verify one. An attacker can make a victim's browser complete a login to the attacker's Discord account (login CSRF), so the victim's session becomes linked to the wrong account.

**Impact:** The victim's activity lands in the attacker's account. The attacker cannot read the victim's existing data through this alone, but the victim may create data they believe is theirs.

**Mitigation:** Generate a random `state` on `/api/auth/discord`, store it in the session, and require an exact match in the callback before exchanging the code.

---

### Session storage

**Where:** `express-session` with the default in-memory store.

**What happens:** Sessions live in the Node process. A restart, a deploy, or Render's free-tier spin-down clears them, so users are logged out. The store also cannot be shared if the API is ever scaled to more than one instance.

**Impact:** Frequent forced logouts, and a session cannot be revoked across instances.

**Mitigation:** Use a persistent store: a MySQL-backed session store (the database is already available), or Redis. Set an explicit cookie name and keep `httpOnly`, `secure` and `sameSite` as they are.

---

### No rate limiting

**Where:** All routes.

**What happens:** Nothing limits request rate. This allows:
- brute-force or scripted XP farming,
- repeated game submissions,
- the leaderboard endpoint, which performs about 50 queries per request, to be used for load.

**Mitigation:** Add `express-rate-limit` with stricter limits on `/api/games/result`, `/api/user/daily`, the item routes, and `/api/auth/*`. Consider a global limit per session.

---

### Input validation

**Where:** Every `POST` and `PATCH` route.

**What happens:**
- Missing required fields (for example a list without a name) produce a database error and a `500`.
- An empty `PATCH` body builds invalid SQL, `UPDATE ... SET  WHERE`, and returns `500`.
- Types are not checked. `PATCH /api/user` accepts any value for the boolean flags.
- Free-text fields such as `category` and `priority` accept any string.
- `req.body` is not size-limited beyond the `express.json()` default.

**Mitigation:** Add a schema validator (zod is already a frontend dependency and could be shared). Reject empty updates with `400`. Limit string lengths and enumerate `category` and `priority`.

---

### Information disclosure

**Where:**
- `GET /api/health` returns `error: error.message` on failure.
- Several handlers log user-controlled values, including `console.log` of every game result.
- `GET /api/auth/me` and `GET /api/user` return the full `users` row (`SELECT *`), so every column is visible to the owner. That is acceptable for the owner, but `discord_id` and internal counters are not needed by the client.

**Impact:** The health response can reveal database host or driver details to anyone who can reach the API. Logs can be polluted with attacker-chosen text.

**Mitigation:** Return a generic message from `/api/health` and log the detail server-side. Log user input with escaping or not at all. Select only the columns the client needs.

---

### Public leaderboard

**Where:** `GET /api/leaderboard`, which requires no session.

**What happens:** The endpoint returns the top 10 players' Discord IDs, usernames, avatars, levels, streaks and task counts to anyone.

**Impact:** Players are identifiable, and their activity patterns are visible. This is a privacy question, not a vulnerability as such.

**Mitigation:** Make leaderboard inclusion opt-in, and consider omitting Discord IDs from the public response. Keep the response cacheable so the endpoint is cheap to serve.

---

### Logout and error handling

**Where:** `POST /api/auth/logout`, `GET /api/auth/callback`, and the production catch-all in `server/index.js`.

**What happens:**
- Logout does not require a session, and does not clear the cookie. It returns `success: true` even if `session.destroy` fails.
- OAuth failures redirect to `/?error=...` on the API host, which leaks the failure reason into a URL and sends the user to the wrong origin.
- There is no error-handling middleware. In production, `app.get('*')` sends `index.html` for non-`/api` paths and sends no response for unknown `/api` paths, so those requests hang until the client times out.

**Mitigation:** Clear the cookie on logout and check the destroy callback. Redirect OAuth errors to `${FRONTEND_URL}` with a generic error code. Add a JSON 404 for unknown `/api` routes and a global error handler that returns generic `500` responses.

---

## Remediation checklist

Work through these in order. Each one reduces risk independently.

- [ ] Rotate the Discord client secret, `SESSION_SECRET` and the database password, then assume the old values are public.
- [ ] Add `.gitignore`. Untrack `server/.env`.
- [ ] Refuse to start in production without a strong `SESSION_SECRET`.
- [ ] Add owner checks to all item routes.
- [ ] Move game resolution and bet enforcement to the server.
- [ ] Wrap XP and purchase changes in transactions or atomic updates.
- [ ] Add `state` to the OAuth flow.
- [ ] Add rate limiting.
- [ ] Add input validation and empty-body rejection.
- [ ] Move sessions to a persistent store.
- [ ] Fix the health response and the logout and error paths.
- [ ] Make the leaderboard opt-in.
- [ ] Add automated tests for the ownership, bet and XP rules.

---

## Scope and limitations

This document reflects a reading of the source at v1.5. It is not a penetration test, and it does not cover the Discord bot, the hosting platform, or the Discord application's settings. Re-verify each item after a change.
