# Changelog

All notable changes to TaskQuest. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Highlights

- **PostgreSQL replaces MySQL** (empty start; read the upgrade notes first).
- **Optional AI features** (summaries, prioritiser, chat with confirmed write actions, bot persona) in a separate `apps/ai` service.
- **Shared quests and parties**, with assignees, comments and a per-task history.
- **New game systems:** ten more classes, quests, prestige, the cosmetics shop, focus sessions, the weekly review, the Today page and arcade replay verification.
- **Web app:** Tailwind 4, board and calendar views, a task drawer, bulk edit, keyboard task cursor, accessibility preferences and Playwright tests.

### Upgrade notes

> **Migration numbers in this section.** Entries below that name a migration from `004` up to `026` (for example `018`, `021`, `024`) refer to the pre-squash MySQL migration names. Those migrations are folded into `001_baseline`; the migrations that exist in `packages/shared/src/db/migrations` are `001_baseline`, `002_drop_skill_points`, `003_ai_prioritize_cache`, `004_item_assignee`, `005_item_activity` and `006_item_comments`, so the next one is `007`. Names below such as `003_ai`, `004_lists_updated_at`, `005_ai_thread_source` and `006_ai_chat_format` are pre-squash names and do not match the files of the same number.

- **The database is now PostgreSQL (Supabase), and it starts empty.** MySQL, MariaDB and TiDB are no longer supported, and nothing is copied from the old database: players link again on their first command or web login. Create a Supabase project, set `DB_URL` to its **Session pooler** URL (port 5432) with `DB_SSL=true`, and deploy; the single migration `001_baseline` runs on start. Follow [MIGRATION_POSTGRES.md](docs/MIGRATION_POSTGRES.md) for the runbook and rollback. Do not deploy this release against the old MySQL database: it can no longer talk to it.
- **Two new migrations run on start** (`002_drop_skill_points`, `003_ai_prioritize_cache`). `002` drops a column the previous version still reads, so rolling back to the previous version after it ran is not supported; take a backup first if that matters (see OPERATIONS).
- **The AI service has a new dependency, `tzdata`** (`pip install -e .` in `apps/ai`), and its daily quota now follows each user's own day. Run `python -m app.preflight` before enabling AI on a new environment.
- **Old class-browser, achievement and reorder buttons expire.** Their custom IDs changed (the position is now in the ID), so such a message that is still open when the bot restarts on this version answers "This button has expired"; run the command again.
- **Re-register slash commands** (`npm run deploy:commands`): `/review`, `/prestige`, `/shop`, `/share`, `/invites`, `/members`, `/leave` and `/party` are new, and `/list` gained a Details button.
- **New optional environment variables** for web push: `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` (set all three or none), plus `WEB_PUSH_ALLOWED_HOSTS`, `WEB_PUSH_INTERNAL_URL`, `WEB_PUSH_INTERNAL_TOKEN` and `WEB_PUSH_TIMEOUT_MS`. Nothing changes while they are unset. See [DEPLOYMENT.md](docs/DEPLOYMENT.md#web-push-optional).
- **Invite handles fill in over time.** Sharing lists and parties invites people by their exact Discord username (`users.discord_handle`, migration `021`). It is stored at each person's next web login or slash command, never backfilled, so a person who has not used TaskQuest since the upgrade cannot be invited yet.
- **Open arcade tabs must be refreshed.** Arcade runs now carry a recorded input timeline; an old client gets a "refresh the page" error instead of XP.
- **Borrowed flat skills stop working.** Valor, Fortify, Arcane Study and Multishot now only work while their own class (Hero, Tank, Wizard, Archer) is equipped, so a player who bought them for another class loses that bonus. The skills stay owned; a tree reset (Skills page) refunds 75%. Nothing else about owned skills, classes or levels changes.
- **Blackjack no longer takes class or skill bonuses**, so a Hero or Gambler earns less from it than before. Nobody's level drops: the level curve is unchanged.
- **A repeating task stops repeating at the 5,000 task limit.** Its copy is a new row (the completed task stays), so it now counts against the list owner's quota; at the limit completing it pays as usual but creates no next copy until you delete some tasks.
- **Time zones are stored in canonical form.** `europe/paris` is saved as `Europe/Paris`, and offset zones such as `+05:30` are refused. A value saved earlier is left as it is; the AI service falls back to UTC for a name it cannot resolve.
- **The CSV export has a `description` column** (last, so older readers still work).
- **Three more migrations run on start** (`004_item_assignee`, `005_item_activity`, `006_item_comments`): task assignees, a per-task history and task comments. They only add a column and two tables.
- **Quest progress counts top-level tasks.** `itemsTotal` / `itemsCompleted` in `GET /api/lists` no longer count subtasks, so a quest's progress bar matches when it counts as cleared.

### Added

- **Recent XP on the Stats page** (the last transactions, earned and spent, with their sources), using the history endpoint the web app never showed. The Stats chart says "nothing to chart" instead of drawing a flat line, the Focus page links to the party's focus quest when there is one, the leaderboard has a **My class** shortcut, and Games history can show all of its rows.
- **Keyboard play:** type a letter to guess in Hangman; H, S and D hit, stand and double in Blackjack.
- **Migration runner checksums.** `schema_migrations` gets a `checksum` column (added by the runner itself, no new migration); a shipped migration that was edited, or a database that holds migrations this version does not know (an older deploy against a newer schema), is reported as a warning at start.
- **AI service housekeeping** (KNOWN_ISSUES #51, in part): old checkpoints are pruned after each turn (the latest three are kept), idle chat threads are removed by the reconcile loop (Discord memory after 30 days, web chats after 90), cached summaries older than 7 days are dropped, and re-index calls for one list within `EMBED_DEBOUNCE_SECONDS` (default 3) share one embedding run. `DB_URL` with `?sslmode=require` now turns TLS on for the AI service as it does for the Node apps.
- Component tests for the Stats, Settings, Leaderboard, Shop and Classes pages.

- **Move tasks between quests.** "Move to another quest" in the task drawer and a bulk **Move to…** in select mode move a task with its subtasks to the end of another quest you can edit (`POST /api/items/:id/move`).
- **Assignees on shared quests.** A task on a shared quest can be assigned to its owner or a member (task drawer), shows who has it on its row, can be filtered by "Assigned to me" or "Unassigned", and a task assigned to you on someone else's quest shows on your Today page.
- **Comments and activity on a task.** The task drawer has a **Comments** tab (anyone who can edit the quest can comment; the author or a manager can delete) and an **Activity** tab with every change: created, renamed, done or reopened, priority, due date, assignee and moves. Rows show a comment count.
- **Filters and groups.** A filter bar above a quest narrows the tasks by status, priority, due window (overdue, today, next 7 days, none), tag and assignee in every view, and the list view can group tasks by priority, due window or tag. Remembered per browser.
- **Drag on the board.** Drag an open card to another priority column (or use its priority menu, which works by keyboard and touch) to change its priority.
- **Bulk edit of tags.** The bulk edit dialog can add, remove or replace tags on the selected tasks.
- **A streak strip on the dashboard.** The Today page's seven-day strip also shows under the dashboard stats.
- **Calendar keyboard navigation.** The calendar is one tab stop; arrows, Home/End and PageUp/PageDown move between days and months.
- **Repository templates.** GitHub issue and pull request templates, and Dependabot for npm, pip and GitHub Actions.
- **A task detail drawer.** An info button on each task (and `i` on the highlighted one) opens a side drawer with the full description, priority, due date, repeat, estimate, tags and subtasks, with Mark done / Reopen and Edit for anyone who can edit. A viewer of a shared quest can read it too.
- **Bulk edit.** In select mode an **Edit** button changes the priority, due date and (see above) tags of the selected tasks together (keep, set or clear each), through the existing update endpoint with one summary toast.
- **The command palette finds tasks.** Ctrl+K lists tasks whose name or description match (two or more characters, the same search as the quest log) with their quest, and opens that quest.
- **A streak strip on the Today page.** The last seven days as flames, from the streak the page already returns.
- **High contrast and text size.** Two per-device settings under Settings > Appearance: stronger text and border colours, and a normal / large / larger page scale.
- **An installable web app.** `manifest.webmanifest`, 192 and 512 px icons, a maskable icon, an Apple touch icon and a theme colour (all drawn from the existing SVG mark), so the app can be added to a phone's home screen. Push notifications use the PNG icon. The service worker is still push-only and caches nothing.
- **An offline banner and a plain network error.** A notice shows while the browser is offline, and a request that fails before reaching the server says "You appear to be offline" instead of "Failed to fetch". Nothing is queued offline, so rewards stay server-authoritative.
- **A keyboard cursor over tasks.** Inside a quest, `j` and `k` move a highlighted row, `x` completes or reopens it, `e` edits it and `d` deletes it (with Undo). Listed in the `?` dialog.
- **A route error boundary.** A page that fails to render or load (typically a code chunk replaced by a deploy while the tab was open) shows a Reload card instead of a white screen, and a `vite:preloadError` reloads once.
- **A README screenshot capture spec.** `apps/web/e2e/screenshots.e2e.ts` (skipped unless `CAPTURE_SCREENSHOTS=1`) signs in as the seeded player and saves twelve pages to `docs/images`; the images themselves are not captured yet (known issue #26).
- **Live-Gemini preparation.** `python -m app.preflight [--check-models] [--url ...]` checks the key, token, model ids, `EMBED_DIM` against the pgvector column and the AI tables, optionally asks Google which configured model ids exist and can do the job (a header, never the URL, carries the key), and exits 1 on any failure; `python -m tests.evals.compare report.json [--baseline earlier.json]` judges a saved eval report against the live targets and flags regressions. The golden sets grew to 70 retrieval queries (incl. a cross-user bait query), 10 summary and 10 prioritizer cases, with four new seeded users, and the red-team set grew too; they still pass offline. Nothing here calls Gemini: the default model ids are unchanged, and known issues #17 and #18 stay open until a real run.
- **Push for AI results, where it helps.** The Monday digest's AI recap headline is also sent as a web push when push is set up (only when a recap was written, once the digest is final, best effort), and a summary or "what should I do next?" that finishes while the player is on another tab shows a local notification through the service worker (`announceResult`: only when the page is hidden, notifications are already allowed and push was turned on; it never asks for permission). A server push per AI reply is deliberately not built: the answer already reaches the open page.
- **A shared prioritizer cache.** Migration `003_ai_prioritize_cache` adds `ai_prioritize_cache`; the AI service keeps a ranking in memory and in that table for 5 minutes (key: user, limit and a hash of the open-task features), so a second AI instance reuses it instead of asking the model again. A missing table or a database error is only a cache miss, a user's cached rankings are removed with the rest of their AI data on `/forget`, and fallback results are still never cached. On PostgreSQL the vector search already runs in SQL, so nothing needed sharing there. Closes known issue #20.
- **Skill tree reset in the bot.** The `/class` skill view has a **Reset Tree** button (enabled once you own a skill from that tree): it asks for confirmation, shows the refund (75% of the tree's cost, once a day, never lifetime XP) and then calls the same `respecSkills` as the web. Previously the reset existed on the web and in the API only.
- **An i18n scaffold for the web app.** A typed message catalog (`apps/web/src/i18n`: `messages.ts`, `translate()` with `{name}` placeholders and English fallback, a `useT()` hook) and a per-device `locale` preference that also sets `<html lang>`. The Review and Not-found pages use it; the rest of the app is still inline English, and there is no second language yet. No new dependency.
- **More web component tests.** The shared loading and error states (`QueryState`, `ErrorCard`), the XP bar, stat card and achievement badge, the quests card and the Review page now have tests (known issue #24 reworded).
- **A local PostgreSQL in one command.** `docker-compose.yml` runs `pgvector/pgvector:pg16` with the dev, test and browser-test databases (`npm run db:up`, `db:down`, `db:reset`); README, CONTRIBUTING and START_HERE use it.
- **PostgreSQL on Supabase.** The bot, web server and AI service run on PostgreSQL with pgvector ([MIGRATION_POSTGRES](docs/MIGRATION_POSTGRES.md)):
  - Node uses `pg` behind a small compatibility layer; the AI service uses `asyncpg`.
  - The 26 MySQL migrations are squashed into one `001_baseline`.
  - RAG search ranks embeddings in SQL (`vector(768)`, exact per-user cosine top-k) instead of loading them into numpy.
  - CI runs on `pgvector/pgvector:pg16`.
  - List, template and party names stay unique ignoring case, but accents now count ("Cafe" and "Café" are two lists).
  - Times keep milliseconds.
- **Documentation checks and a what's-new page.** `docs.test.js` now also checks that the numbers in every class description match `CLASS_RULES`, that the skill effects in GAMEPLAY use the numbers of the skill descriptions, and that the CLASS_GUIDE build tables are exactly what the balance simulator prints (it found two stale card texts: the Ranger's +2 XP per day early is 3, Holy Aura's +2 is 3). [WHATS_NEW](docs/WHATS_NEW.md) summarises 4.0 and the balance pass for players.
- **An archive job and a class report.** `npm run archive -- --days 365 [--games] [--dry-run]` moves old XP transactions (and finished game sessions) to archive tables in batches. `xp_transactions.player_class` records the class a reward was earned in (migration `026_balance_data`), and `npm run xp-report` prints the real average XP per action by class. `npm run balance` prints the simulated balance tables.
- **A streak-at-risk warning.** On the evening of the last day a streak of 3 or more days can be saved, the bot DMs (and sends a web push) once, for players with reminders and XP on. `users.streak_warned_day` (migration `025_streak_warnings`), `db.today.getStreakWarnings`.
- **A party board and a second party quest.** The Party page and `/party status` rank the members by this week's finished tasks and focus minutes, and a new weekly quest, **Focus together** (60 focus minutes for every member who focuses, +40 XP each for 20 minutes of your own, separate claim `POST /api/parties/focus/claim`), joins the task quest.
- **Ownership transfer for shared lists.** The owner can hand a list to one of its members (a crown button in the Members dialog, `POST /api/lists/:id/transfer`); the old owner stays on it as a manager. It is refused when the new owner already has a quest with that name or would pass the quest or task limits.
- **Phone ergonomics.** A bottom navigation bar on small screens (Today, Tasks, Focus, Home and a More button for the full menu) and swipe-right-to-complete on a task row (a long, mostly sideways swipe; the checkbox and keyboard work as before).
- **Board and calendar views.** A quest can be shown as a list (as before), a **board** (columns by priority; complete a task from its circle) or a **calendar** (a month grid of due dates with the open count per day and the tasks of the picked day). The choice is remembered in the browser.
- **A tiered skill tree and "Next unlocks".** The Skills page lays each tree out in tiers by how many prerequisites lead to a skill (columns on a wide screen, stacked with arrows on a phone). The dashboard has a card with the three achievements you are closest to and what is left of each.
- **A clearer XP toast and an Undo button.** The "Task done" toast lists each part of the reward on its own line (base, class and skill parts, every bonus), and carries an **Undo** button for a few seconds that un-checks the task again (the XP stays paid and finishing it again pays nothing, as always).
- **A Today page** (`/today`, `GET /api/today`): what is overdue, due today or HIGH priority with a tick button, a warning when today is the last day to keep your streak, the weekly modifier, and the reflection and weekly goal cards. It is also in the command palette.
- **Skill respec.** Unlearn a whole skill tree and get 75% of its cost back (a refund, never lifetime XP), once a day: a Reset button on the Skills page, `POST /api/skills/respec`. Skills used to be a one-way purchase.
- **"What would I earn?" previews.** The Classes page shows, before you buy, what a 10 XP task pays with no skills and with the whole tree; the Skills page shows what each skill's next level adds for your equipped class. A deterministic simulation of the real XP rules (`simulateAverage` in the shared package, also used by `scripts/balance-sim.js`); `GET /api/classes/:key/preview`, `GET /api/skills/preview`.
- **Task estimates and a good-estimate bonus.** A task can carry an estimate in minutes (`estimate_minutes`, 1 to 600; export and import keep it). Finishing it within 10 minutes after a focus session whose real minutes are within 25% of the estimate pays +10 XP (30 a day). The web task form has an Estimate field.
- **A daily reflection and a weekly goal.** Write one line about your day for +10 XP (once a day), or set how many tasks you will finish this week (3 to 60) and claim 10 + 2 XP per task, at most 80, when you get there. `/api/reflection`, `/api/goal`; migration `024_engagement` adds the tables.
- **Five more task bonuses** (flat, capped, on a task's first paid completion, listed with the completion result): **perfect day** (+30, every task due today done), **inbox zero** (+40 a week, the last overdue task cleared after three), **boss defeated** (+30, the last subtask of a task with 4 or more), **welcome back** (+25, the first completion after 3 idle days) and **party assist** (+3 a completion in a party, 15 a day).
- **A weekly modifier.** Each UTC ISO week doubles one flat bonus source (early finish, overdue cleared, habit streaks or list cleared, in rotation). `SEASONS`, `currentSeason`.
- **Five more classes (17 in total):** **Bard** (a medley of tasks from different lists), **Alchemist** (brew by completing LOW, MEDIUM and HIGH tasks), **Druid** (habit streaks of repeating tasks), **Chronomancer** (tasks finished right after a focus session) and **Warden** (tasks on shared lists), each with four skills (96 skills in total). Migration `023_new_classes` adds `owns_*` flags and the `bard_recent` and `alchemist_mix` counters. See [CLASS_GUIDE](docs/CLASS_GUIDE.md).
- **Fourteen more skills (76 in total):** one new last skill in every class tree and three in the Default tree. Scholar (+15% on the first task of the day), Night Shift (+5% per level from 21:00 to 05:00 your time), Tidy Mind (+8 XP per level when you clear a list), Hero's Last Stand, Gambler's Loaded Dice, Assassin's Vanish, Wizard's Cantrip, Archer's Ricochet, Tank's Taunt, Monk's Meditation, Artisan's Prototype, Ranger's Tracker, Necromancer's Soul Eater and Paladin's Aegis. See [GAMEPLAY §4](docs/GAMEPLAY.md#4-skills).
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
- **Playwright e2e suite** (`npm run test:e2e`, own CI job against PostgreSQL) for the main flows: dashboard, tasks, Focus, Stats, Review, shared lists and parties.
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
- CI: the AI service's SQL runs against PostgreSQL with the migrations applied (`ai-postgres` job).
- [docs/AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md) explains how the LangChain/LangGraph service is built.
- Quick due-date picks (Today, Tomorrow, Next week, No date) in the task form.
- Search inside a quest, `?task=` links that open a task's drawer (from search results and the command palette), keys `1` `2` `3` for the views and `Shift A` to select all, a confirmation before deleting more than five tasks, and a quick-add hint in an empty quest.
- Docs: `docs/ROADMAP.md`, `docs/TESTING.md`, `CODE_OF_CONDUCT.md`, a longer web README, and corrections to migration numbers, costs, quotas and several contradictions.
- Today lists what is coming up this week (`upcoming` in `/api/today`: up to six open tasks due in the next seven days).
- Relative due dates ("Today", "Tomorrow", "in 3 days") on task rows, board cards, Today and the task drawer.
- Snooze to tomorrow on an open task; on phones the row actions sit in one More actions menu.
- Command palette actions: claim the daily reward, start a 25-minute focus session, show overdue and due today.
- The quest log remembers its tab, filters and sort; `/games?play=<game>` links, so Back returns to the games menu.
- Each page has its own tab title, and moving to another page focuses its content.
- Docs: the AI service's HTTP API, `/internal/index` and `/internal/forget` request shapes, a README troubleshooting table, and known issues #63-#66.
- Today: the streak warning has its own **Claim now** button and says when the streak ends; each task opens in its quest, and a task due today or late can be snoozed to tomorrow. The Dashboard shows the same warning.
- The task drawer can **Delete** (with Undo), **Snooze** and **Add subtask**.
- **Undo** on a bulk completion, like on a single task.
- **Export one quest** as CSV (the full export's columns, so it imports again) or a Markdown checklist, from the quest header.
- Keyboard: `?` lists the shortcuts on every page, and `g` then a key goes to a page (`g t` Today, `g q` quest log, `g d` Dashboard, `g f` Focus, `g s` Stats, `g p` Profile, `g l` Leaderboard, `g c` AI Chat).
- Chat: the message box grows as you type, **Jump to latest** when scrolled up, **Copy** on each answer, and placeholder rows while the conversation list loads.
- `/api/today` returns `streak.claimableAt` and `streak.expiresAt`.
- Docs: the web app's page addresses and URL parameters, an index of the package READMEs, the AI help corpus, and roadmap rows for #59 to #63.

### Changed

- **The daily AI quota refills at the user's own midnight.** `AI_DAILY_REQUEST_LIMIT` is now counted per day in the user's time zone (`users.timezone`, UTC until set) instead of per UTC day, like the daily caps and quests; `ai_usage.day` keeps its type and rows. The quota messages say "your midnight". The AI service gains a `tzdata` dependency (a Windows host has no zone database; an unknown zone falls back to UTC). Closes known issue #31.
- **Arcade hardening (option B, in part).** Free-game XP no longer counts for the public weekly leaderboard (`WEEKLY_BOARD_XP_SOURCES`; your own review, Stats and digest still include it); a valid arcade run with under 5 seconds of play is accepted but pays 0 XP (`tooShort` in the result, with a toast); and `npm run arcade-report` prints how fast real players score per game so the plausibility bound can be calibrated. The bounds themselves and a per-game cooldown are deliberately unchanged (known issue #39).
- **The bot's browsers survive a restart.** The `/list` reorder, the achievements pager and the `/class` browser no longer keep their position in memory: each button carries the page, class or first pick in its custom ID (`ach_next_2`, `class_next_HERO`, `sel_swap2_<list>_<task>`), and the select menus name their skill tree. Messages opened before this update show "This button has expired" on their old buttons. Closes known issues #6 and #7; the chat cooldown (#21) stays in memory by design.
- **Documentation corrections.** The PRD no longer lists ownership transfer as a non-goal (it shipped) or mentions legacy MySQL migrations as current; stale MySQL/MariaDB wording is gone from a code comment and a test header; OPERATIONS gets a table of what has not run against live services (Gemini, web push, the Supabase pooler, screenshots).
- **Documentation structure.** A [START_HERE](docs/START_HERE.md) page for players and contributors, [KNOWN_ISSUES](docs/KNOWN_ISSUES.md) split into limitations and by-design decisions (numbers kept), a balance-change workflow in CONTRIBUTING, and the docs index refreshed.
- **Balance pass 3: borrowed skills and runaway scaling.** Measured with `npm run balance` and a cross-class simulation (details in [design/balance.md](docs/design/balance.md#borrowed-skills-and-unbounded-scaling)).
  - Valor, Fortify, Arcane Study and Multishot are `classOnly`. A Default player with only borrowed skills (2,095 XP) used to earn 79 XP on a 10 XP task, more than nearly every class's own full tree; it now earns 15.
  - Wizard Wisdom is capped at 50 (`CLASS_RULES.WIZARD.WISDOM_MAX`, level 25, Tome included). A level-100 Wizard used to pay 45× the base and a level-200 one 88×; the full tree at level 30 is 126 XP instead of 164.
  - Hero's Champion +50% → +35%, Monk's Steady Breath +0.5 → +0.4 XP per Rhythm day (Monk full tree 75 → 68), Tank's Revenge +10% → +15% per level (`CLASS_RULES.TANK.REVENGE_PERCENT`; Tank full tree 41/46/53 → 43/48/56).
  - New balance tests: every skill of every tree on a Default player stays under 3× the base, and no class keeps growing with level.
  - The generic skill percentages (Quick Learner, Inspire, Focus, Steady Aim, Momentum, Scholar, Night Shift, Bleed) are limited to +75% together (`SKILL_RULES.MAX_PERCENT_BONUS`); Execute, Revenge, Crusade and prestige are outside the limit. No own-tree figure changes.
- **Balance pass 2: the weak classes are lifted.**
  - Tank: shield cap `min(15, 5 + level ÷ 3)` (was 3), +7% per stack (was +4%), Fortify costs 70 XP (was 95).
  - Assassin: +8% per stack (was +5%), the streak survives 48 hours (was 36; Night Owl 72, was 48).
  - Paladin: 600 XP (was 750), +8 on non-HIGH actions (was +5), Holy Aura +3 per level (was +2).
  - Ranger: +5 on other actions (was +3) and +3 XP per day early (was +2).
  - Necromancer: souls add +8% (was +5%) and every 10th completed task binds a soul, so the class works without a backlog.
  - Artisan: Toolkit +0.5 per progress (was +1) and a clear pays +6 per progress (was +8, after the fix above).
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
- **A daily claim within the rolling 48/72/96-hour window continues the streak.** With the 24-hour cooldown, someone who claimed at 23:30 could only keep the streak by claiming in the last half hour of the next day.
- **Perfect day counts only tasks whose due date was set at least 24 hours before,** like the early and overdue bonuses; three tasks given today's date and ticked off at once no longer pay it.
- The web reads "today" in the account's time zone, and saves the browser's zone once for an account that has none, so overdue and due today match the server.
- **The streak warning waits for the cooldown and gives the real deadline.** A streak is at risk only once `/daily` would succeed again, and the DM, the push and the Today page say when it lapses (the later of its calendar day and its 48/72/96-hour window), not "before midnight".
- `/profile user:@someone` shows "Profile is private" for a player with XP off, as they are off the leaderboard too.
- `/list`, `/profile`, `/class` and `/achievements` defer their reply before reading the database (the second half of #52).
- Accepting a suggested priority in "What should I do next?" no longer re-runs the AI ranking (it spends quota); Refresh still does.
- Calendar feed **New address** and **Turn off** ask first, since both stop subscribed calendars.
- `npm run archive` leaves the `subtasks_done` and `boss_defeated` rows in `xp_transactions`, since their once-per-parent rule reads that log.

### Fixed

- **Party progress** refreshes after tasks and focus sessions (it showed the old count for a minute), and a malformed reset time no longer shows "NaN".
- **Imports and exports are rate limited** (20 a minute per account, like the CSV import) before a large body is parsed; `POST /api/user/import` and the exports had no limit beyond the general one.
- **The calendar feed token no longer reaches the error log**: a 500 logs the path with any 32-character token masked. A stream that fails after its headers were sent no longer throws a second time.
- **Login-start sessions live 10 minutes** (an anonymous hit on `/api/auth/discord` used to leave a seven-day session row); `keepAliveTimeout` is 65 s so a proxy that reuses connections does not meet resets; `Cache-Control: no-store` on `/api` responses (the calendar feed and avatars keep their own headers).
- **Resetting progress also removes archived XP and game rows** (`npm run archive` moves them out of the tables the reset cleared). Pending invitation lists are capped at 100.
- **A CSV subtask whose parent name is repeated** is now an import error instead of silently joining the first parent.
- **Bot:** task names, links and mentions in AI embeds are escaped; a chat reply in embed mode no longer exceeds Discord's 6000-character message total; a command that fails after a public `deferReply` replaces the placeholder with a private error; `/list` handles a list that vanished mid-click; the leaderboard no longer cuts ranks mid-line; `/automation` and `/toggle` acknowledge first; shutdown stops new background runs and waits up to 10 seconds for the ones in flight; the weekly digest handles five users at a time within a 45-minute budget.
- **AI service:** a tool id past 32 bits is a refusal, not a driver error; a failed preview in the confirm step no longer ends the turn with an unanswered tool call, and any such dangling call in an old thread is answered before the model sees it (that thread used to fail on every later message); user data cannot close its own prompt block (angle brackets are replaced) and tool results reach the model fenced as data; one list's database error no longer aborts the whole reconcile transaction; a failed usage booking no longer replaces the turn's result.
- **Web:** no "0 XP" while the shop, classes and skills load; class names (not keys) in purchase toasts; "Focus Rate" is "Completion Rate"; the Settings reset dialog's field is labelled, outside the description and in a form (Enter confirms); screen-reader state for locked and unlocked achievements and skills; the leaderboard is a list (the podium is hidden from it); Games controls have names, states and `type="button"`, and leaving an arcade run asks first; leaderboard and stats requests are cancelled when the board or range changes.
- Ids above 2147483647 now fail validation (400) instead of reaching Postgres and returning a 500, in the shared validator, the route schemas and the AI service.
- The AI chat assistant was told today's UTC date and retrieved with it; it now uses the user's own day.
- Keyboard shortcuts `x`, `e` and `d` no longer act on a hidden row after switching to the board or calendar view, or while selecting tasks; the `j`/`k` cursor is announced to screen readers.
- Completing a task shows it as done at once and rolls back if the server refuses.
- Long task names wrap to two lines on the Today page and the board instead of being cut off.
- The AI answer stream honours backpressure from a slow browser.
- Concurrent leaderboard cache misses share one query.
- A stranger who guessed a task or quest id could briefly delay the owner's writes by queuing for a list lock; access is now checked before any lock is taken.
- A weekly goal claimed under one time-zone key no longer pays again after a zone change re-keys the week (the real time of the claim is checked, as for quests).
- A list handed over to a new owner is re-embedded for them by the AI reconcile job; before, it stayed under the old owner.
- A card dragged to another priority column moves at once and is put back if the server refuses.
- The quest's progress label counts tasks, not their subtasks, like the quest log; the smallest text (10px and 11px) now follows the Text size setting; dark-theme muted text on the muted surface (toast buttons) reaches 4.5:1.
- The integration suites and the e2e seed refuse to wipe a database whose name does not contain `test` or `e2e`, or that is not on localhost.
- **Chat:** after a new conversation got its URL, opening another thread or "New chat" bounced back to it; Enter while a reply streamed cleared the draft without sending; a long conversation opened at the top; history had no loading or error state; a failed delete toasted twice. Thread ids are URL-encoded and a dropped stream says "offline".
- **Monthly repeats keep their day.** Re-saving a monthly task with the same date (bulk edit does) reset its anchor, so a task on the 31st moved to the 28th for good after February.
- **A task edit with a move is one transaction**, so a failed move no longer leaves half the edit applied.
- **The AI's owner-only writes are decided on the locked list row**, so a hand-over that commits first is always respected.
- **Ownership transfer keeps each person's reminder state**: nobody misses a due notice or gets one twice after a hand-over.
- **Import no longer depends on row order** for subtasks, and refuses duplicate ids and subtasks of subtasks clearly.
- **Progress reset also clears** reflections, weekly goals, reminder rows and push subscriptions, and withdraws pending invitations you sent.
- **Arcade finish checks the game type** of the route.
- **Limits from one place:** the API's tag limit (it allowed 10 tags of 30 characters) now matches the service (5 of 20), the import body is validated, and copied names use the real list name limit.
- **Reorder is one statement per 1000 tasks** instead of one per task.
- **Web:** bulk complete never reopens a task finished elsewhere; the bulk edit dialog starts blank every time; the heatmap ends on your own today (not UTC); the command palette opens blank and says when it is still searching; Escape that closes the tour no longer also leaves the quest; Undo toasts disappear once leaving a page made the delete final; tags are trimmed and de-duplicated; a second deploy in the same tab reloads too; several icon-only buttons have proper screen reader names.
- **Web rough edges from the October review** (known issue #53): the welcome tour resumes at its step on the next page instead of restarting; finishing several tasks at once shows one summary toast instead of one per task; the open quest is in the URL (`/tasks?list=42`), so refresh keeps it and the browser's Back button returns to the quest log; and two quick reorders no longer flicker (only the last one to settle refetches).
- **Shared and server fixes from the October review.**
  - Repeating tasks respect the task quota and keep `estimate_minutes` on the next copy.
  - The CSV import preview applies the real import limits (it said OK for 1,001 rows in one list, which the import refuses), and the export round-trips names that start with an apostrophe.
  - Invite lookups have a daily ceiling (100 an account, 300 an address) on top of the 15 minute limits; the old limits allowed about 2,900 probes a day per account.
  - Applying a template to a shared list no longer fails on the caller's own task count (the owner's is checked).
  - A list hand-over keeps the old owner's deadline and overdue reminder state, so they are not told twice.
  - `updateSettings` no longer grows its assignment list when a deadlock retry re-runs it.
  - The skills preview (about 300 ms of CPU per call) is cached for ten minutes, and `/api/leaderboard/me` for ten seconds.
- **Bot fixes.** `/list` no longer fails for users with about 110 or more lists (the overview stops before the embed limit and says how many are left); `/quests` shows the monthly boss and every ready quest gets a claim button; a failed Snooze keeps the reminder's buttons instead of reporting that the list is gone; the Priority sort button sorts by priority; `/leave`, `/share` and `/members` pick the list you chose when your own list and a shared one have the same name.
- **AI service fixes.** A chat turn that fails before the model answers is refunded; `/prioritize` scales its output budget with the number of quests (above about 13 it always fell back to the heuristic); one failing list no longer stops the reconcile pass; "overdue" and "due soon" use the user's own date; generated thread titles use `text_of`.
- **Web fixes.** Dialogs scroll on short screens, the bulk bar sits above the mobile bottom nav, and the touch targets of the board, rows and close buttons are larger; picking a time zone is a draft until Save (it saved on every arrow key press and locked the zone for 24 hours); Reduce motion now stops confetti; pending deletes survive a reload (`pagehide` sends them with `keepalive`); undoing a completion and deleting a quest refresh Today and the stats; a failed logout no longer shows the signed-out screen; the chat stops scrolling to the bottom on every streamed token while you reread; the status and view switches are toggle groups instead of tabs without panels, the filter selects have names and an overdue calendar day says so in words; the service worker falls back to a new window when navigation fails and re-subscribes on `pushsubscriptionchange`, and closing the permission prompt no longer claims the site is blocked.
- **Hand-over no longer races the new owner's own adds.** Handing a shared list over now locks the new owner's account before the list (user row, then list, like every other writer) and re-checks the member under the lock, so a task the new owner is adding at that moment cannot push them past the 5,000 task limit. A member adding to a different quest the new owner owns is still not serialised (known issue #47, reworded).
- **Fewer duplicate reminder DMs.** The write that marks a reminder as handled is now tried up to three times (`markWithRetry`) after the DM went out, so a one-off database error no longer repeats the reminder at the next run, and a collapsed reminder that cannot be marked no longer stops the other marks. Known issue #40 is reworded.
- **Wrong "00:00 UTC" reset times on three web pages.** The Review, Focus and Games pages said their limits reset at 00:00 UTC, but the weekly review, the daily focus-session limit and the free-game cap all follow the player's own time zone; the text now says so. The Party page and the weekly leaderboard keep UTC, because they use one global week.
- **Three red web API tests.** The prestige and cosmetics tests now clear the 30 s leaderboard cache (`clearBoardCache`) before reading the board, and the skill preview test expects Valor to pay nothing for a non-Hero class, as the balance pass made it Hero-only. Closes known issue #46.
- **The archive job is scheduled on Render.** `render.yaml` gets a weekly cron job `taskquest-archive` (Sundays 03:00 UTC, `npm run archive -- --days 365`, a paid plan) so `xp_transactions` no longer grows without bound by default. Games are not archived by the job.
- **Web and AI fixes.** Editing or deleting a task and editing a list now refresh the Today page and the stats (a deleted or re-dated task stayed on Today for up to a minute); logging out unsubscribes this browser from web push, so a shared browser stops showing the previous player's reminders; the assistant's chat shows labels for `update_item` and `break_down_task` instead of the raw tool names; and an AI conversation that fails after the model already ran keeps its request booked instead of refunding it (a message that reliably failed late could be repeated without using the daily AI limit).
- **Bot: other people's text, panels and digests.** Task names and descriptions, list descriptions, the quest overview and the leaderboard names are escaped like the reminders already were (a collaborator on a shared list could plant a masked link in the owner's public `/list` message). An error on a button that only acknowledged with `deferUpdate` (a double-clicked Claim) is now shown beside the panel instead of replacing it and its buttons. A weekly digest whose DM failed temporarily is given back correctly: the claim stores a whole second and the release compared a value with milliseconds, so it never matched and that week's digest was lost.
- **Web server errors and limits.** Request-body errors that are the client's fault (unsupported encoding or charset, aborted or mis-sized bodies) answer 4xx with `code: "VALIDATION"` instead of a logged 500; the class preview 404 carries `code: "NOT_FOUND"`; starting a login and finishing it have separate limits (they shared one, so a login cost two of 30), and a refused callback redirects to the login page (`?error=rate_limited`); per-address limits key an IPv6 client by its /64, so rotating addresses no longer dodges them; leaderboard avatar URLs are stable per player (they used a random IV, so the one-hour cache never hit); and production startup refuses a `PUBLIC_URL` that is not https (and warns when `TRUST_PROXY` is off), instead of failing as "login does not stick".
- **The calendar feed token leaked in three responses.** `PATCH /api/user`, `POST /api/classes/:key/buy` and `/equip` returned the raw user row, including `calendar_token` (a bearer credential for the `.ics` feed). They now go through `publicUser` (`db/users.js`), the same strip as the profile, and report `has_calendar_token`. Anyone who is worried about an earlier response can rotate the feed address in Settings.
- **One stray task no longer blocks a party.** The party target grew with every member who had finished a single task, so a spare account (or a griefer) with one task raised it by 12 and nobody could claim. Only members with at least 6 tasks (the number needed to claim) raise the target or add to the progress.
- **Shared lists and import edge cases.** An editor can no longer delete a task that somebody else finished (it took away that person's quest, review and party progress); a JSON import reads `completed` strictly (`"false"` used to import as done, and anything unknown is now refused); an imported task no longer pays the list-cleared class bonuses (it never set the cleared marker, so the list paid again later); handing a list over keeps the invitations the new owner had sent; and a player's leaderboard rank follows the board's own order, so tied players no longer all share the best rank.
- **Back-dated due dates could farm the Necromancer and Ranger.** A standing routine that creates tasks with an old or distant due date every day (the 24 hour rule only delays it by a day) paid about 59 XP per 10 XP task to a Necromancer with five souls. Only the first 8 early or overdue completions of a day now count for those two classes (`LIMITS.CLASS_DEADLINE_PER_DAY`).
- **Quests and the weekly review could be claimed twice after a time zone change.** Claims were keyed by the period's local start date, and a different zone can give the same real week another key. A claim now also checks the time of the last claim of that quest (`claimedSince` in `db/progression.js`).
- **Blackjack no longer mints lifetime XP.** Wins were credited to lifetime XP (level, prestige, XP achievements, the lifetime board) while losses never took any back, so about 40 hands at a 25% bet could reach the prestige level. Winnings now only change the balance.
- **Broken documentation links** (`CHANGELOG.md#400` in DEPLOYMENT and KNOWN_ISSUES, a `../SECURITY.md` path in the shared-lists design note).
- **Stale class text and docs.** The Assassin card said +7% per stack and the Tank card +6% with a "strong early" playstyle (the rules are +8% and +7%, and the Tank is weak early); XP_GUIDE said Champion "doubles" XP; the balance note gave the Wizard's Wisdom as level × 5.
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
- Quests and the weekly review showed Claim after a time zone change although claiming answered 409; they now match claims by time as well as by period key.
- The owner adding to one list and a member adding to another at the same moment could both take the last free task slot; adds, subtasks and moves now lock the list owner.
- An expired invitation was meant to be marked revoked, but the update was rolled back by the error; it now sticks (lists and parties).
- The Stats page showed a lapsed streak; it now reads 0 like Today.
- A failure saving the user during the Discord callback sent JSON 500 to the browser instead of the login page; the session store no longer turns an error thrown by its callback into an unhandled rejection.
- Focus limits honoured the given time only in part, and Today's done-today count left out older completions with no recorded actor.
- Web: a failed game history load said "No games played yet"; Dashboard quest cards showed no deadline; the suggested weekly goal could exceed 60; deleting a task already gone showed an error.
- Web accessibility: radio groups take arrow keys, the sort menu marks the chosen order, the filter button includes its count, labels point at their controls, login errors and quick-add previews are announced, calendar days are read in full, delete confirmations are alert dialogs, shortcut hints show ⌘ on Apple devices, and invalid link-in-button nesting is gone.
- Web on phones: long quest names are shortened instead of pushing the priority badge out, and calendar badges fit their cells.
- Focus and Stats no longer say their days are UTC.
- Bot: `/list` judged overdue and expired by UTC, not the user's time zone; task and quest names written by other members were not escaped in `/list` and `/quick` confirmations; `/summary` offered shared quests the AI always refuses.
- Necromancer and Ranger lost `early_finish`, `overdue_clear` and Inbox Zero past their daily class deadline cap; the cap is the class's only.
- The server mapped the AI service's 403 to 503 "unavailable" instead of `AI_OPTED_OUT`.
- Comment ids past 2³¹ could not be deleted (closes #64).
- Web chat: **New chat** on `/chat` cleared nothing and kept a reply streaming; a 401 left a retry that could not work instead of signing out; a pending approval fetched after a 409 could appear in another thread; an approval arriving mid-reply left focus on the page body; messages did not say who was speaking; the mobile conversation list did not take or return focus; identical replies were announced once.
- Web: Today's ranked quests did nothing when clicked; a half-written comment carried over to a subtask opened from the drawer; the assignee menu snapped back until the refresh; "New task" from the palette skipped the view-only check while a quest loaded; the same CSV could not be chosen again after fixing it; exports and the calendar feed ignored `VITE_API_URL`; the Dashboard offered the daily reward with XP off; the leaderboard blamed gamification for a class filter and gave ranks 1 to 3 no text; the welcome tour took focus from typing and covered the phone navigation; Ctrl+K stacked over another dialog; quick focus trusted a minute-old status; the arcade loop restarted on background refreshes; the party board did not roll over at its reset.
- Docs: Blackjack winnings count no lifetime XP (DATABASE); XP_GUIDE gains the weekly modifier, Last Stand and Tidy Mind; SECURITY's body limits, intents and residual risks; the bot's invite permissions for AI chat; the first streak day adds nothing (PLAYER_FAQ).

### Removed

- **`users.skill_points`.** Migration `002_drop_skill_points` drops the legacy column; `GET /api/skills` no longer returns `skillPoints` (it was always 0) and the web types lose `skill_points`. Closes known issue #16. The apps run the migration on start; rolling back to the previous version afterwards is not supported, because it still reads the column.

### Security

- Web push endpoints are accepted only for the browsers' own push services (or hosts listed in `WEB_PUSH_ALLOWED_HOSTS`), on port 443, and never for IP literals or internal names, so a subscription cannot point the server at an internal address.
- Invitations cannot be used to probe who uses TaskQuest: every outcome the inviter must not learn gets one neutral answer, the lookup is rate limited per account and per address, and the web app asks the inviter to confirm the person it resolved. Discord IDs never leave the server (members use an opaque key).
- Arcade scores are verified by replaying the recorded inputs instead of trusting the client.
- Dev-only advisories in the Tailwind 3 toolchain are gone with the Tailwind 4 migration.
- The skill and class previews and the CSV import share a 20-a-minute limit per account: each runs synchronous CPU work, and the general limit let one account block the server for minutes.

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
- GitHub Actions CI: lint, typecheck, build, syntax check, tests on PostgreSQL, and a production audit.
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
[Unreleased]: https://github.com/Mist10148/TaskQuest-Application/compare/v4.0.0...HEAD
