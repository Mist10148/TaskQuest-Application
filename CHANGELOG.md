# Changelog

All notable changes to TaskQuest. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **AI features (optional, off by default).** Set `AI_ENABLED=true` and run the new `apps/ai` service. See [docs/AI_INTEGRATION.md](docs/AI_INTEGRATION.md).
  - **Summarizer** for a quest, a daily briefing or a weekly recap, with caching and id validation.
  - **Prioritizer** ("What should I do next?") that blends a deterministic score with Gemini and falls back to the score alone when the model is unavailable. Suggested priority changes are Accept/Reject.
  - **Chat** with retrieval over your quests and the help docs, tools, persistent threads, streaming, and write actions (create, add, complete, update) that always wait for your confirmation.
  - New migration `003_ai`: embeddings, chat threads, checkpoints, usage and summary cache, plus `users.ai_enabled`.
  - New Settings switch to opt out of AI. Opted-out users are never sent to Gemini.
  - New API: `/api/ai/*` (see [docs/API.md](docs/API.md#ai-optional)) and the token-protected `/internal/*` used by chat tools.
  - New `ai` CI job, `taskquest-ai` private service in `render.yaml`.

## [4.0.0] - 2026-10-08

The Discord bot (`taskquest-botv2` v3.8.3) and the web app (`taskquest-web_deploy` v1.5) are merged into this monorepo. All game rules and data access move into the shared package `@taskquest/shared`.

### ⚠️ Action required

- **Rotate** the Discord bot token, OAuth client secret and session secret. Both old repositories leaked them ([SECURITY.md](SECURITY.md#1-required-action-rotate-leaked-secrets)).
- **Deploy two services** from `render.yaml`. The web app is now served by the API on one origin, so delete the old static site and update the Discord OAuth redirect to `<PUBLIC_URL>/api/auth/callback`.
- **Back up your database.** Migrations upgrade it automatically on first start.
- **Re-register slash commands** with `npm run deploy:commands`.

### Added

- npm workspaces monorepo: `apps/bot`, `apps/server`, `apps/web`, `packages/shared`.
- **`@taskquest/shared`**: one implementation of classes, skills, achievements, XP formulas, games and validation, plus data services used by both apps.
- **Versioned migrations** (`npm run db:migrate`, also on startup) with automatic upgrades from every legacy schema.
- **Lifetime XP.** Levels are based on total XP earned, so spending never lowers your level.
- **Server-authoritative games on the web**: Blackjack (new: double down), RPS and Hangman, plus server-registered arcade runs.
- **Cross-platform game sessions.** A hand started in Discord can be finished on the web, and games survive restarts.
- **Working effects for every skill.** Eighteen skills previously had no effect: Streak Shield, Champion, Lucky Streak, Double Down, Safety Net, Jackpot, Swift Strike, Shadow Step, Execute, Spell Combo, Focus, Arcane Mastery, Multishot, Piercing Shot, Sniper, Absorb, Revenge and Unstoppable.
- **Merged achievement set (30).** `STREAK_14` comes to the bot; `XP_100`, `XP_500` and the game achievements come to the web. They are evaluated atomically with the action that earns them.
- **Anti-farming limits**:
  - completion XP once per task
  - daily caps on creation rewards
  - a 500 XP daily cap on free games
  - a 3-second cooldown between free-game rounds
- Web login screen (`AuthGate`), typed API client, MySQL-backed sessions and the Vite dev proxy.
- Tests: rules unit tests, plus integration tests for services, the HTTP API and every bot flow.
- GitHub Actions CI: lint, typecheck, build, syntax check, tests on MySQL 8, and a production audit.
- Documentation: README, PRD, architecture, API, commands, gameplay, database, deployment, security, contributing, known issues.

### Changed

- **Rules unified across platforms**:
  - Completing a task pays **10** base XP (the bot paid 8).
  - **RPS** pays a fixed 10 base XP per win on both platforms. The web used to pay your bet back as risk-free winnings.
  - **Hangman** is free on both platforms (the web charged an entry fee) and pays max(10, 10 × lives left).
  - Class descriptions now describe the actual mechanics.
- **Bot**:
  - `/profile` is ephemeral and never creates rows for other users.
  - `/leaderboard` shows cached names (no N+1 queries).
  - Hangman offers all 26 letters (the Z option was missing).
  - `/app` requires `WEB_APP_URL`.
  - Only the `Guilds` intent is used.
  - `deploy-commands` replaces commands atomically and accepts `--guild ID`.
- **Web**:
  - Same-origin API.
  - React Router 7 and Vite 7.
  - The leaderboard returns display data only.
  - Progress reset requires an explicit confirmation.
- **Server**: rewritten into modules (config, routes, security middleware, zod schemas).
- **Database**:
  - BIGINT XP everywhere, with foreign keys and cascades and utf8mb4.
  - Game state lives in `game_sessions.game_data`; `blackjack_hands` is retired.
  - The web's `BUY_CLASS` achievement is merged into `FIRST_CLASS`.

### Fixed

**Security.** These are summarised here; [SECURITY.md](SECURITY.md#3-vulnerabilities-fixed-in-40) lists them all.

- Client-trusted game results (unlimited XP minting).
- Item IDOR on both platforms.
- CSRF.
- Missing OAuth `state` and session fixation.
- Committed secrets and a fallback session secret.
- Missing headers and rate limits.
- An information leak in the health check.
- Discord IDs on the leaderboard.
- Vulnerable dependencies.

**Integrity**:

- Blackjack could pay out twice.
- A bet could be lost when session creation failed.
- Lost or duplicated XP under concurrent requests.
- Double purchases.
- The level dropped when spending.
- Toggle farming.

**Bot (all former KNOWN_ISSUES)**:

- The broken `checkAchievements` call aborted `/daily`, list creation and class purchase after XP was written.
- `skill.effect()` crashes.
- Streak updates never applied.
- `/game` failed on fresh installs (missing `blackjack_hands` and `started_at`).
- Editing a list with a deadline crashed.
- Search queried a non-existent `notes` column.
- Duplicate list names threw.
- Impossible dates were accepted.
- Item names had no length limit.
- Old-list clean-up used the oldest item update instead of the newest.
- Expired games didn't refund.
- Only SIGINT was handled.
- `ADD COLUMN IF NOT EXISTS` failed on MySQL 8.
- Unhandled rejections in timers.
- Dead `utils/gamification.js`.
- Version strings disagreed.
- Unused environment variables.

**Web**:

- The mock user and lists were shown when logged out or offline.
- The CORS/port mismatch.
- The broken TypeScript build (type errors) and 47 ESLint errors.
- The SWC native binding failed on some Windows setups (switched to `@vitejs/plugin-react`).

### Removed

- `POST /api/games/result` (replaced by the server-authoritative game endpoints).
- The per-app `render.yaml`, docs and duplicated game logic.
- `express-mysql-session`, `cors` and `lovable-tagger` dependencies.

---

## Pre-monorepo history

- **Bot v3.8.3** (`Mist10148/taskquest-botv2`): the last standalone bot release.
- **Web v1.5** (`Mist10148/taskquest-web_deploy`): the last standalone web release.

Their git histories were deliberately not imported, because both contained leaked secrets. The original repositories remain the reference for older history.

[4.0.0]: https://github.com/Mist10148/TaskQuest-Application/releases/tag/v4.0.0
