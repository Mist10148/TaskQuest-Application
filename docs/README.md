# Documentation index

Last verified against code: 29 October 2026 (2026-10-29), after the review passes listed in the [CHANGELOG](../CHANGELOG.md#unreleased).

`packages/shared/test/docs.test.js` (run by `npm test`) checks the tables in GAMEPLAY.md against `packages/shared/src/constants.js`, the numbers in the class and skill descriptions against the rules, and the build tables in CLASS_GUIDE.md against the balance simulator. The other documents are checked by hand: when you change behaviour, update the matching document in the same commit and add a line to the [CHANGELOG](../CHANGELOG.md).

## For players

| Document | What it is |
|---|---|
| [START_HERE.md](START_HERE.md) | A short path for players and one for contributors |
| [WHATS_NEW.md](WHATS_NEW.md) | What changed since 3.x, and the October 2026 balance pass, in plain words |
| [XP_GUIDE.md](XP_GUIDE.md) | How XP is earned: every source with its amount, cap, modifiers and the order of calculation |
| [CLASS_GUIDE.md](CLASS_GUIDE.md) | The seventeen classes: what each rewards, who it suits, example builds with computed XP, pitfalls |
| [PLAYER_FAQ.md](PLAYER_FAQ.md) | Streaks, freezes, XP off, reminders, time zone days, prestige, sharing, import and export, push, Blackjack |
| [GAMEPLAY.md](GAMEPLAY.md) | The exact rules: XP, levels, classes, skills, quests, bonuses, prestige, cosmetics, parties, achievements, games, limits |
| [COMMANDS.md](COMMANDS.md) | Every Discord command, the `/list` flow, background behaviour and interaction ids |

## For developers

| Document | What it is |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, the shared package and its modules, request flows, transactions, games, security design, jobs, tests |
| [API.md](API.md) | Every REST endpoint with request and response shapes, errors and rate limits |
| [DATABASE.md](DATABASE.md) | The PostgreSQL baseline migration, every table and column, XP sources, connection settings, maintenance |
| [MIGRATION_POSTGRES.md](MIGRATION_POSTGRES.md) | The move from MySQL/TiDB to PostgreSQL on Supabase: decisions, type mapping, SQL rewrite rules, cutover runbook |
| [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) | How the optional AI service is built: graphs, retrieval, tools, guardrails |
| [AI_INTEGRATION.md](AI_INTEGRATION.md) | The AI design record: goals, decisions and how the build differs from the plan |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Local setup, where code belongs, tests (unit, integration, browser, AI), style |

## Package READMEs

Each part of the repository has its own README with its commands and a map of its modules.

| Document | What it is |
|---|---|
| [apps/web/README.md](../apps/web/README.md) | The web app: commands, how it is organised, its pages and address (URL) parameters, tests |
| [apps/server/README.md](../apps/server/README.md) | The Express API: routes, middleware, configuration |
| [apps/bot/README.md](../apps/bot/README.md) | The Discord bot: commands, background jobs, modules |
| [apps/ai/README.md](../apps/ai/README.md) | The optional AI service: its HTTP API, graphs, tests |
| [packages/shared/README.md](../packages/shared/README.md) | `@taskquest/shared`: every rules and database module |
| [db/legacy/README.md](../db/legacy/README.md) | The MySQL-era SQL scripts kept for history (do not run) |
| [../CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | How contributors are expected to behave |

## For operators

| Document | What it is |
|---|---|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Discord setup, database (Supabase), every environment variable (including web push and AI), Render, upgrades |
| [OPERATIONS.md](OPERATIONS.md) | Backups and restore, troubleshooting, useful queries, the first live Gemini run |
| [KNOWN_ISSUES.md](KNOWN_ISSUES.md) | Known limitations and their workarounds |
| [TESTING.md](TESTING.md) | Every check and test suite, how to run it locally and what CI runs |
| [../SECURITY.md](../SECURITY.md) | Security model, fixed vulnerabilities, residual risks, secret rotation, reporting |

## Product and design records

| Document | What it is |
|---|---|
| [ROADMAP.md](ROADMAP.md) | What is open next, what is later and the open product decisions |
| [PRD.md](PRD.md) | Goals, personas, user stories (`US-` ids), functional requirements, platform parity, roadmap, risks |
| [design/balance.md](design/balance.md) | Why the level curve stays linear, how class power was estimated, the caps, open balance questions |
| [design/shared-lists.md](design/shared-lists.md) | Shared lists and parties: the permission model and what was built |
| [design/arcade-anti-cheat.md](design/arcade-anti-cheat.md) | Arcade anti-cheat: the options and the replay verification that shipped |
| [design/tailwind-4-migration.md](design/tailwind-4-migration.md) | The Tailwind CSS 4 migration and its outcome |
| [../CHANGELOG.md](../CHANGELOG.md) | Release history, including the upgrade notes for the unreleased pass |
