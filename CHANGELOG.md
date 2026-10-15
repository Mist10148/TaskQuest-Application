# Changelog

All notable changes to TaskQuest. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Upgrade notes

- **Run the migrations.** `npm run db:migrate` (or just start the bot or the server) applies `010` to `022` in order; take a backup first. Do not point a database that was migrated at an intermediate commit of this branch at the release: migrations `011` and `012` were edited across commits before release, so reset such development databases ([KNOWN_ISSUES](docs/KNOWN_ISSUES.md)).
- **Re-register slash commands** (`npm run deploy:commands`): `/review`, `/prestige`, `/shop`, `/share`, `/invites`, `/members`, `/leave` and `/party` are new, and `/list` gained a Details button.
- **New optional environment variables** for web push: `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` (set all three or none), plus `WEB_PUSH_ALLOWED_HOSTS`, `WEB_PUSH_INTERNAL_URL`, `WEB_PUSH_INTERNAL_TOKEN` and `WEB_PUSH_TIMEOUT_MS`. Nothing changes while they are unset. See [DEPLOYMENT.md](docs/DEPLOYMENT.md#web-push-optional).
- **Invite handles fill in over time.** Sharing lists and parties invites people by their exact Discord username (`users.discord_handle`, migration `021`). It is stored at each person's next web login or slash command, never backfilled, so a person who has not used TaskQuest since the upgrade cannot be invited yet.
- **Open arcade tabs must be refreshed.** Arcade runs now carry a recorded input timeline; an old client gets a "refresh the page" error instead of XP.
- **Blackjack no longer takes class or skill bonuses**, so a Hero or Gambler earns less from it than before. Nobody's level drops: the level curve is unchanged.

### Added

- **Class rebalance and five new classes.** Twelve classes now (Default, Hero, Gambler, Assassin, Wizard, Archer, Tank plus **Monk** (Rhythm of consecutive days), **Artisan** (Project progress and list-clearing), **Ranger** (early and on-time finishes), **Necromancer** (revive overdue tasks, collect souls) and **Paladin** (HIGH priority Vows, a forgiving streak)) and 62 skills (27 before): 15 new skills extend the six old trees and each new class has four. Migration `011_class_rework`.
  - The Assassin's streak and stacks decay after 36 hours without acting (48 with Night Owl), the Tank's shield cap grows with level (`min(15, 3 + level ÷ 3)`, plus Absorb; it used to shrink as `max(3, 20 − level)`), and the Hero's flat +25 is capped at 3 × the base reward (Oath raises it to `min(25 + level, 50)`).
  - New skills include Freeze Cache, Daily Surprise, Momentum, Rally, Anchor, Insurance, Hot Hand, Night Owl, Bleed, Overcharge, Tome, Quiver and Eagle Eye. The Discord class browser and the web Classes, Skills and Profile pages show all twelve with their counters.
- **New XP sources**, all flat XP with their own daily caps, paid in their own `xp_transactions` source and counted on the weekly board ([XP_GUIDE.md](docs/XP_GUIDE.md) lists every one). Migration `012_xp_sources`.
  - **Task bonuses** on a task's first completion: first task of the day (+10), list cleared (+25), finished early (+5 a day early, max +20), overdue cleared (+10), all subtasks done (+10). They are listed with the completion result.
  - **Streak chests**: the daily claim that reaches a 7, 14 or 30 day streak also pays +100, +250 or +600 XP, once per streak run.
  - **Achievement rewards**: +25 XP for each newly unlocked achievement.
  - **Habit streaks** on repeating tasks: +2 XP per step from a streak of 2 (max +20 a completion, 60 a day).
  - **Focus sessions**: a server-timed 10 to 90 minute work timer that pays 0.6 XP a minute (100 XP and 8 sessions a day), on the new **Focus** page.
  - **Weekly review**: +40 XP once a week after finishing a task, on the new **Review** page and with `/review`.
  - **Monthly boss quest** (complete 50 tasks, 400 XP) and a **rotating weekly quest** pool of four (the ISO week picks one), alongside the daily and weekly quests.
  - **Prestige** at level 30 (up to 10 times): start over for a permanent +2% XP and a title; achievements, quest claims, tasks and the daily streak are kept. The never-reset lifetime XP total feeds the XP achievements and the lifetime leaderboard. `/prestige`, Profile page.
- **CSV import.** `POST /api/import/csv` reads a TaskQuest CSV export or any spreadsheet whose first row names its columns, with a dry-run preview and row-numbered errors; a Settings dialog drives it. Same rules as the JSON import: all or nothing, per-account quota, no XP.
- **Task templates**: save a quest's tasks as a template and start a new quest from it or append to one (20 templates of up to 30 tasks; subtasks, due dates and completion are not kept). Migration `014_templates`.
- **Search inside tasks.** `GET /api/lists/search?scope=lists|tasks|all` matches task names and descriptions, and the web search shows task hits.
- **Stats and review pages.** New `GET /api/stats/xp-history` and `/api/stats/summary`, and the web pages **Stats** (XP over 7, 30 or 90 days, XP by source, busiest weekday), **Review**, **Focus**, **Shop** and **Party**, each in the sidebar and the Ctrl+K palette.
- **Per-task reminders.** A task with its own due date gets its own DM (and web push) on its due day at your reminder hour, with Snooze and Stop buttons; a task due on its list's deadline is covered by the list reminder. Migration `013_task_reminders`.
- **Discord list editor details.** The `/list` views show each task's due date, priority, tags, repeat and subtasks, and a **Details** button edits them (an empty field clears it). The completion bonuses a task paid are listed too.
- **New Discord commands:** `/review`, `/prestige`, `/shop`, `/share`, `/invites`, `/members`, `/leave` and `/party` (status, create, invite, invites, kick, leave, disband). Stats, Focus, templates, CSV import and push stay web only.
- **AI tool updates.** Chat tools gained `update_item` and `break_down_task` (2 to 8 subtasks in one transaction) and `add_item` takes due date, priority, tags, repeat and parent. Confirmation previews list every field. New internal routes `PATCH /internal/items/:id` and `POST /internal/items/:id/subtasks`.
- **Cosmetics shop.** Titles, avatar frames and profile accents bought once with XP (some need a level, a prestige or an achievement), with no gameplay effect; they show on the profile, sidebar and leaderboard. `/shop`, the **Shop** page, migration `016_cosmetics`. Cosmetic purchases count as spending for the spending achievements.
- **Optional web push** for reminders: a service worker, VAPID keys, a Settings switch per browser and `POST /internal/push` for the bot, all off unless the `WEB_PUSH_*` variables are set. Push endpoints are limited to the browsers' own push services on port 443. Migration `017_web_push`.
- **Days follow your time zone.** Daily caps, the first-of-day bonus, Monk Rhythm, Ranger and Necromancer due-date checks, daily, weekly and monthly quests, the weekly review and the Stats page use your own day, Monday-to-Monday week and month (UTC until you set a zone), with DST-safe local midnights. A zone change is allowed once every 24 hours so zone hopping cannot reset caps (migration `015_timezone_days`). The weekly leaderboard stays on one global UTC week.
- **Arcade anti-cheat.** Snake, Dino Runner and Space Invaders are deterministic fixed-step simulators shared by the web app and the server; the browser records every input, and the server replays the run and pays on the score it derives itself. Runs that do not replay, run too long, press too fast or do not fit the elapsed time are rejected. Design: [arcade-anti-cheat](docs/design/arcade-anti-cheat.md).
- **Playwright e2e suite** (`npm run test:e2e`, own CI job against MySQL 8) for the main flows: dashboard, tasks, Focus, Stats, Review, shared lists and parties.
- **Shared lists and parties.** Invite people to a list as viewer, editor or manager (members, roles, accept or decline, leave, 7-day invitations) and form a party of up to six with a shared weekly quest (12 tasks per active member, +60 XP each for 6 tasks of their own). XP, caps, quests and stats belong to whoever acted. Invitations name a person by their exact Discord username with a confirmation step on the web, and the AI service never reaches a list you merely belong to. Migrations `018_list_members`, `019_parties` and `021_sharing_hardening`. Design: [shared-lists](docs/design/shared-lists.md).
- **Docs:** [XP_GUIDE.md](docs/XP_GUIDE.md), [CLASS_GUIDE.md](docs/CLASS_GUIDE.md), [PLAYER_FAQ.md](docs/PLAYER_FAQ.md), [design/balance.md](docs/design/balance.md), a docs index ([docs/README.md](docs/README.md)) and a test that fails when GAMEPLAY.md disagrees with `constants.js`.
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

- **Balance pass 1: the strongest classes are reined in** (numbers re-derived with `scripts/balance-sim.js`; see [design/balance.md](docs/design/balance.md)).
  - Monk: 2% of the base per Rhythm day (was 3%), Steady Breath +0.5 per day (was +1), Inner Focus +15% per level (was +25%), Discipline +2 Rhythm (was +4). A full-tree Monk was about 12× the base, now about 6×.
  - Wizard: Wisdom is level × 2 (was × 5). A level-29 full tree was 31× the base, now about 14×.
  - Hero: Champion is +50% (was ×2) and Legendary +15% (was +25%).
  - Gambler: the bonus is 0 to (2 × base + 40) (was base + 99) and the class costs 450 XP (was 300). Unskilled it was 5.5× the base, now about 3.4×.
  - Archer: 6% per streak step (was 8%), +2 + ⌊streak ÷ 2⌋ flat per hit (was +3 + streak), headshots ⌊1.5 × base⌋ + 2 per streak (was 2 × base + 3), perfect shots 3% for 3 × base + 6 per streak (was 5% for 4 × base + 10).
- **The daily streak now follows your calendar days.** It continues when you claim on the next day (your time zone); Streak Shield and the Paladin forgive one missed day, Sanctuary two, and each further missed day costs a streak freeze. Before, a rolling 48/72/96 hour window let someone claiming every 47 hours add one streak day per two calendar days. The 24-hour cooldown between claims is unchanged, and the streak leaderboard keeps the rolling windows as an approximation (it can show a lapsed streak for up to a day). `DAILY.STREAK_DAYS`, `SHIELDED_STREAK_DAYS`, `SANCTUARY_STREAK_DAYS`.
- **Champion and Legendary only work while the Hero is equipped.** They were generic skills, so a Monk or Wizard that had bought the Hero tree doubled and boosted its already large output. Skills can now carry `classOnly: true` (`activeSkills` in `xp.js`). Valor and Inspire stay generic.
- **Prestige now also pays +1 flat XP per prestige on every task completion** (up to +10), next to the +2% multiplier. The percentage alone rounded away on small rewards (a 10 XP task stayed 10 XP even after ten prestiges). `PRESTIGE.FLAT_PER_PRESTIGE`.
- **The level curve stays linear on purpose.** A level is still 100 lifetime XP. A steeper curve was considered and rejected so that no veteran's level drops; the reasoning is in [design/balance.md](docs/design/balance.md).
- **Blackjack** pays a flat 1:1 (3:2 for a natural) with no class or skill bonuses, because any larger payout made it a positive-expectation XP farm (see Fixed for the abandoned-hand rule).
- **Tailwind CSS 4.** The web app moved to Tailwind 4 with a CSS-first config (`@tailwindcss/vite`, `tw-animate-css`), which also cleared the dev-only dependency advisories: `npm audit` is clean for the whole tree. Notes: [design/tailwind-4-migration.md](docs/design/tailwind-4-migration.md).
- **Quests and caps are per person.** Every quest, daily cap and weekly number counts the person who acted, also on a list somebody else owns; the weekly leaderboard keeps its single UTC week.
- **Docs:** the PRD, README, GAMEPLAY, COMMANDS, API, DATABASE, ARCHITECTURE and KNOWN_ISSUES were brought in line with the code; the PRD's user stories now carry section prefixes (`US-P1`, `US-G1`) so they no longer collide with personas and goals.
- **Web UX pass:** one mobile gutter, touch-visible controls, per-button pending states and a confirm dialog with "balance after" for spending XP, a daily-claim countdown, a drag handle with optimistic reorder and Shift-click selection, optimistic Settings switches, new text colour tokens that meet WCAG AA, a Leaderboard with arrow-key tabs, Achievements filters and progress bars, a Ctrl+K command palette and a first-run tour.
- **The leaderboard defaults to lifetime XP** instead of the spendable balance, so buying a class or skill no longer lowers your rank.
- **Auto-delete only removes finished lists.** It used to also delete unfinished lists five days after their deadline; overdue lists now stay visible.
- **Reminders** are sent at the user's reminder hour in their time zone (UTC and 09:00 until set), and a reminder missed during an outage is sent late (up to 3 days) instead of never.
- **Web bundle**: each page is a lazy-loaded chunk with stable vendor chunks, and 36 unused UI primitives and 30 packages were removed. The Tasks page is split into focused components.
- Dark-theme colours that failed contrast (the Assassin badge was 1.5:1, destructive button text 3.8:1) were fixed.
- Node 22 is now required. Node 20 is end-of-life, and its test runner could not expand the test globs, which had broken CI since 8 October.
- LangChain, LangGraph and `langgraph-checkpoint` are pinned to their tested major versions.

### Fixed

- **HIGH priority bonuses are capped at 3 a day.** Priority is the player's own label, so marking every task HIGH made the Paladin's Vow, the Hero's Rally, the Archer's Sniper and Crusade pay on everything. Only the first 3 HIGH first-completions of your day now count as HIGH for classes and skills; later ones are treated as medium. The Heavy Lifter quest is unchanged (`LIMITS.HIGH_BONUS_PER_DAY`).
- **The Artisan is no longer punished for finishing lists.** Clearing a list kept nothing and paid +5 per progress, so in the model it earned less than never clearing. A clear now keeps half the progress (rounded down) and pays +8 per progress (`CLASS_RULES.ARTISAN.CLEAR_KEEP_PERCENT`, `CLEAR_XP_PER_PROGRESS`).
- **Class bonuses on adding a task and creating a list are capped.** The whole reward of those two actions is now at most 4 × the base (20 XP for a task, 40 for a list), whatever the class and skills add. Before, a full-tree Monk earned about 5,400 XP a day from the 50 rewarded additions and a level-29 Wizard about 15,000, nearly as much as from completing tasks.
- **Cleanup pass 3.** AI: a failed model call no longer refunds the daily quota twice (which erased an earlier request's booking); the quota is counted atomically across features on MySQL; the vector cache is invalidated after the commit and a load that straddles an invalidation is not cached; concurrent index calls and summary caching no longer fail on the unique key; the AI service refuses to start with an `AI_INTERNAL_TOKEN` of 1 to 31 characters; list tool deadlines must be real dates; the keyword fallback of search honours status and category; retrieval and the prioritizer now see each subtask's due date, priority and tags (the next reconcile re-embeds quests once). Server: a stalled chat stream is cut after `AI_STREAM_IDLE_MS` (default 90 s) and the browser is told; the session store no longer double-calls callbacks. Shared: one broken stale game session no longer stops the others from expiring; re-completing a completed task keeps its completion time and attribution; a free-game run past the daily cap no longer advances class counters; the decline cooldown counts from the decline (migration `022`) and accepting a party invitation no longer puts other inviters on cooldown; **a streak freeze covers one missed day** and a lapsed streak reads 0 for Momentum and the streak board. Web: quick add keeps its text when the task is not created, a failed resume of a confirmation shows the card again, a 401 returns the app to sign-in at once, the task toggle and confirmation card are accessible, and the chat respects the animations setting. First web component tests (jsdom and Testing Library) for the quick-add bar, task row and confirmation card.
- **Hardening pass.** `TRUST_PROXY=true` (or any non-number) used to trust no proxy, which broke login cookies and shared one rate-limit bucket; it is now parsed properly and a bad value stops startup. Discord login failures redirect with an error instead of returning a raw 500. The public leaderboard no longer puts Discord IDs in avatar URLs (an opaque token and a small proxy route instead) and is cached for 30 seconds. The invitation limit no longer reveals which usernames exist. One failing reminder no longer aborts the batch. Importing a subtask whose `parent_id` is a string now keeps it a subtask, and `orphanedSubtasks` reports parents that are missing. `DB_SSL` accepts `1`/`yes`, an interrupted AI stream ends with an error event, shutdown no longer waits on open chat streams, and `deploy-commands` accepts `DISCORD_CLIENT_ID`.
- **Performance.** Time zone validation and the per-zone day formatter are cached.
- **Deadlock under load.** `lockUser` could deadlock against list locks (shared lists, add several, invitation replies), and a MySQL deadlock victim failed the whole request. User rows are now locked first, lists in ascending order (and list-first in `forItem`), and `withTransaction` retries deadlock victims.
- **Due dates could be backdated for bonuses.** Overdue and early effects (early finish, overdue clear, Ranger, Necromancer, Early Riser, Spring Cleaning) now need a due date set at least 24 hours before the completion (migration `020_due_date_set_at`).
- **Sharing hardening.** Editors delete only tasks they added; members get a column whitelist of lists and tasks, not the whole row; invitations are withdrawn when their inviter loses the right to invite; unknown, unavailable and declined invitees all get the same neutral answer; a decline blocks the same inviter for 7 days; names are escaped in invitation DMs, embeds and reminders; a progress reset zeroes quest, review and party progress; party rewards need your own work since joining and the target counts active members only.
- **Reminder floods.** A person gets at most 20 reminder DMs an hour (the rest collapse into one digest), and re-dating a task or list re-arms everybody's reminders at most 3 times a day.
- **Quotas on every path.** The 200 list and 5000 task limits are enforced when creating, adding several, breaking down, importing and applying templates; imports retry names that collide by accent or case; the large body parsers sit behind session, auth and the rate limiter.
- **AI context.** Quests that anybody else belongs to are never the owner's AI context; lifetime XP after a prestige is read from the never-reset total; public converse threads are separate from tool-bearing history; quota is refunded on early failures and `/v1/prioritize` degrades to the heuristic when the quota is exhausted.
- **Smaller fixes:** the Artisan clear bonus pays once per list, the Sniper text matches the code, list paging in Discord keeps sort and filter, Approve and Cancel come back when a resume call fails, and several web glitches (toggle guard, tour restart, calendar feed flash, prestige cache invalidation, import input reset, Snake keys, achievement XP).
- **Blackjack could be farmed.** Winnings took class and skill bonuses, so a Hero betting 10 earned +35 per win with no cap. Blackjack now pays a flat 1:1 (3:2 for a natural). Every hand abandoned for 30 minutes is now played out with you standing and settled, instead of refunded (a refund would let you look at the deal and walk away from a bad hand). Games refuse to settle while XP is off, arcade starts share the free-game cooldown, and a zero-score arcade run is a loss, not a win.
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

### Security

- Web push endpoints are accepted only for the browsers' own push services (or hosts listed in `WEB_PUSH_ALLOWED_HOSTS`), on port 443, and never for IP literals or internal names, so a subscription cannot point the server at an internal address.
- Invitations cannot be used to probe who uses TaskQuest: every outcome the inviter must not learn gets one neutral answer, the lookup is rate limited per account and per address, and the web app asks the inviter to confirm the person it resolved. Discord IDs never leave the server (members use an opaque key).
- Arcade scores are verified by replaying the recorded inputs instead of trusting the client.
- Dev-only advisories in the Tailwind 3 toolchain are gone with the Tailwind 4 migration.

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
