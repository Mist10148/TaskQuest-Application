# Testing

Everything you need to run the checks locally and what CI runs. [CONTRIBUTING](../CONTRIBUTING.md#testing) has the rules for writing tests.

## Quick checks (no database)

```bash
npm run lint        # web ESLint plus ESLint over the Node code
npm run typecheck   # the web app only; the Node code is plain JavaScript
npm run check       # node --check on every Node source
npm test            # unit tests in every workspace, including the web app's Vitest suite
npm run build       # the web bundle
```

With no `TEST_DB_NAME`, the database-backed suites are **skipped**, so a green `npm test` does not mean they ran: look for `set TEST_DB_NAME to run` among the skipped tests. `npm run test:db` prints the command that runs them.

## Database tests

The service, API and bot-flow suites need a PostgreSQL 15+ with the `vector` and `citext` extensions. They run only when `TEST_DB_NAME` is set, and they **wipe that database** (`DROP SCHEMA public CASCADE`). The suites refuse to run unless the database name contains `test` or `e2e` and the host is local.

```bash
npm run db:up     # Docker: pgvector/pgvector:pg16 with taskquest_test and taskquest_e2e created
TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=5432 TEST_DB_USER=postgres TEST_DB_PASSWORD=taskquest-dev TEST_DB_NAME=taskquest_test npm test
```

| Suite | Where |
|---|---|
| Rules, services, SQL | `packages/shared/test` (`db.integration.test.js` is the big one) |
| HTTP API | `apps/server/test/api.integration.test.js` |
| Bot flows | `apps/bot/test/flows.integration.test.js` |

## Browser tests (Playwright)

```bash
npm run db:up
(cd apps/web && npx playwright install chromium)   # once
npm run build
npm run test:e2e
```

`apps/web/e2e/seed.mjs` wipes `taskquest_e2e` (override with `E2E_DB_*`), creates a player with a few quests and writes a signed session row, so there is no Discord login. Specs are `*.e2e.ts`: use role and label selectors and web-first assertions, never sleeps. One desktop project and one mobile project (375 x 812, `mobile.e2e.ts` only) run with one worker.

## AI service

```bash
cd apps/ai
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
ruff check . && mypy
pytest tests/unit tests/graphs tests/evals        # offline: fake models, SQLite, mocked Express
pytest tests/postgres                             # needs AI_TEST_DB_URL and migrated Node schema
python -m tests.evals.run                         # offline eval pipeline
```

Nothing in the suite calls Gemini. The live runbook is in [OPERATIONS](OPERATIONS.md#first-live-gemini-run).

## Docs checks

`packages/shared/test/docs.test.js` checks the GAMEPLAY and CLASS_GUIDE tables against `constants.js` and the balance simulator, and `packages/shared/test/xpGuide.test.js` checks the amounts and caps in the XP_GUIDE table. After changing a number run `npm run balance` and update the docs in the same commit.

`packages/shared/test/docLinks.test.js` follows every relative link in the Markdown files (root, `docs/`, `docs/design/`, `db/legacy/` and each package's README) and fails when a file or a `#heading` anchor it names does not exist (GitHub's slug rules; links in code are ignored). `apps/bot/test/commandsDoc.test.js` reads the command set from `deploy-commands.js` and checks that `docs/COMMANDS.md` has a table row for each slash command, and none for a command that is not registered.

## Reports and maintenance scripts

These are not tests, but they read a real database (the one in `.env`) and are the way to check the game against real play:

| Command | What it does |
|---|---|
| `npm run balance` | Simulates a player per class and prints the XP each earns (no database); the docs tests compare against it |
| `npm run xp-report` | XP earned per source and class from `xp_transactions`, to compare with the [previews](KNOWN_ISSUES.md#by-design) |
| `npm run arcade-report` | How fast real players score in each arcade game, to calibrate the anti-cheat bound ([#39](KNOWN_ISSUES.md#limitations)) |
| `npm run archive -- --days 365` | Moves old XP rows to the archive table (game sessions too with `--games`) and deletes old task history; `--dry-run` only counts ([DATABASE](DATABASE.md#backups-and-maintenance)) |

## What CI runs

`.github/workflows/ci.yml`: lint, typecheck, build, syntax check, unit tests, integration tests on `pgvector/pgvector:pg16`, the AI service (`ruff`, `mypy`, `pytest`, Postgres SQL tests), Playwright, and `npm audit --omit=dev --audit-level=high`.
