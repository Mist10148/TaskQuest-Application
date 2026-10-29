# @taskquest/shared

This package is the single source of truth for TaskQuest's rules and data access. Both the bot and the web API use it.

```js
const shared = require('@taskquest/shared');      // pure rules (no I/O)
const db = require('@taskquest/shared/db');       // PostgreSQL services + migrations
require('@taskquest/shared/env');                 // load the root .env (and an optional per-app .env)
const ai = require('@taskquest/shared/ai');       // client for the private AI service (apps/ai)
const push = require('@taskquest/shared/push');   // asks the web server to send a web push
```

### Pure rules (`@taskquest/shared`)

| Module | Contents |
|---|---|
| `src/index.js` | Package entry: re-exports the pure modules below |
| `src/constants.js` | Classes, skill trees, achievements, rewards, limits, game config |
| `src/xp.js` | Levels, class mechanics, skill bonuses, final XP, daily reward |
| `src/achievements.js` | Achievement evaluation |
| `src/cosmetics.js` | Cosmetic requirements and what to draw for an equipped set |
| `src/quests.js` | Quest periods (daily, weekly, monthly) in the user's own time zone |
| `src/simulate.js` | Deterministic per-class XP simulation (balance script, balance tests, web "what would I earn?" preview) |
| `src/games/*` | Blackjack, RPS, Hangman engines; deterministic Snake, Dino and Invaders simulators (`rng.js`, a seeded PRNG) and arcade run replay verification (`arcade.js`) |
| `src/validation.js` | Input normalisation (names, dates, priorities, LIKE escaping) |
| `src/quickAdd.js` | Quick-add parser ("Finish report fri !high #work every week"); mirrored in `apps/web/src/lib/quickAdd.ts` |
| `src/dates.js` | Plain calendar-date (`YYYY-MM-DD`) helpers and time zone validation |
| `src/tz.js` | Per-user days, weeks and months: local midnights in an IANA zone |
| `src/csv.js` | CSV parsing for spreadsheet imports, into the same shape as a JSON export |
| `src/ics.js` | iCalendar feed of deadlines and due dates (all-day events) |
| `src/text.js` | Escaping untrusted text (list, party and display names) for Discord messages |
| `src/random.js` | CSPRNG helpers for anything that decides XP outcomes |
| `src/errors.js` | `TaskQuestError` for expected, user-facing failures |

### Other entry points

| Module | Contents |
|---|---|
| `src/env.js` (`./env`) | Environment loading for every process: real environment, then `<app>/.env`, then the root `.env` |
| `src/ai/client.js` (`./ai`) | Client for the private AI service for non-Express callers such as the bot (shared `X-AI-Token`, collected chat results) |
| `src/push/index.js` | Web push rules with no I/O: subscription validation and notification payloads (also re-exported as `shared.push`) |
| `src/push/client.js` (`./push`) | Best-effort request from the bot to the web server to send a web push (off unless `WEB_PUSH_INTERNAL_URL` and a token are set) |

### Data access (`@taskquest/shared/db`)

| Module | Contents |
|---|---|
| `src/db/index.js` | Entry point: exports the pool, migrations and the services below (`extras.js` is internal to `tasks.js`, `assignees.js` to `tasks.js` and `sharing.js`) |
| `src/db/pool.js` | `pg` connection pool behind a mysql2-style layer (`?` placeholders, `[rows]` results, `insertId` via `RETURNING id`), `withTransaction` (retries `40P01` / `40001`), `savepoint`, `isUniqueViolation`, `isUndefinedTable` |
| `src/db/migrate.js`, `src/db/migrations/*` | Versioned schema migrations (`npm run db:migrate`): `001_baseline` creates the whole Postgres schema, `002` onwards follow (`004_item_assignee`: task assignees, `005_item_activity`: task history, `006_item_comments`: comments, `007_item_next_copy`: undoable repeat copies) |
| `src/db/access.js` | The one rule for who may touch a list or task (`forList`, `forItem`, `accessSql`): owner or member, strangers get `NOT_FOUND` |
| `src/db/users.js` | Users, settings, stats, leaderboard, reset |
| `src/db/progression.js` | `applyXP`, rewards, achievements, daily, classes, skills |
| `src/db/tasks.js` | Lists and items for owners and members, reminders, clean-up |
| `src/db/sharing.js` | Shared lists: named invitations, members, roles |
| `src/db/parties.js` | Parties (up to `LIMITS.MAX_PARTY_MEMBERS` = 6 people) and their shared weekly quest |
| `src/db/quests.js` | Daily and weekly quests (progress derived, claims stored) |
| `src/db/review.js` | Weekly review bonus |
| `src/db/goals.js` | Daily reflection and weekly goal |
| `src/db/today.js` | The Today screen in one read-only query set |
| `src/db/focus.js` | Server-timed focus sessions that pay XP for measured time |
| `src/db/activity.js` | A task's history (`item_activity`): written by `tasks.js` inside each change, `getActivity` for anyone on the quest |
| `src/db/comments.js` | Comments on tasks: list, add (editors), delete (author or manager), counts for task rows, a person's own comments for the export |
| `src/db/assignees.js` | Task assignees: member key to person and back (`'owner'` or `list_members.public_id`, never a Discord ID out), clean-up when someone leaves or a task moves |
| `src/db/extras.js` | Engagement bonuses on a task's first paid completion (perfect day, inbox zero, boss, welcome back, estimate, party assist) |
| `src/db/stats.js` | Read-only statistics for the web Stats page |
| `src/db/templates.js` | Task templates applied through the normal creation services |
| `src/db/transfer.js` | Export (with the user's own comments), reward-free import and calendar-feed data |
| `src/db/cosmetics.js` | Buying and equipping cosmetics with XP |
| `src/db/push.js` | Web push subscriptions (one row per browser) |
| `src/db/games.js` | Server-authoritative games |
| `src/db/maintenance.js` | Archiving old XP and game rows, pruning old task history, per-class XP report, arcade run data for calibration |

Rules and formulas are described in [docs/GAMEPLAY.md](../../docs/GAMEPLAY.md).
