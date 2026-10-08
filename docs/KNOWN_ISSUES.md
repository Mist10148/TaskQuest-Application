# Known issues and limitations

This list covers what remains after the 4.0 merge. The 29 bot issues and 13 web issues documented before 4.0 are resolved; see [CHANGELOG.md](../CHANGELOG.md#400) and [SECURITY.md](../SECURITY.md#3-vulnerabilities-fixed-in-40).

| # | Area | Issue | Impact | Workaround / plan |
|---|---|---|---|---|
| 1 | Games | Arcade games (web) are played client-side; the server can only bound scores (plausibility rate, per-run cap, daily cap). | A scripted client can earn up to the free-game cap (500 XP per day). | Planned: signed checkpoints or input replay validation. |
| 2 | Economy | Lifetime XP for players from before 4.0 is reconstructed as max(balance, level floor). XP spent before 4.0 isn't counted. | Some veteran players' lifetime XP is lower than they actually earned. Levels never dropped. | None needed. Optionally backfill from `xp_transactions` if your history is complete. |
| 3 | Economy | Spending achievements are not tracked (e.g. "spend 1,000 XP"). | — | Planned. |
| 4 | Bot | `/list` overviews are public messages; channel members can read list names and task names. | Information visible in channel. | Use `/list` in DMs. Mutations are owner-scoped. |
| 5 | Bot | The reorder selection (step 1 → step 2) is kept in memory. | A bot restart between the two selections asks you to start the reorder again. | Low impact. |
| 6 | Bot | Achievement pagination and class-browser position are kept in memory per user. | They reset after a restart. | Low impact. |
| 7 | Reminders | Deadlines are dates in UTC. There is no time-of-day or per-user timezone. | A reminder can arrive the evening before or the morning of the deadline, depending on your timezone. | Planned: per-user timezone. |
| 8 | Web | The production JS bundle is ~1 MB (one chunk). | Slower first load on mobile. | Planned: route-level code splitting. |
| 9 | Web | Tailwind CSS 3 toolchain carries dev-only advisories (`braces`, `micromatch`, `chokidar`, `postcss-selector-parser`). | None at runtime (build only). | Planned: Tailwind CSS 4 migration. |
| 10 | Web | Many unused shadcn/ui components remain from the original template, and produce 9 lint warnings (mostly `react-refresh`). | Bundle size, noise. | Remove unused components. |
| 11 | Data | `xp_transactions` and `game_sessions` grow without bound. | Storage. | Archive periodically ([DATABASE.md](DATABASE.md#backups-and-maintenance)). |
| 12 | Platform | Render background workers need a paid plan, and free web services sleep. | A free deployment of the bot disconnects when idle. | Use a paid worker, or another host. |
| 13 | Skills | `users.skill_points` is legacy and unused (skills cost XP). | — | Kept for compatibility; may be dropped in a future migration. |

## Roadmap

See [PRD §11](PRD.md#11-roadmap).
