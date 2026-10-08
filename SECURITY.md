# Security

## Contents

1. [Required action: rotate leaked secrets](#1-required-action-rotate-leaked-secrets)
2. [Security model](#2-security-model)
3. [Vulnerabilities fixed in 4.0](#3-vulnerabilities-fixed-in-40)
4. [Residual risks](#4-residual-risks)
5. [Reporting a vulnerability](#5-reporting-a-vulnerability)
6. [Operator checklist](#6-operator-checklist)

---

## 1. Required action: rotate leaked secrets

The repositories this monorepo replaces exposed real credentials in their git history:

| Repository | What leaked | Where |
|---|---|---|
| `taskquest-web_deploy` | `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, `DISCORD_CLIENT_ID`, database host and user | `server/.env`, committed in the very first commit and tracked ever since |
| `taskquest-botv2` | `DISCORD_TOKEN` | `.env` in local commits `01f44d4` and `dab92ca` |

This monorepo was created **without importing either history**, and `.gitignore` blocks `.env` files at any depth. The old values must still be treated as compromised:

1. **Discord bot token.** In the Developer Portal, open Bot and use **Reset Token**. Update `DISCORD_TOKEN` everywhere.
2. **OAuth client secret.** Open OAuth2 and use **Reset Secret**. Update `DISCORD_CLIENT_SECRET`.
3. **Session secret.** Generate a new one with `openssl rand -base64 48`. Rotating it logs everyone out, which is intended.
4. **Database password.** Change it if the leaked file contained one, and restrict network access to the database.
5. **Old repositories.** Make them private or archive them. If you keep them public, purge the files from history (`git filter-repo --path server/.env --invert-paths`) and force-push. Assume anything that was public has been copied.
6. Locally, run `git reflog expire --expire=now --all && git gc --prune=now` in old clones that contain the unreachable token commits.

## 2. Security model

- **Identity.** Discord is the only identity provider. The web app uses OAuth2 authorization code flow with the `identify` scope, and stores no passwords.
- **Trust boundary.** Clients (browser and Discord UI) are untrusted. All rules, outcomes and prices are decided in `@taskquest/shared` on the server.
- **Authorization.** Ownership is part of every SQL statement that touches user data (`... WHERE discord_id = ?`, items through `JOIN lists`). A missing row and someone else's row are indistinguishable (`404`).
- **Integrity.** XP changes run in transactions holding a row lock on the user and are recorded in an append-only ledger (`xp_transactions`).
- **Web surface:**
  - Single origin with `SameSite=Lax` cookies.
  - CSRF origin/Referer checks and JSON-only bodies.
  - helmet (CSP, frame-ancestors none, HSTS, nosniff, referrer policy).
  - Rate limits, strict zod schemas, a 16 KB body limit, and generic 5xx responses.
- **Secrets.** Only environment variables; nothing in the repository. The server refuses to start in production without a strong `SESSION_SECRET`.
- **Transport to the database.** TLS with certificate verification by default when `DB_SSL=true`, including for `DB_URL`.
- **Least data.** Only the Discord ID, display name and avatar hash are stored. The leaderboard never exposes Discord IDs.

## 3. Vulnerabilities fixed in 4.0

### Critical / high

| Issue | Where (before) | Fix |
|---|---|---|
| **Client-trusted game results.** `POST /api/games/result` accepted any `result`/`payout`, so you could mint unlimited XP (`payout: 1e9`) or gain XP from a negative bet. | web `server/index.js` | Endpoint removed. Games are server-authoritative with escrowed bets (`packages/shared/src/db/games.js`). |
| **IDOR on items.** Toggle, edit and delete of any item by ID, crediting XP to the attacker. | web `PATCH/DELETE /api/items/:id*`; bot `m_additem_`, `sel_done_`, `sel_del_`, `rename_` handlers | Owner-scoped SQL in `tasks.js`. Bot handlers pass the clicking user's ID. |
| **CSRF.** A `SameSite=None` cookie and no CSRF defence let any website trigger `POST /api/user/reset` (wipe progress), purchases and more. | web session config | Single origin, `SameSite=Lax`, Origin/Referer allow-list, JSON-only bodies, and confirmation for reset. |
| **Committed secrets** and a **hard-coded fallback session secret**. | `server/.env`; `SESSION_SECRET \|\| 'taskquest-secret-change-in-production'` | Fresh history, a `.gitignore`, and a startup refusal without a strong secret. |
| **Blackjack double payout.** Two quick Stand clicks each resolved and paid the hand. | bot `game.js` / `sessionManager.endSession` | Session row locked `FOR UPDATE`, `UPDATE ... WHERE state='active'`, one transaction. |
| **Lost or duplicated XP from races.** Absolute XP writes from stale reads, and double purchases on double click. | both apps | `applyXP` with row locks; purchases validated inside the lock. |
| **XP farming.** Toggling an item, or creating and deleting lists and items, repeated rewards. Risk-free RPS paid back the bet (up to 1000 XP per click). | both apps | Completion XP once per item, daily caps for creation rewards, a fixed RPS reward, a free-game cap and cooldowns. |
| **Login CSRF / session fixation.** No OAuth `state`; session not regenerated at login. | web OAuth | Random `state` bound to the session, constant-time compare, `session.regenerate()`. |
| **Lost bets.** The bet was deducted, then the session creation failed. | bot `startBlackjack` | Bet, session and deal happen in one transaction; expired hands are refunded. |

### Medium / low

| Issue | Fix |
|---|---|
| No security headers (clickjacking, no CSP) | helmet with a strict CSP |
| No rate limiting | `express-rate-limit` (API, login, games) |
| Unvalidated input: empty PATCH produced `SET WHERE`, impossible dates, oversized names, `__proto__` class keys | zod `.strict()` schemas + service validation + `Object.hasOwn` look-ups |
| `/api/health` leaked database error messages | Generic `503` |
| Leaderboard exposed Discord IDs | Server-built avatar URL, no IDs |
| In-memory session store (sessions lost on restart, memory growth) | MySQL session store (`web_sessions`) |
| Logout didn't clear the cookie; OAuth errors redirected to the API host | Cookie cleared; errors redirect to `PUBLIC_URL/?error=…` |
| `DB_URL` ignored TLS settings; `DB_SSL_REJECT_UNAUTHORIZED=false` in examples | TLS applies to `DB_URL`; verification on by default with a warning when off |
| `LIKE` wildcards in search not escaped | `escapeLike` with `ESCAPE '\\'` |
| `/profile @user` created database rows for arbitrary users and showed their XP publicly | Ephemeral, and read-only for others |
| Mock-data fallback hid auth failures (a fake player was shown when logged out) | Real login gate and error states |
| Privileged `GuildMembers` intent requested without need | `Guilds` intent only |
| `/app` linked to an unowned domain when unconfigured | No fallback URL |
| Vulnerable dependencies: mysql2 ≤ 3.23 (via express-mysql-session), react-router < 7.18, vite ≤ 6.4 | Upgraded; `express-mysql-session` replaced; production `npm audit` is clean |
| Dev server bound to all interfaces (`host: "::"`) | Binds to `localhost` |

## 4. Residual risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Arcade games run in the browser.** A scripted client can submit plausible fake scores. | At most 100–150 XP per run, and at most 500 XP per day across all free games. | Server-issued runs, plausibility rate check, caps. See the roadmap in [docs/PRD.md](docs/PRD.md#11-roadmap). |
| **Public `/list` messages.** Anyone in the channel sees your list names and tasks (by design: lists are shared in-channel). | Information visible to channel members | Use `/list` in DMs or a private channel for private lists. Mutations are owner-only. |
| **Dev-only dependency advisories** in the Tailwind CSS 3 toolchain (`braces`, `micromatch`, `chokidar`, `postcss-selector-parser`) | Build time only; nothing is shipped to users or servers | Tracked in [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) (Tailwind 4 migration). |
| **Single shared database user** for both apps | A compromise of either app reaches all data | Use `MIGRATE_ON_START=false` with a DML-only user, and restrict network access to the DB. |

## 5. Reporting a vulnerability

Please **do not open a public issue** for security problems.

- Use GitHub's **Report a vulnerability** (private security advisory) on this repository, or contact the maintainer privately through their GitHub profile.
- Include affected versions, reproduction steps and impact. You will get an acknowledgement within 7 days.
- Please give us reasonable time to fix the issue before disclosing it publicly.

## 6. Operator checklist

- [ ] Secrets rotated after migrating from the old repositories (§1)
- [ ] `NODE_ENV=production`, `PUBLIC_URL` set to the HTTPS origin, `SESSION_SECRET` ≥ 32 random characters
- [ ] `DB_SSL=true` with certificate verification for any database reachable over a network
- [ ] Database not publicly reachable, or restricted to the app hosts
- [ ] `TRUST_PROXY` matches your proxy setup
- [ ] Old public repositories archived or made private
- [ ] Dependabot or regular `npm audit` enabled
