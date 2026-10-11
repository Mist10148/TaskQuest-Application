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

Use a **separate Discord application** for development, register commands to a test guild with `npm run deploy:commands -- --guild=<id>`, and use a local database.

## Where code belongs

| Change | Put it in |
|---|---|
| A number, rule, class, skill, achievement or game rule | `packages/shared/src` (`constants.js`, `xp.js`, `games/`) |
| Anything that reads or writes the database | `packages/shared/src/db/*` services |
| A schema change | A **new** migration, `packages/shared/src/db/migrations/00N_name.js` |
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
- **Never edit a released migration.** Add a new one, and make it idempotent with the `h.*IfMissing` helpers.
- **Date-only values stay strings.** Deadlines and due dates are `YYYY-MM-DD` with no zone. Compare and format them with `packages/shared/src/dates.js` (or `apps/web/src/lib/dates.ts`), never `new Date('2030-01-05')`, which is UTC midnight and shifts the day.
- **Rewards need a cap.** Anything that pays XP for something a user can repeat cheaply must have a per-day limit (see `LIMITS` in `constants.js`) and a test that proves it.
- **Update the docs** (`docs/GAMEPLAY.md`, `docs/API.md`, `docs/COMMANDS.md`, `docs/DATABASE.md`) when behaviour changes, and add a line to `CHANGELOG.md`.

## Testing

```bash
npm test               # unit tests in every workspace, incl. the web app's Vitest suite (integration tests are skipped)
npm run check          # node --check on all Node sources
npm run lint
npm run typecheck
npm run build
```

The web app's unit tests (`apps/web/src/**/*.test.ts`) cover pure logic: date helpers, the quick-add parser, the game loop and the WCAG contrast of both themes (`theme.test.ts` reads `index.css`, so a colour change that makes text unreadable fails the build). There are no component tests; browser smoke tests are described under "Browser tests" below, and "Trying the web app locally" has a manual check.

### Integration tests

The service, API and bot-flow tests run against a real database. They are skipped unless `TEST_DB_NAME` is set. **The target database is wiped**, so use a throwaway one:

```bash
mysql -uroot -e "CREATE DATABASE taskquest_test"
TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=3306 TEST_DB_USER=root TEST_DB_PASSWORD= TEST_DB_NAME=taskquest_test npm test
```

With XAMPP's MariaDB you can also start a disposable server with its own data directory on another port. CI runs the same suite against MySQL 8.

When fixing a bug, add a test that fails without the fix. Use the existing helpers: the injectable `rng` for rules, and `fake()` interactions for bot flows.

### Browser tests

`apps/web/e2e` holds a small Playwright suite (Chromium) that drives the built app against a real API and database. It is separate from `npm test` and runs in its own CI job. The seed script **wipes** its database (default `taskquest_e2e`, override with `E2E_DB_HOST`, `E2E_DB_PORT`, `E2E_DB_USER`, `E2E_DB_PASSWORD`, `E2E_DB_NAME`):

```bash
mysql -uroot -e "CREATE DATABASE taskquest_e2e"
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
pytest tests/unit tests/graphs tests/evals        # offline: fake models, in-memory SQLite, mocked Express
python -m tests.evals.run                         # offline eval pipeline (also in CI)
```

`pytest tests/mysql` runs the service's SQL against a real MySQL 8 with the Node migrations applied (the `ai-mysql` CI job: run `npm run db:migrate` against a scratch database first, then set `AI_TEST_DB_URL=mysql://user:pw@host:3306/db`). Nothing in the suite calls Gemini; the live runbook is in [docs/OPERATIONS.md](docs/OPERATIONS.md#first-live-gemini-run).

### Trying the web app locally without Discord

Discord login needs a real application, which is overkill for checking a UI change. For a quick manual check, serve the built app from the real server against a **scratch database** and sign in with a seeded session (the same trick the API integration tests use):

1. Create a throwaway database and set `DB_*` to it (never your real data), `SESSION_SECRET` to any 32+ characters, `PUBLIC_URL=http://localhost:3001`, `SERVE_FRONTEND=true`.
2. `npm run build`, then `node apps/server/index.js`.
3. Insert a `web_sessions` row for a test user and put the signed cookie in your browser (see `login()` in `apps/server/test/api.integration.test.js` for how the signature is built).

Check the page you changed in **both themes**, at a phone width, and with the keyboard only.

## Style

- **Node packages:** CommonJS (`bot`, `shared`), ESM (`server`). Four-space indentation, single quotes, semicolons. Keep the existing comment style: explain *why*, not *what*.
- **Web:** TypeScript, two-space indentation, double quotes. Typed API responses from `src/lib/api.ts`, no `any`.
- `.editorconfig` and `.gitattributes` enforce UTF-8 and LF line endings.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(bot): …`, `fix(shared): …`, `docs: …`, `test: …`, `chore(deploy): …`.
- Keep commits focused, so one logical change per commit. A bug fix commit should contain the test that proves it.
- PRs need green CI (lint, typecheck, build, tests on MySQL 8, audit) and updated docs if behaviour changed.
- Never commit `.env` files, tokens or database dumps. If you leak a secret, rotate it immediately; deleting the commit is not enough.
