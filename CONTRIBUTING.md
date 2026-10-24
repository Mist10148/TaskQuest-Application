# Contributing

Thanks for helping improve TaskQuest! This guide covers local setup, the project's conventions and how to test changes.

## Local setup

Follow the [Quick start](README.md#quick-start). In short:

```bash
npm install
cp .env.example .env      # one shared, git-ignored file for every app
npm run db:migrate
npm run dev:server   # :3001
npm run dev:web      # :8080 (proxies /api)
npm run dev:bot
```

No PostgreSQL yet? `npm run db:up` starts one in Docker (`docker-compose.yml`: pgvector, listening on localhost:5432, and the databases `taskquest`, `taskquest_test` and `taskquest_e2e`); put `DB_PASSWORD=taskquest-dev` in `.env`. `npm run db:down` stops it and `npm run db:reset` starts over with an empty database.

Use a **separate Discord application** for development, register commands to a test guild with `npm run deploy:commands -- --guild=<id>`, and use a local database.

## Where code belongs

| Change | Put it in |
|---|---|
| A number, rule, class, skill, achievement or game rule | `packages/shared/src` (`constants.js`, `xp.js`, `games/`) |
| Anything that reads or writes the database | `packages/shared/src/db/*` services |
| A schema change | A **new** migration, `packages/shared/src/db/migrations/00N_name.js` (after `006_item_comments`, so from `007`) |
| An HTTP endpoint | `apps/server/routes/*` + a zod schema in `lib/schemas.js` |
| A Discord interaction | `apps/bot/commands/*` + `utils/ui.js` |
| UI | `apps/web/src` (pages in `pages/`, feature components in `components/<feature>/`, shared logic in `lib/` and `hooks/`) |
| AI behaviour (prompts, retrieval, tools) | `apps/ai/app` |

**Rules:**

- **No game logic or SQL in the apps.** If the bot and web would both need it, it goes in `@taskquest/shared`.
- **Every XP change goes through `applyXP`/`rewardAction`** inside `withTransaction` with the user row locked.
- **Every query on user data is scoped by `discord_id`** in the SQL itself.
- **Expected failures throw `TaskQuestError`** (`errors.validation()`, `errors.notFound()`, ...). Never show raw error messages to users.
- **Never trust the client** for outcomes, payouts or prices.
- **Never edit a released migration.** Add a new one, and make it idempotent with the `h.*IfMissing` helpers. Write PostgreSQL: `ON CONFLICT` instead of `INSERT IGNORE`, `RETURNING id` when you need the new id, flags as `SMALLINT` 0/1, `CITEXT` for case-insensitive names ([DATABASE.md](docs/DATABASE.md), [MIGRATION_POSTGRES.md](docs/MIGRATION_POSTGRES.md#sql-rewrite-rules)).
- **Date-only values stay strings.** Deadlines and due dates are `YYYY-MM-DD` with no zone. Compare and format them with `packages/shared/src/dates.js` (or `apps/web/src/lib/dates.ts`), never `new Date('2030-01-05')`, which is UTC midnight and shifts the day.
- **Rewards need a cap.** Anything that pays XP for something a user can repeat cheaply must have a per-day limit (see `LIMITS` in `constants.js`) and a test that proves it.
- **Update the docs** (`docs/GAMEPLAY.md`, `docs/XP_GUIDE.md`, `docs/API.md`, `docs/COMMANDS.md`, `docs/DATABASE.md`; the index is [docs/README.md](docs/README.md)) when behaviour changes, and add a line to `CHANGELOG.md`. `packages/shared/test/docs.test.js` fails when the tables in `docs/GAMEPLAY.md` (class costs, skills, quests, achievements, limits, cosmetics, prestige, arcade) disagree with `constants.js`; the code is the source of truth, so fix the document.

## Testing

[docs/TESTING.md](docs/TESTING.md) describes every suite, what it needs and what it covers. In short:

```bash
npm test               # unit tests in every workspace, incl. the web app's Vitest suite (integration tests are skipped)
npm run check          # node --check on all Node sources
npm run lint
npm run typecheck
npm run build
```

The web app's unit tests (`apps/web/src/**/*.test.ts`) cover pure logic: date helpers, the quick-add parser, the game loop, CSV, stats, sharing and party helpers and the WCAG contrast of both themes (`theme.test.ts` reads `index.css`, so a colour change that makes text unreadable fails the build). Component tests (jsdom and Testing Library, `*.test.tsx` next to the component) cover the shared building blocks and a few pages: mock `@/hooks/useApi` with `vi.mock` and render the component, as `QuestsCard.test.tsx` and `Review.test.tsx` do. Browser smoke tests are described under "Browser tests" below, and "Trying the web app locally" has a manual check.

### Integration tests

The service, API and bot-flow tests run against a real PostgreSQL database with the `vector` and `citext` extensions available. They are skipped unless `TEST_DB_NAME` is set. **The target database is wiped** (`DROP SCHEMA public CASCADE`), so use a throwaway one:

```bash
npm run db:up   # Docker: pgvector/pgvector:pg16 with taskquest_test and taskquest_e2e created for you
TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=5432 TEST_DB_USER=postgres TEST_DB_PASSWORD=taskquest-dev TEST_DB_NAME=taskquest_test npm test
```

Without Docker, use any Postgres 15+ with pgvector and run `CREATE DATABASE taskquest_test` yourself.

CI runs the same suite against the `pgvector/pgvector:pg16` image.

When fixing a bug, add a test that fails without the fix. Use the existing helpers: the injectable `rng` for rules, and `fake()` interactions for bot flows.

### Balance changes

Class and skill numbers are checked three ways: unit tests for the exact rules (`packages/shared/test/rules.test.js`, `skills2.test.js`, `newclasses.test.js`), the GAMEPLAY tables against the constants (`docs.test.js`), and bands for how strong each class may be (`balance.test.js`, fed by the simulation in `packages/shared/src/simulate.js`). When you change a number:

```bash
npm run balance              # the per-class table; add --markdown for the CLASS_GUIDE build tables
npm test -w @taskquest/shared
```

Then update the GAMEPLAY and CLASS_GUIDE text, [design/balance.md](docs/design/balance.md) and the CHANGELOG in the same commit. With real history, `npm run xp-report` shows what each class actually earns per action, and `npm run arcade-report` how fast real players score in the arcade games (the headroom of the plausibility bound).

### Browser tests

`apps/web/e2e` holds a small Playwright suite (Chromium) that drives the built app against a real API and database. It is separate from `npm test` and runs in its own CI job. The seed script **wipes** its database (default `taskquest_e2e`, override with `E2E_DB_HOST`, `E2E_DB_PORT`, `E2E_DB_USER`, `E2E_DB_PASSWORD`, `E2E_DB_NAME`):

```bash
npm run db:up   # creates taskquest_e2e; E2E_DB_PASSWORD=taskquest-dev, or create the database yourself on another Postgres
(cd apps/web && npx playwright install chromium)   # once
npm run build
npm run test:e2e
```

`seed.mjs` resets the schema, creates a player with a few quests and writes a session row directly into `web_sessions`; the tests present the matching signed cookie, so there is no Discord login and no test-only route in the server. Specs are named `*.e2e.ts` (so Vitest ignores them), use role and label selectors and web-first assertions, and must not sleep. On failure a trace and screenshot land in `apps/web/test-results` (git-ignored).

### The AI service (Python)

`apps/ai` has its own toolchain. Use a virtual environment and Python 3.12 (CI) or newer:

```bash
cd apps/ai
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
ruff check .
mypy
pytest tests/unit tests/graphs tests/evals        # offline: fake models, temporary SQLite files, mocked Express
python -m tests.evals.run                         # offline eval pipeline (also in CI)
```

`pytest tests/postgres` runs the service's SQL (asyncpg, pgvector search, `EmbeddingStore`, `SqlCheckpointSaver`) against a real Postgres with the Node migrations applied (the `ai-postgres` CI job: run `npm run db:migrate` against a scratch database first, then set `AI_TEST_DB_URL=postgresql://user:pw@host:5432/db`). Nothing in the suite calls Gemini; the live runbook is in [docs/OPERATIONS.md](docs/OPERATIONS.md#first-live-gemini-run).

### README screenshots

The README has no images yet (known issue #26), because a screenshot needs a signed-in session with some data. The browser-test setup already has both, so the pages can be captured without a Discord login:

```bash
npm run db:up                  # the throwaway taskquest_e2e database (E2E_DB_PASSWORD=taskquest-dev)
(cd apps/web && npx playwright install chromium)   # once
npm run build
CAPTURE_SCREENSHOTS=1 npm run e2e -w @taskquest/web -- screenshots
```

`apps/web/e2e/screenshots.e2e.ts` is skipped unless `CAPTURE_SCREENSHOTS=1`. It signs in as the seeded player (level 4 with a few quests, the same data the other browser tests use), opens twelve pages at 1280 x 800 in the dark theme with animations off, and writes `docs/images/<page>.png`. Look at the images before committing them: the seeded player has little history, so Stats and the leaderboard look sparse. For a richer picture, run the same spec against a staging deployment's database instead. Then add the ones you want to the README, for example `![Dashboard](docs/images/dashboard.png)`, and close #26.

### Trying the web app locally without Discord

Discord login needs a real application, which is overkill for checking a UI change. For a quick manual check, serve the built app from the real server against a **scratch database** and sign in with a seeded session (the same trick the API integration tests use):

1. Create a throwaway database and set `DB_*` to it (never your real data), `SESSION_SECRET` to any 32+ characters, `PUBLIC_URL=http://localhost:3001`, `SERVE_FRONTEND=true`.
2. `npm run build`, then `node apps/server/index.js`.
3. Insert a `web_sessions` row for a test user and put the signed cookie in your browser (see `login()` in `apps/server/test/api.integration.test.js` for how the signature is built).

Check the page you changed in **both themes**, at a phone width, and with the keyboard only.

User-facing text in the web app is moving into a typed message catalog (`apps/web/src/i18n/messages.ts`, read with `useT()`); the Review and Not-found pages use it. Put new strings there when you touch a page, with `{name}` placeholders instead of string concatenation. A translation is a partial catalog, so a missing key shows English.

## Style

- **Node packages:** CommonJS (`bot`, `shared`), ESM (`server`). Four-space indentation, single quotes, semicolons. Keep the existing comment style: explain *why*, not *what*.
- **Web:** TypeScript, two-space indentation, double quotes. Typed API responses from `src/lib/api.ts`, no `any`.
- `.editorconfig` and `.gitattributes` enforce UTF-8 and LF line endings.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(bot): …`, `fix(shared): …`, `docs: …`, `test: …`, `chore(deploy): …`.
- Keep commits focused, so one logical change per commit. A bug fix commit should contain the test that proves it.
- PRs need green CI and updated docs if behaviour changed. The required checks are the jobs in [`.github/workflows/ci.yml`](.github/workflows/ci.yml): **Web** (lint, typecheck, build), **Node** (syntax, tests on PostgreSQL), **Browser tests** (Playwright e2e on PostgreSQL), **AI service** (ruff, mypy, pytest), **AI service on PostgreSQL** (migrated schema) and **Dependency audit** (`npm audit --omit=dev --audit-level=high`).
- Opening an issue or a PR fills in a template (`.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md`); report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in an issue. Dependabot (`.github/dependabot.yml`) opens weekly update PRs for npm, pip and GitHub Actions.
- Never commit `.env` files, tokens or database dumps. If you leak a secret, rotate it immediately; deleting the commit is not enough.
