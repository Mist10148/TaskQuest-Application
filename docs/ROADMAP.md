# Roadmap

What is open, what is planned and what is decided. The full product context (goals, user stories, risks) is in [PRD](PRD.md#11-roadmap); what already shipped is in the [CHANGELOG](../CHANGELOG.md). Numbers like #49 refer to [KNOWN_ISSUES](KNOWN_ISSUES.md).

## Next

Work that is understood and waits only for time, a key or a decision.

| Item | Blocked on |
|---|---|
| Run the AI evals against real Gemini and grow the golden sets from real data (#17, #18). Runbook: [OPERATIONS](OPERATIONS.md#first-live-gemini-run) | A staging Gemini key; model ids may need updating |
| An offline write queue for plain edits (#53) | A conflict rule when the server copy changed |
| A multi-instance lock for AI confirmations, and a fix for the one-thread-per-`/ask` growth (#51; pruning and the embed debounce are done) | A choice between a database lock and a thread-row claim |
| Auto-delete versus quest progress (#49) | A product decision |
| Persist the rate limiters and split the internal token (see KNOWN_ISSUES) | A choice of store (Postgres or Redis) and a change to deployed env vars |
| Page large quests in the web app, and bound the calendar feed (#60; the list route already takes `limit` and `cursor`) | How far back the feed should reach |
| Shared leaderboard caches and a cheaper weekly and streak board (#59) | A shared store, as for the rate limiters |
| Hash the calendar feed token (#61) | Settings shows the address again today, so it would need a "shown once" flow |
| A baseline that does not need `vector` with AI off (#62; checksums are done) | Nothing; split the vector parts into a later migration, which would be a new migration for databases that already ran 001 |
| Undo of a repeating task's completion also removes the copy it created (#63) | A rule for a copy that was already edited |
| Index the player guides for the AI's how-to answers | A choice of which guides; see [AI_ARCHITECTURE](AI_ARCHITECTURE.md#3-rag-pipeline) |

## Later

| Item | Notes |
|---|---|
| Custom statuses, start dates with a timeline, task dependencies, simple automations, real-time updates on shared quests | Needs a data model; each is its own design note |
| More component tests for the web app (#24) | The Tasks page is the gap (its URL and dialog wiring); every other page and the dialogs are covered |
| Full internationalisation | Extract strings into `apps/web/src/i18n/messages.ts`, add a language picker once there is a second catalog |
| README screenshots (#26) and push delivery tested against real push services (#30) | The capture spec exists; see [CONTRIBUTING](../CONTRIBUTING.md#readme-screenshots) |

## Open product decisions

- A party of one can claim both party rewards (#50).
- The arcade plausibility bound, `arcade-report` calibration and a per-game cooldown (#39).
- Whether a manager may delete a shared quest ([shared-lists](design/shared-lists.md)).
- Whether the weekly goal pays only for tasks finished after it is set. Today the target can be set or lowered at any time while unclaimed (as long as it is above the progress), so a goal set on Sunday at progress + 1 pays as if it had been planned all week.
