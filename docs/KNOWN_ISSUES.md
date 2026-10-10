# Known issues and limitations

This list covers what remains after the 4.0 merge and the improvement pass that followed it. The 29 bot issues and 13 web issues documented before 4.0 are resolved; see [CHANGELOG.md](../CHANGELOG.md#400) and [SECURITY.md](../SECURITY.md#3-vulnerabilities-fixed-in-40).

| # | Area | Issue | Impact | Workaround / plan |
|---|---|---|---|---|
| 1 | Games | Arcade games (web) are played client-side; the server can only bound scores (plausibility rate, per-run cap, daily cap). | A scripted client can earn up to the free-game cap (500 XP per day). | Design: [arcade anti-cheat](design/arcade-anti-cheat.md). |
| 2 | Economy | Lifetime XP for players from before 4.0 is reconstructed as max(balance, level floor). XP spent before 4.0 isn't counted. | Some veteran players' lifetime XP is lower than they actually earned. Levels never dropped. | None needed. Optionally backfill from `xp_transactions` if your history is complete. |
| 3 | Economy | `xp_spent` (spending achievements) is backfilled from class and skill purchases in `xp_transactions`; spending that predates the XP log is not counted. | A few veterans start below their true total. | None needed. |
| 4 | Time | Daily reward cooldown, the per-day reward caps, quests and the weekly leaderboard all use UTC days and weeks. Only reminders and the weekly digest use your time zone. | For some time zones a "day" starts at an odd local hour. | Planned: per-user days for quests and caps. |
| 5 | Bot | `/list` overviews are public messages; channel members can read list names and task names. | Information visible in channel. | Use `/list` in DMs. Mutations are owner-scoped. |
| 6 | Bot | The reorder selection (step 1 → step 2) is kept in memory. | A bot restart between the two selections asks you to start the reorder again. | Low impact. |
| 7 | Bot | Achievement pagination and class-browser position are kept in memory per user. | They reset after a restart. | Low impact. |
| 8 | Bot | The `/list` editor does not show or edit per-task due dates, tags, subtasks or repeats. They can be set with `/quick` and in the web app, and the web app shows them. | Discord list views look simpler than the web ones. | Planned. |
| 9 | Reminders | Reminders are per list deadline. Per-task due dates appear in the calendar feed and in quests, but a task due date does not send its own DM. | A task due before its list's deadline is not reminded. | Planned. |
| 10 | Tasks | A repeating task creates its next copy when it is completed. If you never complete it, nothing is created, and skipped periods are not back-filled. | A habit you skip for a month doesn't pile up. | By design. |
| 11 | Tasks | Subtasks nest one level deep, and an import keeps the links only for subtasks whose parent is in the same file. | — | By design. |
| 12 | Data | Import reads TaskQuest JSON exports only (CSV is export-only). | You can't import a spreadsheet. | Planned. |
| 13 | Calendar | The calendar feed address is a bearer secret in a URL: anyone who has it can see your deadlines. | A leaked address exposes list and task names with dates. | Rotate or turn it off in Settings; the old address stops working at once. |
| 14 | Data | `xp_transactions` and `game_sessions` grow without bound. | Storage. | Archive periodically ([DATABASE.md](DATABASE.md#backups-and-maintenance)). |
| 15 | Platform | Render background workers need a paid plan, and free web services sleep. | A free deployment of the bot disconnects when idle. | Use a paid worker, or another host. |
| 16 | Skills | `users.skill_points` is legacy and unused (skills cost XP). | — | Kept for compatibility; may be dropped in a future migration. |
| 17 | AI | The AI service's SQL runs against MySQL 8 in CI (`tests/mysql`), but nothing has run against real Gemini yet, and the default Gemini model ids may need updating. | A first live run may need small fixes (model ids, structured-output or safety-filter quirks). | Follow the [live-run checklist](OPERATIONS.md#first-live-gemini-run) with a staging key before enabling for users. |
| 18 | AI | The eval suites in `apps/ai/tests/evals` have only been run offline with fake models, and the golden sets are still small (50 retrieval queries, 6 summary and 6 prioritizer cases). | Retrieval and summary quality against real Gemini is unmeasured. | Run the live evals with a staging key ([OPERATIONS.md](OPERATIONS.md#first-live-gemini-run)) and grow the golden sets from real (anonymised) data. |
| 19 | AI | The AI chat tools don't set the new per-task fields (due date, priority, tags, repeat, parent) yet, although the internal API accepts them. | Tasks added by chat have none of them. | Planned. |
| 20 | AI | The vector cache and the prioritizer result cache live in process memory. | With several AI instances each warms its own cache. | Fine on one instance; use a shared cache or vector store if scaled out. |
| 21 | Bot | The @mention chat cooldown (3 s per user) is kept in memory. | It resets after a restart. | Low impact; the daily AI quota still applies. |
| 22 | AI | Without the Message Content intent, the bot cannot read replies to it that have the ping turned off. | Those replies are ignored. | Mention the bot, keep the reply ping on, or enable `AI_CHAT_MESSAGE_CONTENT` with the intent. |
| 23 | Web | Tailwind CSS 3 toolchain carries dev-only advisories (`braces`, `micromatch`, `chokidar`, `postcss-selector-parser`). | None at runtime (build only). | Plan: [Tailwind 4 migration](design/tailwind-4-migration.md). |
| 24 | Web | The web app has unit tests for its pure logic (dates, quick-add parser, game loop, theme contrast) but no automated browser or component tests. | UI regressions rely on manual checks. | Planned: Playwright smoke tests against a seeded database. |
| 25 | Web | The destructive red and the blurple are used both as button backgrounds and as text colours, so as text on a dark card they meet 3:1 (icons, large text) rather than 4.5:1. All other text pairs meet WCAG AA in both themes. | Small red or blurple text on dark cards is slightly low contrast. | Planned: separate text tokens. |
| 26 | Docs | The README has no screenshots. | — | Needs a signed-in session to capture; add them from a real deployment. |

## Roadmap

See [PRD §11](PRD.md#11-roadmap).
