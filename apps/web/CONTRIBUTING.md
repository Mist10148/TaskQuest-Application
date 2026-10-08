# Contributing to TaskQuest Web

Thanks for helping. This guide covers how to set up a development environment, how the codebase is organised, what to check before you open a pull request, and where the rules live that the code does not enforce by itself.

Read [README.md](README.md) for setup and configuration, and [SECURITY.md](SECURITY.md) before touching authentication, game results or the item routes.

---

## Contents

1. [Before you start](#1-before-you-start)
2. [Development setup](#2-development-setup)
3. [Where things live](#3-where-things-live)
4. [Coding conventions](#4-coding-conventions)
5. [Game rules and content](#5-game-rules-and-content)
6. [Database changes](#6-database-changes)
7. [Branches and commits](#7-branches-and-commits)
8. [Checks before a pull request](#8-checks-before-a-pull-request)
9. [Pull request checklist](#9-pull-request-checklist)
10. [Reporting bugs](#10-reporting-bugs)

---

## 1. Before you start

- For a large change, open an issue first so the approach can be agreed.
- For a security issue, do **not** open a public issue. Follow [SECURITY.md](SECURITY.md#reporting-a-vulnerability).
- Check [docs/PRD.md](docs/PRD.md#11-known-gaps-and-roadmap) to see whether the problem is already known and where it sits in the roadmap.

---

## 2. Development setup

```bash
npm install                  # one install covers frontend and server
cp .env.example .env         # then fill in values, see README "Configuration"
npm run dev                  # Terminal 1: frontend on :8080
npm run dev:server           # Terminal 2: API on :3001
```

You need a MySQL database that already has the TaskQuest schema, and a Discord application with the redirect URL `http://localhost:3001/api/auth/callback`.

**Set `FRONTEND_URL=http://localhost:8080`.** The default in the code is `:5173`, which does not match the Vite port. Login will redirect to the wrong place if you leave it.

**Run the server from the directory that holds your `.env`.** `dotenv` reads the working directory.

There is no seed data. For a local database without the bot, you must create the tables yourself (see [README: Database](README.md#database)).

---

## 3. Where things live

| Change | Location |
|---|---|
| A route or request handling | `server/index.js` |
| SQL, the XP ledger, daily claim | `server/db.js` |
| XP maths, class and skill rules | `server/gameLogic.js` |
| Class, skill and achievement definitions | `server/gameData.js` |
| An API call from the frontend | `src/lib/api.ts` |
| A react-query hook | `src/hooks/useApi.ts` |
| Login state | `src/contexts/AuthContext.tsx` |
| A page | `src/pages/` |
| A reusable game UI piece | `src/components/game/` |
| Sidebar or page chrome | `src/components/layout/DashboardLayout.tsx` |
| A shadcn primitive | `src/components/ui/` (prefer generating from shadcn, do not hand-edit unless necessary) |
| Colours, fonts or animations | `src/index.css` and `tailwind.config.ts` |

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how these pieces fit together.

---

## 4. Coding conventions

The codebase is not uniform, so match the file you are editing.

**General**
- Keep changes focused. Do not reformat files you are not otherwise changing.
- Match the surrounding style. Indentation and comment density vary between files: `server/index.js` uses 4 spaces and section-banner comments. Follow the file you are editing.
- Do not add a dependency unless it is needed. Check whether the same job is already done by an existing package.

**Server (`server/`)**
- ES modules (`import`/`export`). The package is `"type": "module"`.
- Use parameterised queries through `pool.execute` with `?` placeholders. Never build SQL from request values. Dynamic column names are acceptable only when the keys come from server code.
- Put game maths in `gameLogic.js` as pure functions where possible, so they can be tested without a database.
- Check ownership in every query that touches a user's data. The item routes currently do not, so do not copy them as a pattern (see [SECURITY.md](SECURITY.md#item-ownership)).
- Return `{ error: "message" }` with an appropriate status code for failures.

**Frontend (`src/`)**
- TypeScript. Prefer declared types over `any`. The existing `any` use is debt, not a pattern to follow.
- Server data goes through react-query hooks in `useApi.ts`. Do not call `apiFetch` directly from a page.
- **Do not add new mock fallbacks** to hooks. Errors should reach the UI (see [ARCHITECTURE §2.4](docs/ARCHITECTURE.md#24-server-state-hooksuseapits)).
- Use the design tokens (`bg-card`, `text-foreground-muted`, `text-xp`) rather than raw colours. Avoid building Tailwind class names with template strings, because they are purged.
- Use shadcn/ui primitives for dialogs, buttons and inputs.
- Give every icon-only button an `aria-label`.

---

## 5. Game rules and content

Game rules have a single documented source: [docs/GAME_MECHANICS.md](docs/GAME_MECHANICS.md). If you change a rule, update that document in the same pull request.

- **Changing a number** (a cost, a multiplier, a cap): change `gameData.js` or `gameLogic.js`, and update `GAME_MECHANICS.md`.
- **Changing a description**: keep it accurate to the implementation. If a rule is not implemented, say so, rather than describing the intent.
- **Adding a skill**: add it to `SKILL_TREES` in `gameData.js`, add its effect to `getSkillBonuses` in `gameLogic.js`, and note its status in `GAME_MECHANICS.md`. A skill without an effect is a known gap, so avoid adding one unless it is planned.
- **Adding an achievement**: add it to `ACHIEVEMENTS` in `gameData.js`, and add its check to `checkAchievements`. Update the count in the docs.
- **The frontend has its own copies** of class, skill and achievement data in `useApi.ts` and several pages. Until these are consolidated, change every copy.

---

## 6. Database changes

The schema is owned by the Discord bot. Changes that affect the bot must be agreed with the bot's maintainers first.

- Do not add `CREATE TABLE` or `ALTER TABLE` statements to request handlers. The existing runtime migrations in `db.js` are a known problem, not a pattern.
- If you need a schema change, describe it in the pull request, include the SQL, and say whether it is backwards compatible with the bot.
- Update the column lists in [docs/API.md](docs/API.md#14-data-model) and [README: Database](README.md#database).

---

## 7. Branches and commits

- Branch from `main`. Use a short descriptive name, for example `fix/item-ownership` or `docs/security-notes`.
- Write commit messages in the imperative mood with a type prefix. The early history uses plain messages such as "Add files via upload", so there is no strict precedent. The prefix style below is the convention for new work:
  ```
  docs: add API reference
  fix: check item ownership on toggle
  feat: add XP history page
  refactor: move bet limits into gameLogic
  ```
- Keep each commit to one logical change. A large change should be a short series of commits that each leave the project working.
- Do not commit `.env` files, `node_modules`, `dist`, or editor and tool settings.
- Do not rewrite history on `main`.

---

## 8. Checks before a pull request

There is no automated test suite yet. Run these by hand until one exists.

```bash
npm run lint                 # ESLint over the project
npm run build                # frontend must build without errors
npm run server               # API must start and /api/health must return ok
```

Then test the area you changed:

- **Auth change:** log in and out, and check the redirect and the cookie in browser devtools.
- **Task change:** create a list, add items, complete, un-complete, reorder, edit and delete. Check the XP toast.
- **XP or class change:** verify the numbers against [GAME_MECHANICS.md](docs/GAME_MECHANICS.md) for every class you touched.
- **Game change:** play the game through to a win, a loss and a draw, and check the balance and history.
- **Route change:** call the route with no session (expect 401), with a session for another user (expect 403 or 404 once ownership checks exist), and with a malformed body (expect 400, not 500).

If you add behaviour that can be checked with plain functions, prefer adding a test. `gameLogic.js` is the best place to start.

---

## 9. Pull request checklist

Copy this into the description of your pull request and tick each item.

- [ ] The change is focused, and the commits are logical.
- [ ] `npm run lint` passes, and I have not added new lint errors.
- [ ] `npm run build` succeeds.
- [ ] I tested the affected flow by hand, and I say how in the description.
- [ ] No secrets, `.env` values or personal data are in the diff.
- [ ] Every new or changed database query filters by the owning user, or I have explained why it does not need to.
- [ ] Any change to a game rule updates [docs/GAME_MECHANICS.md](docs/GAME_MECHANICS.md).
- [ ] Any change to an endpoint updates [docs/API.md](docs/API.md).
- [ ] Any change to a security-relevant behaviour updates [SECURITY.md](SECURITY.md).
- [ ] I have not added a mock fallback that hides an error.
- [ ] The UI works at phone width and has no horizontal scroll.
- [ ] Interactive elements have accessible names and keyboard access.

---

## 10. Reporting bugs

Open an issue with:

1. What you did, in steps.
2. What you expected.
3. What happened, including any error message and the status code if it came from the API.
4. Your browser and operating system, and whether you were signed in.
5. For a game bug, the game and the result you saw.

If the app showed demo data (for example a player called QuestMaster), say so. That usually means the API was unreachable and it is useful to know.

For a security problem, follow [SECURITY.md](SECURITY.md#reporting-a-vulnerability) instead.
