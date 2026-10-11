# Changelog

All notable changes to TaskQuest. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Tasks grow up.** Each task can have its own due date, priority, up to five tags, one level of subtasks and a repeat rule (daily / weekly / monthly: completing a repeating task creates the next copy, with no creation XP). Migration `007_item_fields`.
  - **Quick add** from one line of text ("Finish report fri !high #work every week"): a quick-add bar with a live preview on the web, and `/quick` on Discord. The web can also hand the sentence to the AI chat (pre-filled, never auto-sent).
  - Up/down buttons that work on touch, a real reorder API (`PATCH /api/lists/:id/reorder`), bulk select (complete or delete several tasks), **undo** for task deletion, and keyboard shortcuts (`n`, `/`, `s`, `?`, `Esc`).
- **Daily and weekly quests** with progress computed from real activity and one atomic claim per period (`/quests`, `GET /api/quests`, a dashboard card). Migration `009_quest_claims`.
- **Streak freezes** (150 XP, max 3): saves a streak that a missed day would break (`/freeze`, Profile page). New **spending achievements** (1k, 5k, 10k XP spent; 33 achievements in total) backed by `users.xp_spent`.
- **Leaderboard boards**: lifetime XP (the new default), XP earned this week, streaks and balance, with a class filter, your own rank and a highlighted row (`GET /api/leaderboard?by=&class=`, `/leaderboard by:`).
- **Reminders that follow you.** A per-user time zone and reminder hour (`/timezone`, Settings), one overdue notice the day after a deadline, and Snooze / Stop buttons on every reminder DM. Migration `008_user_prefs`.
- **Weekly digest DM** (opt-in, `/weekly`): your week's numbers on Monday morning, with the AI recap when AI is on.
- **Your data**: JSON and CSV export, a reward-free all-or-nothing JSON import, and a secret **calendar feed** (`/api/calendar/<token>.ics`) of list deadlines and task due dates that can be rotated or turned off.
- **Free-game allowance** endpoint and a Games-page panel showing today's remaining XP, plus a sound switch, on-screen touch controls and fixed-timestep game loops for the arcade games.
- **Web app**: light and dark themes with a system option, a mobile top bar and accessible drawer, skip link and global focus ring, a reduce-motion setting, a getting-started checklist, confetti for level-ups, error cards with retry, and a rebuilt Settings page. A test checks WCAG contrast of both themes.
- Docs: [OPERATIONS.md](docs/OPERATIONS.md) (backup and restore, troubleshooting, the first live Gemini run), design notes for [shared lists](docs/design/shared-lists.md), [Tailwind 4](docs/design/tailwind-4-migration.md) and [arcade anti-cheat](docs/design/arcade-anti-cheat.md), the `/internal` API, and complete database and contributor guides.
- **AI features (optional, off by default).** Set `AI_ENABLED=true` and run the new `apps/ai` service. See [docs/AI_INTEGRATION.md](docs/AI_INTEGRATION.md).
  - **Summarizer** for a quest, a daily briefing or a weekly recap, with caching and id validation.
  - **Prioritizer** ("What should I do next?") that blends a deterministic score with Gemini and falls back to the score alone when the model is unavailable. Suggested priority changes are Accept/Reject.
  - **Chat** with retrieval over your quests and the help docs, tools, persistent threads, streaming, and write actions (create, add, complete, update) that always wait for your confirmation.
  - New migration `003_ai`: embeddings, chat threads, checkpoints, usage and summary cache, plus `users.ai_enabled`.
  - New Settings switch to opt out of AI. Opted-out users are never sent to Gemini.
  - New API: `/api/ai/*` (see [docs/API.md](docs/API.md#ai-optional)) and the token-protected `/internal/*` used by chat tools.
  - New `ai` CI job, `taskquest-ai` private service in `render.yaml`.
  - **Discord commands** `/summary`, `/prioritize` and `/ask`. `/ask` shows Approve/Cancel buttons before changing anything. The bot worker now gets the AI settings in `render.yaml`; re-register slash commands after upgrading.
  - **Eval suites** for retrieval, the summarizer and the prioritizer (`python -m tests.evals.run [--live]`), and `mypy` in CI.
  - `@taskquest/shared/ai`: a client for the AI service for non-Express callers.

- **Talk to the bot.** With AI enabled, the bot answers @mentions, replies and DMs in a persona modelled on the Zephyr bot: it sounds human, is witty, teases back, uses no emojis and writes its actions in *italics*. Zephyr's sexual lines were not carried over. Memory is kept per user per channel, it can read quests but not change them, and it can look at attached images.
  - New `/forget` and `/ai-format` commands.
  - Backed by the new `POST /v1/converse` LangGraph flow, which runs the chat graph in read-only mode.
  - Migrations `005_ai_thread_source` and `006_ai_chat_format`. Re-register slash commands after upgrading.
- Web chat and `/ask` use the same persona. It is layered after the core rules, so grounding and confirmations still take priority.
- Weekly history chunks now include the XP earned that week, and the reconcile job keeps them fresh.
- The summarizer's model call is now a LangChain LCEL chain.
- Explicit Gemini safety settings, and a friendly reply when a response is blocked.
- Evals: p95 summarizer latency, an optional LLM-as-judge (`--judge`), and 50 retrieval queries.
- CI: the AI service's SQL runs against MySQL 8 with the migrations applied (`ai-mysql` job).
- [docs/AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md) explains how the LangChain/LangGraph service is built.

### Changed

- **Web UX pass:** one mobile gutter, touch-visible controls, per-button pending states and a confirm dialog with "balance after" for spending XP, a daily-claim countdown, a drag handle with optimistic reorder and Shift-click selection, optimistic Settings switches, new text colour tokens that meet WCAG AA, a Leaderboard with arrow-key tabs, Achievements filters and progress bars, a Ctrl+K command palette and a first-run tour.
- **The leaderboard defaults to lifetime XP** instead of the spendable balance, so buying a class or skill no longer lowers your rank.
- **Auto-delete only removes finished lists.** It used to also delete unfinished lists five days after their deadline; overdue lists now stay visible.
- **Reminders** are sent at the user's reminder hour in their time zone (UTC and 09:00 until set), and a reminder missed during an outage is sent late (up to 3 days) instead of never.
- **Web bundle**: each page is a lazy-loaded chunk with stable vendor chunks, and 36 unused UI primitives and 30 packages were removed. The Tasks page is split into focused components.
- Dark-theme colours that failed contrast (the Assassin badge was 1.5:1, destructive button text 3.8:1) were fixed.
- Node 22 is now required. Node 20 is end-of-life, and its test runner could not expand the test globs, which had broken CI since 8 October.
- LangChain, LangGraph and `langgraph-checkpoint` are pinned to their tested major versions.

### Fixed

- **Blackjack could be farmed.** Winnings took class and skill bonuses, so a Hero betting 10 earned +35 per win with no cap. Blackjack now pays a flat 1:1 (3:2 for a natural). A hand abandoned after hitting or doubling is now played out with you standing and settled, instead of refunded; untouched hands are still refunded. Games refuse to settle while XP is off, arcade starts share the free-game cooldown, and a zero-score arcade run is a loss, not a win.
- **Quests could be farmed** by unchecking and rechecking tasks, importing a file, raising a task's priority after finishing it, or completing recurring copies. Migration `010_quest_integrity` records the first completion and flags rows that don't count.
- **Monthly repeats drifted** (Jan 31 became the 28th for good) and very late repeating tasks got a wrong next date.
- **Auto-cleanup could delete a list that had just received a new task.** It now re-checks under a lock.
- Importing now enforces a per-user quota (200 lists, 5,000 tasks) and rejects nested subtasks. A progress reset also clears quest claims. The streak leaderboard hides lapsed streaks, and `GET /api/leaderboard/me` honours the class filter. The web server now also expires abandoned game sessions every 5 minutes.
- **Security:** the calendar feed token is no longer part of the profile or `/api/auth/me`; it is returned only by `GET /api/user/calendar-token`.
- **Discord `/list` views are locked to the person who ran them**, and list and task menus page past 25 entries.
- Snoozed and due reminders skip finished lists, a snooze after the deadline settles the due and overdue notices, the weekly digest can no longer double-send and uses your time zone, and background jobs no longer overlap.
- **Mentions in server channels no longer expose private quests** (quest lookups work in DMs and through `/ask`).
- **AI:** opt-out and the daily quota are enforced on every model route with atomic reservation, a double Approve runs a write once, `/v1/chat` returns 409 while a confirmation is pending, usage counts even when the client disconnects, confirm previews list every field and subtask, and AI-created quests are all-or-nothing.
- **Web:** New chat and delete-thread no longer bounce back to the old thread; reordering works while an undo-delete is pending; quests and profile numbers refresh right after task actions; the checkbox no longer double-toggles; Snake food no longer spawns under the snake and arcade XP is no longer lost when the start request is slow; the Settings reset keeps the dialog open until it succeeds; bad `?list=` links show an error; forms have inline validation; the dashboard separates XP balance from lifetime XP.
- **Task completion XP could be farmed.** Only creation had a daily cap, so add / complete / delete loops paid unlimited XP. Completions now share a 50-per-day reward cap.
- **A rejected arcade score did not cancel the run**: the error rolled the cancellation back, so the same run could be resubmitted with a higher score.
- **Due dates were shifted by the time zone.** Lists showed as overdue on their own due date and as the previous day west of UTC, in the web app and in bot embeds; dates are now compared and formatted as dates.
- **Reset progress and auto-delete left AI data behind** (embeddings, chat threads, cached summaries). They are now purged.
- **Reordering produced duplicate positions** (the web sent a 1-based index and the API accepted any number), which made the bot's swap do nothing. Positions are now unique and contiguous.
- **A missed or failed deadline DM was never retried**: reminders only matched the exact due day and a list was marked as notified even when the DM failed for a temporary reason.
- **Half of the achievements were never shown** on the Achievements page (it listed the wrong category names).
- The Profile stat tiles lost their colours (Tailwind cannot see dynamically built class names), the Assassin class was unreadable on dark cards, and Settings had a dead "Add Bot to Server" link and used `window.confirm` for logout.
- The daily-claim button forgot it had been claimed after a page reload.
- Through Express, resuming a chat with nothing waiting returned 503 instead of 409.
- On MySQL, every embedding and LangGraph checkpoint write failed ("'str' object is not callable"), because PyMySQL 1.2 broke aiomysql's bytes escaping. PyMySQL is now pinned below 1.2. Found by the new `ai-mysql` CI job.
- The AI service ignored `DB_SSL_CA`, so TLS to hosts with a custom CA failed.
- Non-JSON error pages from Express crashed chat tools instead of producing a clear error.
- Resuming a paused chat skipped the daily quota check, and title generation was never counted in usage.
- Retrieval and history indexing used the host's local date instead of UTC.
- Quest filters in search let help-doc and history chunks through.
- Turning AI off kept a user's vectors until their next edit; they are now deleted immediately.
- Edits made in Discord were not re-indexed until the next reconcile pass.
- `/summary` read a quest whose name is only digits (e.g. "2026") as a list id, and a failed autocomplete lookup was unhandled.
- A shared in-memory SQLite connection made the chat confirmation tests fail on Python 3.12.
- The AI reconcile job now notices edits to a quest itself (name, deadline, priority), not only to its subtasks. New migration `004_lists_updated_at` adds `lists.updated_at`.

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
