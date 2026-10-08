# @taskquest/shared

This package is the single source of truth for TaskQuest's rules and data access. Both the bot and the web API use it.

```js
const shared = require('@taskquest/shared');      // pure rules (no I/O)
const db = require('@taskquest/shared/db');       // MySQL services + migrations
```

| Module | Contents |
|---|---|
| `src/constants.js` | Classes, skill trees, achievements, rewards, limits, game config |
| `src/xp.js` | Levels, class mechanics, skill bonuses, final XP, daily reward |
| `src/achievements.js` | Achievement evaluation |
| `src/games/*` | Blackjack, RPS, Hangman engines and arcade score checks |
| `src/validation.js` | Input normalisation (names, dates, priorities, LIKE escaping) |
| `src/errors.js` | `TaskQuestError` for expected, user-facing failures |
| `src/db/pool.js` | Connection pool, `withTransaction` |
| `src/db/migrate.js`, `src/db/migrations/*` | Versioned schema migrations (`npm run db:migrate`) |
| `src/db/users.js` | Users, settings, stats, leaderboard, reset |
| `src/db/progression.js` | `applyXP`, rewards, achievements, daily, classes, skills |
| `src/db/tasks.js` | Owner-scoped lists and items, reminders, clean-up |
| `src/db/games.js` | Server-authoritative games |

Rules and formulas are described in [docs/GAMEPLAY.md](../../docs/GAMEPLAY.md).
