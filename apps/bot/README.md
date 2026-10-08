# TaskQuest Bot v3.8.3

TaskQuest is a Discord task manager with RPG progression. You organise work into lists and items, earn XP for finishing them, pick a class, unlock skills, chase achievements, and play mini-games, all from slash commands inside Discord.

- **Version:** 3.8.3 (see [`package.json`](package.json))
- **Stack:** Node.js 18+, discord.js 14, MySQL / TiDB via mysql2
- **Documentation:**
  - [Product requirements (PRD)](docs/PRD.md)
  - [Architecture](docs/ARCHITECTURE.md)
  - [Command and interaction reference](docs/COMMANDS.md)
  - [Gameplay and progression](docs/GAMEPLAY.md)
  - [Database schema](docs/DATABASE.md)
  - [Deployment and configuration](docs/DEPLOYMENT.md)
  - [Known issues](docs/KNOWN_ISSUES.md)

## Features

- **Lists and items.** Create lists with a description, deadline (`YYYY-MM-DD`), category and priority. Add, edit, describe, complete, delete and reorder items. Filter and sort lists, search by name, and see a progress bar for each list.
- **XP and levels.** Completing items, creating lists, claiming the daily reward and winning games all award XP. Level is `floor(XP / 100) + 1`.
- **Seven classes.** Default, Hero, Gambler, Assassin, Wizard, Archer and Tank. Each applies a different XP modifier. Classes are bought with XP and kept permanently.
- **Skill trees.** Each class has its own tree of skills that you buy with XP. Some skills modify XP; many are not yet implemented (see [Known issues](docs/KNOWN_ISSUES.md)).
- **Achievements.** 29 milestone achievements across lists, items, completions, XP, levels, streaks, classes and games.
- **Daily reward.** 100 base XP every 24 hours, with a streak bonus for consecutive days.
- **Mini-games.** Blackjack (XP bets), Rock-Paper-Scissors, and Hangman.
- **Leaderboard.** The top 10 players by XP.
- **Deadline reminders.** A DM each hour for lists due today, for users who have turned on `/automation`.
- **XP toggle.** `/toggle` turns XP tracking on or off per user. Lists and items still work with it off.

## Commands

| Command | What it does |
|---|---|
| `/list [name]` | Open the lists overview, or open one list by name (autocomplete). |
| `/game` | Game centre: Blackjack, Rock-Paper-Scissors, Hangman. Resumes an active Blackjack hand. |
| `/profile [user]` | Profile dashboard for yourself or another user. Public. |
| `/daily` | Claim the daily XP reward. |
| `/class` | Browse classes, buy and equip them, and open each class's skill tree. |
| `/achievements` | Paginated achievement list with unlock status. |
| `/leaderboard` | Top 10 players by XP. Public. |
| `/automation` | Toggle deadline reminder DMs. |
| `/toggle` | Turn the XP system on or off. |
| `/ping` | Show bot and API latency. |
| `/app` | Link to the TaskQuest web dashboard (`WEB_APP_URL`). |
| `/help` | Command reference. Public. |

There is no `/skills` command. Skill trees are opened from `/class`. The full reference, including every button and menu, is in [docs/COMMANDS.md](docs/COMMANDS.md).

## Classes

| Class | Cost | Mechanic |
|---|---|---|
| Default | Free | No modifier. Starter class. |
| Hero | 500 XP | +25 flat XP per completed task. |
| Gambler | 300 XP | Random bonus, with a 20% chance that the XP reward is reduced instead. |
| Assassin | 400 XP | Streak stacks add +5% of base XP per stack, up to 10 stacks. |
| Wizard | 700 XP | Every 3rd action adds a wisdom bonus. Every 5th adds double that. |
| Archer | 600 XP | Hit or miss roll on each action. Hits build a streak with a headshot chance. |
| Tank | 500 XP | Stacks rise per action (up to a cap) for a percentage bonus plus a flat bonus. |

Exact formulas are in [docs/GAMEPLAY.md](docs/GAMEPLAY.md).

## Quick start

### Prerequisites

- [Node.js](https://nodejs.org/) 18.0.0 or later
- A MySQL-compatible database: local (for example [XAMPP](https://www.apachefriends.org/)) or cloud (for example Aiven, Railway, TiDB Cloud, AWS RDS)
- A [Discord application](https://discord.com/developers/applications) with a bot user

### 1. Create the Discord application

1. In the [Developer Portal](https://discord.com/developers/applications), click **New Application**.
2. Open the **Bot** tab, click **Reset Token** or **Add Bot**, and copy the token.
3. Copy the **Application ID** from **General Information**. This is your `CLIENT_ID`.
4. Under **Bot > Privileged Gateway Intents**, enable **Server Members Intent**. This is the only privileged intent the bot needs. Guilds and direct messages are non-privileged.
5. Under **OAuth2 > URL Generator**, select the `bot` and `applications.commands` scopes. Use the generated URL to invite the bot to a server.

### 2. Install

```bash
git clone <your-repo-url> taskquest-bot
cd taskquest-bot
npm install
```

### 3. Configure

```bash
cp .env.example .env
```

Fill in at least `DISCORD_TOKEN`, `CLIENT_ID` and the database settings. The full list is in the [configuration table](#configuration) below and in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Never commit `.env`. It is listed in `.gitignore`.

### 4. Create the database

- **Local (XAMPP):** start MySQL, create a database named `taskquest_bot`, and leave the `DB_*` defaults.
- **Cloud:** create a database on your provider, set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` and `DB_NAME` (or `DB_URL`), and set `DB_SSL=true` if the provider requires TLS.

The bot creates its tables on first start. Automatic creation does **not** create every table the blackjack feature needs. To get the full schema, apply [`database/schema.sql`](database/schema.sql) manually. See [docs/DATABASE.md](docs/DATABASE.md#auto-created-versus-schemasql).

### 5. Register slash commands

```bash
npm run deploy                 # global: can take up to an hour to appear
GUILD_ID=<server id> npm run deploy   # guild: appears immediately, good for development
```

`deploy-commands.js` also accepts the guild ID as an argument in the form `--guild=<id>`. Each run first clears the global command set, so the most recent deployment is the one that counts.

### 6. Run

```bash
npm start      # production
npm run dev    # restarts on file changes (node --watch)
```

On startup the bot:

1. Starts an HTTP server on `PORT` (default 3000) that returns a small JSON status.
2. Logs in to Discord.
3. When ready, connects to the database and creates missing tables.
4. Starts the deadline reminder check (first run after 5 seconds, then hourly), the old-list cleanup (every 24 hours) and the game-session expiry sweep (every 15 minutes).

## Configuration

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DISCORD_TOKEN` | Yes | none | Bot token. The process exits at startup if it is missing. |
| `CLIENT_ID` | For deploy | none | Application ID, used by `deploy-commands.js`. |
| `GUILD_ID` | No | none | Guild ID for instant command deployment. |
| `DB_HOST` | Yes (unless `DB_URL`) | `localhost` | MySQL host. |
| `DB_PORT` | No | `3306` | MySQL port. |
| `DB_USER` | Yes (unless `DB_URL`) | `root` | MySQL user. |
| `DB_PASSWORD` | Yes (unless `DB_URL`) | empty | MySQL password. |
| `DB_NAME` | Yes (unless `DB_URL`) | `taskquest_bot` | MySQL database. |
| `DB_URL` | No | none | Connection URL. Used instead of the individual `DB_*` values. |
| `DB_SSL` | No | off | Set to `true` to enable TLS. |
| `DB_SSL_REJECT_UNAUTHORIZED` | No | `true` | Set to `false` to accept self-signed certificates. |
| `WEB_APP_URL` | No | `https://taskquest.app` | Link target for `/app`. |
| `PORT` | No | `3000` | HTTP status server port. |

`.env.example` also lists `DB_POOL_SIZE`, `DB_TIMEZONE` and `LOG_LEVEL`. The current code does not read them. See [Known issues](docs/KNOWN_ISSUES.md).

## Project structure

```
taskquest-bot/
├── index.js                  Entry point: client, HTTP status server, timers, interaction routing
├── deploy-commands.js        Registers slash commands with the Discord API
├── commands/
│   ├── list.js               /list: lists, items, filters, search, modals
│   ├── game.js               /game: Blackjack, Rock-Paper-Scissors, Hangman
│   └── gamification.js       /ping /daily /automation /profile /achievements /class /leaderboard /toggle /help /app
├── database/
│   ├── db.js                 Connection pool, table creation, query helpers
│   └── schema.sql            Reference schema with foreign keys and indexes
├── utils/
│   ├── gameLogic.js          Classes, skill trees, achievements, XP formulas
│   ├── gamification.js       Older copy of commands/gamification.js; not imported by index.js
│   ├── ui.js                 Embeds, buttons, menus, colours and emoji
│   └── games/
│       ├── deck.js           Card deck, hand values, dealer logic
│       ├── sessionManager.js Game session lifecycle and expiry
│       └── xpTransaction.js  Locked XP transactions with an audit log
├── docs/                     Product and technical documentation
├── render.yaml               Render blueprint (worker service)
└── .env.example              Environment variable template
```

## Database

MySQL 8, MariaDB and TiDB are the targets. Seven tables are created automatically: `users`, `lists`, `items`, `achievements`, `user_skills`, `game_sessions` and `xp_transactions`. Blackjack also needs a `blackjack_hands` table, which only `schema.sql` creates. The full reference is in [docs/DATABASE.md](docs/DATABASE.md).

## Deployment

The repository includes [`render.yaml`](render.yaml), a Render blueprint for a background worker.

1. Push the repository to GitHub or GitLab.
2. On Render, choose **New > Blueprint** and connect the repository, or create a **Background Worker** manually with build command `npm install` and start command `npm start`.
3. Add the environment variables from the configuration table.

Render sends `SIGTERM` when it stops a service. The bot only handles `SIGINT`, so shutdown is not graceful on Render. Details are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Troubleshooting

- **Commands do not appear.** Global deployments take up to an hour. Use `GUILD_ID` for instant updates while developing.
- **`Missing DISCORD_TOKEN` at startup.** The `.env` file is missing or the variable is blank.
- **Blackjack fails with a missing table or column.** Apply `database/schema.sql` to the database.
- **Members are shown as "Unknown User" on the leaderboard.** The bot cannot fetch those members. Check that the Server Members intent is enabled.
- **Slash command `--guild` argument ignored.** Use `--guild=<id>` (with `=`), or set `GUILD_ID`.

## Contributing

Open an issue or pull request. Keep changes focused, and update the matching file in `docs/` when behaviour changes.

## License

MIT
