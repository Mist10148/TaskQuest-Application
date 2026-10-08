# TaskQuest Web v1.5

TaskQuest is a gamified task manager. You create quest lists, complete the tasks inside them, and earn XP that drives levels, character classes, skill trees, achievements, daily rewards and a set of mini-games. The web app signs users in with Discord and shares its database with the TaskQuest Discord bot, so progress made in either place shows up in both.

This README covers setup, configuration, architecture and deployment. For product intent see [docs/PRD.md](docs/PRD.md). For exact game numbers see [docs/GAME_MECHANICS.md](docs/GAME_MECHANICS.md). For endpoint contracts see [docs/API.md](docs/API.md). For frontend and backend internals see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). For known issues see [SECURITY.md](SECURITY.md).

> **Status: v1.5, pre-production.** The app runs end to end, but several security and integrity gaps are open (for example, game payouts are trusted from the client and item routes lack ownership checks). Read [SECURITY.md](SECURITY.md) before exposing a deployment to real users.

---

## Table of contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Database](#database)
- [Scripts](#scripts)
- [Project structure](#project-structure)
- [Deployment (Render)](#deployment-render)
- [Discord bot integration](#discord-bot-integration)
- [Troubleshooting](#troubleshooting)
- [Documentation map](#documentation-map)
- [Contributing](#contributing)
- [License](#license)

---

## Features

| Area | What it does |
|---|---|
| **Quest lists and tasks** | Create lists with a name, description, category (School, Work, Personal, Health, Finance, Shopping, Fitness, Other), priority (HIGH, MEDIUM, LOW) and deadline. Add tasks, complete them, reorder them, and edit or delete either. |
| **Quest log** | Filter by category, priority and status. Search by name or category. Sort by date, name, priority or deadline. Tabs for All, Current, Expired and Completed. |
| **XP and levels** | Every meaningful action awards XP. Level = `floor(XP / 100) + 1`. XP is also a spendable balance, so buying classes, skills and losing bets reduces it. |
| **Classes** | Seven classes: DEFAULT (free), HERO, GAMBLER, ASSASSIN, WIZARD, ARCHER and TANK. Each has its own cost and an XP rule that modifies what you earn. |
| **Skill trees** | Each class has a skill tree of prerequisite-gated skills that cost XP to unlock or upgrade. |
| **Achievements** | 25 milestone badges across lists, productivity, completion, streaks, levels and class ownership. |
| **Daily reward** | Claim 100 base XP every 24 hours, plus a streak bonus (up to +50) and class and skill bonuses. |
| **Mini-games** | Blackjack, Rock-Paper-Scissors, Hangman (betting games), and Snake, Dino Runner, Space Invaders (free arcade games). |
| **Leaderboard** | Public top-10 by current XP. |
| **Discord login** | OAuth2 with the `identify` scope. No separate account is needed. |
| **Settings** | Toggle gamification, automation and auto-delete of old lists, or reset all progress. |

Responsive layout: the sidebar becomes a drawer below the `lg` breakpoint. The game canvases use fixed sizes and may overflow narrow phones (known issue).

---

## Architecture

```mermaid
flowchart LR
    subgraph Browser
        SPA["React SPA<br/>(Vite build, react-query)"]
    end

    subgraph Render["Render.com"]
        API["Express API<br/>server/index.js<br/>express-session (MemoryStore)"]
    end

    DB[("MySQL<br/>users, lists, items,<br/>user_skills, achievements,<br/>game_sessions, xp_transactions")]
    Discord["Discord OAuth2<br/>discord.com/api"]
    Bot["TaskQuest Discord bot<br/>(separate project)"]

    SPA -- "HTTPS + session cookie<br/>credentials: include" --> API
    API -- "mysql2 pool" --> DB
    API -- "authorization code exchange<br/>+ /users/@me" --> Discord
    Bot -- "same tables" --> DB
```

Key points:

- The **frontend** is a static SPA. It has no server of its own and calls the API at `VITE_API_URL`.
- The **backend** is a single Express app. It handles OAuth, sessions, all game logic (XP calculation, class counters, skill bonuses, achievements) and all SQL.
- **Identity** is the Discord user ID. There are no JWTs. The session cookie holds `{discordId, username, globalName, avatar, discriminator}`.
- The **database schema is owned by the Discord bot**. This repo contains no `CREATE TABLE` statements. See [Database](#database).
- Game logic lives on the server, but **game results are reported by the client**. This is the most important trust boundary to fix (see [SECURITY.md](SECURITY.md)).

---

## Tech stack

| Layer | Technology | Version (from `package.json`) |
|---|---|---|
| UI framework | React, react-dom | ^18.3.1 |
| Language | TypeScript | ^5.8.3 |
| Build | Vite, @vitejs/plugin-react-swc | ^5.4.19, ^3.11.0 |
| Routing | react-router-dom | ^6.30.1 |
| Server state | @tanstack/react-query | ^5.83.0 |
| Styling | Tailwind CSS, tailwindcss-animate, @tailwindcss/typography | ^3.4.17 |
| Components | shadcn/ui on Radix UI primitives | various |
| Motion | framer-motion | ^12.23.26 |
| Charts | recharts | ^2.15.4 |
| Icons | lucide-react | ^0.462.0 |
| Forms and validation | react-hook-form, zod (frontend only) | ^7.61.1, ^3.25.76 |
| Toasts | sonner | see `package.json` |
| Fonts | @fontsource/inter, @fontsource/rajdhani | see `package.json` |
| Backend runtime | Node.js >= 18 | `engines` in root `package.json` |
| Backend framework | Express | ^4.21.0 |
| Sessions | express-session | ^1.18.0 |
| Database driver | mysql2 | ^3.11.0 |
| CORS | cors | ^2.8.5 |
| Env loading | dotenv | ^16.4.5 |
| Linting | ESLint 9, typescript-eslint | ^9.32 |

Note: `server/package.json` declares the same backend packages with slightly older version floors. Installs use the root `package.json`, so the root versions are the ones that matter.

---

## Quick start

### Prerequisites

- **Node.js 18 or newer** (the server uses global `fetch`).
- **npm**.
- **MySQL 8 or MariaDB** with the TaskQuest schema already present. Either the Discord bot's database, or a local copy (see [Database](#database)).
- A **Discord application** from the [Developer Portal](https://discord.com/developers/applications).

### 1. Clone and install

```bash
git clone https://github.com/Mist10148/taskquest-web_deploy.git
cd taskquest-web_deploy
npm install
```

A single root install covers both the frontend and the server.

### 2. Create the Discord OAuth application

1. In the Developer Portal, open your application (or create one).
2. Go to **OAuth2 → General**. Copy the **Client ID** and **Client Secret**.
3. Add a redirect URL:
   - Local: `http://localhost:3001/api/auth/callback`
   - Production: `https://<your-api-host>/api/auth/callback`

The redirect URL must match `DISCORD_REDIRECT_URI` exactly.

### 3. Configure the environment

Create a `.env` file in the directory you start the server from. The complete variable reference is in [Configuration](#configuration). A minimal local setup:

```env
# Server
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:8080
SESSION_SECRET=replace-with-a-random-string-of-32-plus-characters

# Discord
DISCORD_CLIENT_ID=your-client-id
DISCORD_CLIENT_SECRET=your-client-secret
DISCORD_REDIRECT_URI=http://localhost:3001/api/auth/callback

# Database (local XAMPP-style)
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=taskquest_bot

# Frontend build/dev
VITE_API_URL=http://localhost:3001
```

### 4. Run both servers

Use two terminals:

```bash
# Terminal 1: frontend (Vite, port 8080)
npm run dev

# Terminal 2: backend (Express, port 3001, auto-reload)
npm run dev:server
```

Open **http://localhost:8080** and click **Login with Discord**.

---

## Configuration

### Environment variables

The table lists every variable the code reads. "Read by" shows which side uses it. Defaults are the values used when the variable is unset.

| Variable | Read by | Required | Default | Purpose |
|---|---|---|---|---|
| `PORT` | server | no | `3001` | HTTP port for the API. |
| `NODE_ENV` | server | recommended | (unset) | `production` enables secure cookies (`secure`, `sameSite=none`) and serves `dist/` from Express. Any other value uses `sameSite=lax`. |
| `FRONTEND_URL` | server | yes | `http://localhost:5173` | Allowed CORS origin and the post-login redirect target (`${FRONTEND_URL}/dashboard`). Must match the browser origin exactly. The local Vite port is **8080**, so set it to `http://localhost:8080`. |
| `SESSION_SECRET` | server | yes in production | `taskquest-secret-change-in-production` | Signs the session cookie. The fallback is public. Always set it. |
| `DISCORD_CLIENT_ID` | server | yes | none | OAuth client ID. |
| `DISCORD_CLIENT_SECRET` | server | yes | none | OAuth client secret. Never commit it. |
| `DISCORD_REDIRECT_URI` | server | yes | `http://localhost:3001/api/auth/callback` | Must match the redirect URL registered in the Developer Portal. |
| `DB_URL` | server | one of `DB_URL` or the `DB_*` set | (unset) | Full connection string, for example `mysql://user:pass@host:port/db?ssl-mode=REQUIRED`. Takes precedence over the individual settings. |
| `DB_HOST` | server | if no `DB_URL` | `localhost` | MySQL host. |
| `DB_PORT` | server | if no `DB_URL` | `3306` | MySQL port. |
| `DB_USER` | server | if no `DB_URL` | `root` | MySQL user. |
| `DB_PASSWORD` | server | if no `DB_URL` | (empty) | MySQL password. |
| `DB_NAME` | server | if no `DB_URL` | `taskquest_bot` | Database name. |
| `DB_POOL_SIZE` | server | no | `10` | `mysql2` pool connection limit. |
| `DB_SSL` | server | no | off | Set to `true` to enable TLS to MySQL (used with managed providers such as Aiven). |
| `DB_SSL_REJECT_UNAUTHORIZED` | server | no | on | Set to `false` to accept self-signed certificates. Leave on otherwise. |
| `VITE_API_URL` | frontend (build time) | yes for deployed builds | `http://localhost:3001` | Base URL of the API. Vite inlines it at build time, so changing it requires a rebuild. |

Templates:

- `.env.example` (root) is written for production (Aiven `DB_URL`, `NODE_ENV=production`).
- `server/.env.example` is written for local development (XAMPP defaults).

**Where the file is read from.** The server calls `dotenv` with the process's working directory, so `.env` is read from wherever you start Node. Running `npm run server` from the repo root reads the root `.env`. Running from `server/` reads `server/.env`. Put one `.env` in the directory you launch from.

**Never commit real values.** `server/.env` is currently tracked in git and there is no `.gitignore`. See [SECURITY.md](SECURITY.md) for the remediation steps.

---

## Database

TaskQuest reads and writes a MySQL database that the Discord bot also uses. This repository does not contain the schema. It contains no `CREATE TABLE` statements and no seed data. To run the app against a fresh database you need the bot's schema, or a schema recreated from the column lists in [docs/API.md](docs/API.md#14-data-model).

Tables used by the web app:

| Table | Purpose | Key columns |
|---|---|---|
| `users` | One row per Discord user: progress, class ownership, class counters, settings. | `discord_id` (key), `player_xp`, `player_level`, `player_class`, `streak_count`, `last_daily_claim`, `owns_*`, `gamification_enabled` |
| `lists` | Quest lists. | `id`, `discord_id`, `name`, `category`, `priority`, `deadline` |
| `items` | Tasks inside a list. | `id`, `list_id`, `name`, `position`, `completed` |
| `user_skills` | Skill levels per user. Needs a unique key on `(discord_id, skill_id)`. | `discord_id`, `skill_id`, `skill_level` |
| `achievements` | Unlocked achievements. Needs a unique key for `INSERT IGNORE`. | `discord_id`, `achievement_key`, `unlocked_at` |
| `game_sessions` | One row per recorded game. | `discord_id`, `game_type`, `bet_amount`, `state`, `payout`, `ended_at` |
| `xp_transactions` | XP ledger. | `discord_id`, `amount`, `source`, `balance_before`, `balance_after`, `created_at` |

Startup and login migrations run automatically:

- On pool creation: `ALTER TABLE game_sessions MODIFY COLUMN game_type VARCHAR(20)`. This is applied every time the pool is created, and it drops any `NOT NULL` or default that was set on the column.
- On every login: `ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_username VARCHAR(100), ADD COLUMN IF NOT EXISTS discord_avatar VARCHAR(100)`. `IF NOT EXISTS` needs MariaDB or MySQL 8.0.29+. Errors are swallowed.

---

## Scripts

| Command | What it runs |
|---|---|
| `npm run dev` | Vite dev server on port 8080. |
| `npm run dev:server` | Express with `node --watch` on port 3001. |
| `npm run build` | Production build of the frontend into `dist/`. |
| `npm run build:dev` | Build with `--mode development`. |
| `npm run preview` | Serve the built `dist/` locally. |
| `npm run server` | `node server/index.js` (production start). |
| `npm run start` | Alias for `npm run server`. |
| `npm run lint` | ESLint over the whole project. |

There is no test script and no test suite yet. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Project structure

```
taskquest-web/
├── server/                       # Backend (Express, ESM)
│   ├── index.js                  # Routes, session and CORS setup, OAuth, game-result handler
│   ├── db.js                     # mysql2 pool, all SQL, XP ledger, daily claim, reset
│   ├── gameLogic.js              # calculateFinalXP, class XP rules, skill bonuses
│   ├── gameData.js               # CLASSES, SKILL_TREES, ACHIEVEMENTS, HANGMAN_WORDS, BLACKJACK_CONFIG
│   ├── .env                      # Local values (tracked by git: see SECURITY.md)
│   └── .env.example              # Local development template
├── src/                          # Frontend (React + TypeScript)
│   ├── main.tsx                  # Entry point, mounts <App/>
│   ├── App.tsx                   # Providers and route table
│   ├── index.css                 # Theme tokens, utilities, animations
│   ├── App.css                   # Unused Vite template styles (dead code)
│   ├── contexts/AuthContext.tsx  # Session user, demo-mode fallback, login/logout
│   ├── hooks/useApi.ts           # react-query hooks; errors fall back to mock data
│   ├── lib/api.ts                # Typed fetch client for every endpoint
│   ├── lib/utils.ts              # cn() helper
│   ├── pages/                    # Dashboard, Tasks, Games, Classes, Skills, Achievements,
│   │                             # Leaderboard, Profile, Settings, NotFound
│   └── components/
│       ├── layout/DashboardLayout.tsx   # Sidebar, mobile drawer, page chrome
│       ├── game/                        # XPProgressBar, StatCard, ClassBadge, TaskComponents,
│       │                                # AchievementBadge (unused)
│       └── ui/                          # shadcn/ui primitives
├── public/                       # Static assets (favicon, robots.txt, icons)
├── docs/                         # PRD, game mechanics, API, architecture
├── index.html                    # HTML shell and metadata
├── vite.config.ts                # Dev server (port 8080), @ alias, dev-only component tagger
├── tailwind.config.ts            # Theme colours, keyframes, animations
├── tsconfig*.json                # TypeScript configs (app, node)
├── eslint.config.js              # ESLint flat config
├── components.json               # shadcn/ui configuration
├── render.yaml                   # Render blueprint (API service only)
├── package.json                  # Root deps and scripts (frontend and server)
├── .env.example                  # Production-oriented template
└── README.md
```

---

## Deployment (Render)

`render.yaml` defines **one** service: the API. The frontend has to be deployed separately.

### API: Render Web Service

Created from `render.yaml` (service name `taskquest-api`, region Oregon, plan Free):

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm install` |
| Start command | `npm run server` |
| Health check path | `/api/health` |

Set these in the Render dashboard (values marked `sync: false` in the blueprint are not stored in git):

- `NODE_ENV` = `production`
- `PORT` = `3001`
- `SESSION_SECRET` (auto-generated by the blueprint, or your own 32+ character value)
- `FRONTEND_URL` = the URL of your static frontend, exactly (no trailing slash)
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI` = `https://<api-host>/api/auth/callback`
- `DB_URL` = your MySQL connection string

### Frontend: Render Static Site (manual)

| Setting | Value |
|---|---|
| Build command | `npm install && npm run build` |
| Publish directory | `dist` |
| Environment | `VITE_API_URL` = the API service URL |

### Things to get right

- Add the production redirect URL in the Discord Developer Portal, matching `DISCORD_REDIRECT_URI`.
- `FRONTEND_URL` on the API must match the static site's origin. CORS and the post-login redirect both depend on it.
- The API sends its session cookie with `SameSite=None; Secure` in production. Because the frontend and API are on different origins, some browsers block third-party cookies. See [Troubleshooting](#troubleshooting).
- The Render free plan spins down when idle and restarts clear the in-memory session store. Users get logged out after restarts. See [SECURITY.md](SECURITY.md#known-issues).
- `server/index.js` serves `../dist` in production, but `render.yaml` does not build it. If you serve the frontend from the API service, add `npm run build` to its build command.

---

## Discord bot integration

The TaskQuest Discord bot and the web app share one MySQL database keyed on Discord user ID.

1. A user runs the bot in a server where it is installed. The bot records progress against their Discord ID.
2. The same user logs in to the web app with Discord OAuth. The web app reads the same `users` row.
3. Tasks, XP, classes, skills, achievements and leaderboard standing are therefore shared between both.

The bot is a separate project and is not in this repository. The bot's schema is the source of truth for the tables listed in [Database](#database). The "Add Bot to Server" button in Settings is a placeholder (`href="#"`), so it does not yet link to an invite.

---

## Troubleshooting

**The app shows "Demo mode" and a player named QuestMaster.**
The auth check against `/api/auth/me` failed, so the frontend fell back to mock data. Check that `VITE_API_URL` points to the running API, that the API is up (`/api/health`), and that you are logged in. A production build with `VITE_API_URL` unset targets `http://localhost:3001` and falls into demo mode.

**Login succeeds but the browser never reaches the dashboard.**
Check `FRONTEND_URL`. The callback redirects to `${FRONTEND_URL}/dashboard`, and CORS rejects any other origin.

**Discord reports "Invalid redirect URI".**
`DISCORD_REDIRECT_URI` must match the Developer Portal entry character for character, including scheme, port and path.

**Requests fail with CORS errors or cookies are not sent.**
The frontend must call the API with `credentials: 'include'` (it does), and `FRONTEND_URL` must equal the frontend origin. In production the cookie is `SameSite=None; Secure`, so the API must be served over HTTPS. Some browsers (Safari, and any browser blocking third-party cookies) will still refuse a cross-site session cookie. Serving the frontend and API from one origin avoids this.

**Logged out after every restart or idle period.**
Sessions use the default in-memory store. Restarts and free-tier spin-downs erase them. This is a known limitation.

**`/api/health` returns 500 with `database: disconnected`.**
The response includes the raw error message. Check `DB_URL` or `DB_HOST`, `DB_USER`, `DB_PASSWORD` and `DB_NAME`. For managed MySQL that requires TLS, set `DB_SSL=true`.

**Startup logs say `game_type column migration skipped`.**
This is harmless. The `game_sessions.game_type` migration logs a note on any error. The login-time migration that adds `discord_username` and `discord_avatar` swallows its errors silently. On MySQL versions without `ADD COLUMN IF NOT EXISTS` it does nothing, so add those two columns to `users` by hand if they are missing.

**Game canvases are cut off on a phone.**
Dino Runner (600x200) and Space Invaders (500x400) use fixed sizes. Known issue, listed in [docs/PRD.md](docs/PRD.md#11-known-gaps-and-roadmap).

---

## Documentation map

| Document | Audience | Contents |
|---|---|---|
| [README.md](README.md) | Anyone running the app | Setup, configuration, deployment. |
| [docs/PRD.md](docs/PRD.md) | Product, design, engineering | Goals, personas, user stories, requirements, roadmap, open questions. |
| [docs/GAME_MECHANICS.md](docs/GAME_MECHANICS.md) | Designers, engineers, players | XP formulas, classes, skills, achievements, daily reward, mini-games. |
| [docs/API.md](docs/API.md) | Frontend and integration developers | Every endpoint, request and response shapes, errors, data model. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Engineers | Frontend providers and routing, data fetching, design system, backend modules. |
| [SECURITY.md](SECURITY.md) | Operators and engineers | Known security issues, mitigations, reporting. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributors | Workflow, conventions, checklist. |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, branch and commit conventions, and pull request checklist.

---

## License

The README has always stated the project is MIT licensed. This repository does not yet contain a `LICENSE` file or a `license` field in `package.json`. Add both before distributing the code.
