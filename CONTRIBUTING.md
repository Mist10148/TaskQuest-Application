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
| UI | `apps/web/src` |

**Rules:**

- **No game logic or SQL in the apps.** If the bot and web would both need it, it goes in `@taskquest/shared`.
- **Every XP change goes through `applyXP`/`rewardAction`** inside `withTransaction` with the user row locked.
- **Every query on user data is scoped by `discord_id`** in the SQL itself.
- **Expected failures throw `TaskQuestError`** (`errors.validation()`, `errors.notFound()`, ...). Never show raw error messages to users.
- **Never trust the client** for outcomes, payouts or prices.
- **Never edit a released migration.** Add a new one, and make it idempotent with the `h.*IfMissing` helpers.
- **Update the docs** (`docs/GAMEPLAY.md`, `docs/API.md`, `docs/COMMANDS.md`) when behaviour changes.

## Testing

```bash
npm test               # unit tests (integration tests are skipped)
npm run check          # node --check on all Node sources
npm run lint
npm run typecheck
npm run build
```

### Integration tests

The service, API and bot-flow tests run against a real database. They are skipped unless `TEST_DB_NAME` is set. **The target database is wiped**, so use a throwaway one:

```bash
mysql -uroot -e "CREATE DATABASE taskquest_test"
TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=3306 TEST_DB_USER=root TEST_DB_PASSWORD= TEST_DB_NAME=taskquest_test npm test
```

With XAMPP's MariaDB you can also start a disposable server with its own data directory on another port. CI runs the same suite against MySQL 8.

When fixing a bug, add a test that fails without the fix. Use the existing helpers: the injectable `rng` for rules, and `fake()` interactions for bot flows.

## Style

- **Node packages:** CommonJS (`bot`, `shared`), ESM (`server`). Four-space indentation, single quotes, semicolons. Keep the existing comment style: explain *why*, not *what*.
- **Web:** TypeScript, two-space indentation, double quotes. Typed API responses from `src/lib/api.ts`, no `any`.
- `.editorconfig` and `.gitattributes` enforce UTF-8 and LF line endings.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(bot): …`, `fix(shared): …`, `docs: …`, `test: …`, `chore(deploy): …`.
- Keep commits focused, so one logical change per commit.
- PRs need green CI (lint, typecheck, build, tests on MySQL 8, audit) and updated docs if behaviour changed.
- Never commit `.env` files, tokens or database dumps. If you leak a secret, rotate it immediately; deleting the commit is not enough.
