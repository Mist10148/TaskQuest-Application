# Deployment and configuration

This guide covers the Discord application setup, environment variables, command registration, and running the bot locally or on Render. For the product view, see [PRD.md](PRD.md). For the database schema, see [DATABASE.md](DATABASE.md).

## 1. Discord application

1. Create an application in the [Developer Portal](https://discord.com/developers/applications).
2. **Bot tab.** Add a bot and copy the token. The token is `DISCORD_TOKEN`. Reset it if it is ever exposed.
3. **General Information.** Copy the Application ID. This is `CLIENT_ID`.
4. **Bot tab, privileged intents.** Enable **Server Members Intent**. The bot requests `GuildMembers`, which is privileged, and uses it to show display names on the leaderboard and profile. The `Guilds` and `DirectMessages` intents are not privileged and need no toggle.
5. **OAuth2 > URL Generator.** Select scopes `bot` and `applications.commands`. Select the bot permissions your server needs. The bot sends embeds, buttons and DMs. Invite the bot using the generated URL.

If Server Members Intent is off, the bot still starts. Leaderboard and profile name lookups fall back to user lookups, and some names show as "Unknown User".

## 2. Environment variables

Copy `.env.example` to `.env` for local runs. On Render, set the same names in the service's Environment settings. Never commit `.env`. It is in `.gitignore`.

| Variable | Required | Default | Read by | Purpose |
|---|---|---|---|---|
| `DISCORD_TOKEN` | Yes | none | `index.js` | Bot token. The process exits with code 1 if it is missing. |
| `CLIENT_ID` | Yes, for command deployment | none | `deploy-commands.js` | Application ID |
| `GUILD_ID` | No | none | `deploy-commands.js` | Guild ID for instant command registration |
| `DB_HOST` | Yes, unless `DB_URL` | `localhost` | `database/db.js` | MySQL host |
| `DB_PORT` | No | `3306` | `database/db.js` | MySQL port |
| `DB_USER` | Yes, unless `DB_URL` | `root` | `database/db.js` | MySQL user |
| `DB_PASSWORD` | Yes, unless `DB_URL` | empty | `database/db.js` | MySQL password |
| `DB_NAME` | Yes, unless `DB_URL` | `taskquest_bot` | `database/db.js` | MySQL database |
| `DB_URL` | No | none | `database/db.js` | Connection URL. Replaces the individual `DB_*` values. |
| `DB_SSL` | No | off | `database/db.js` | `true` enables TLS |
| `DB_SSL_REJECT_UNAUTHORIZED` | No | `true` | `database/db.js` | `false` accepts self-signed certificates |
| `WEB_APP_URL` | No | `https://taskquest.app` | `commands/gamification.js` | Link target for `/app` |
| `PORT` | No | `3000` | `index.js` | Port for the HTTP status server |
| `DB_POOL_SIZE` | No | `10` (documented) | not read | Listed in `.env.example`. The pool size is fixed at 10 in code. |
| `DB_TIMEZONE` | No | `UTC` (documented) | not read | Listed in `.env.example`. Not used. |
| `LOG_LEVEL` | No | `info` (documented) | not read | Listed in `.env.example`. Not used. |

Known problems in `.env.example`:

- The line `WEB_APP_URL=` (line 62) has a leading space. Some dotenv parsers may ignore the value.
- `DB_POOL_SIZE`, `DB_TIMEZONE` and `LOG_LEVEL` have no effect. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

### Example `.env` for local development

```env
DISCORD_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_application_id_here
GUILD_ID=your_test_server_id

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=taskquest_bot
```

### Example for a cloud database with TLS

```env
DISCORD_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_application_id_here

DB_URL=mysql://username:password@hostname:4000/taskquest_bot
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=true
```

URL-encode special characters in the password inside `DB_URL`.

## 3. Database

The bot needs a MySQL-compatible database. The code targets MySQL 8, MariaDB and TiDB Cloud. Not every migration works on every engine (see below).

1. Create an empty database, for example `taskquest_bot`.
2. Set the connection variables.
3. Start the bot once. It creates the seven core tables.
4. For Blackjack, apply `database/schema.sql` to add `blackjack_hands` and the `started_at` column. Remove the `CREATE DATABASE` line first, or run it against an existing database.

Details and differences are in [DATABASE.md](DATABASE.md#auto-created-versus-schemasql).

### Cloud notes

- **TiDB Cloud and other remote MySQL.** Set `DB_SSL=true`. Connections are slower than local, which is why game handlers defer their replies.
- **MySQL 8 specifically.** Two startup migrations use `ADD COLUMN IF NOT EXISTS`, which MySQL 8 does not support. They fail silently, so the `auto_delete_old_lists` and `items.updated_at` columns may be missing. Apply those columns manually, or use MariaDB or TiDB.

## 4. Registering slash commands

`deploy-commands.js` registers all 12 commands with Discord's REST API (version 10).

```bash
npm run deploy                         # global: appears within about an hour
GUILD_ID=<server id> npm run deploy    # guild: appears immediately
node deploy-commands.js --guild=<id>   # guild, given on the command line
```

Behaviour:

- Each run first clears all global commands. If a guild ID is given, it also clears that guild's commands, then registers the commands there.
- With a guild ID, the commands are registered only for that guild. With no guild ID, they are registered globally.
- Because global commands are cleared on every run, switching from global to guild deployment removes the global commands.
- The guild ID can come from `--guild=<id>` or from `GUILD_ID`. Use the `=` form. The header comment shows `--guild YOUR_GUILD_ID` with a space, which the script does not parse.
- The startup banner says "v3.2". The package is 3.8.3.
- The script exits with code 1 on failure.

Re-run the script after changing a command's name, description or options. It is not needed for code-only changes.

## 5. Running locally

```bash
npm install
npm start      # node index.js
npm run dev    # node --watch index.js
```

On startup the bot starts the HTTP server, logs in, and when ready initialises the database and starts background timers. A log line shows each step.

Requirements:

- Node.js 18 or later. `npm run dev` uses `node --watch`, which needs Node 18.11 or later.

## 6. Running on Render

The repository includes `render.yaml`, a Render blueprint.

| Setting | Value in blueprint |
|---|---|
| Service type | Background worker |
| Name | `taskquest-bot` |
| Runtime | Node |
| Region | Oregon |
| Plan | Free |
| Build command | `npm install` |
| Start command | `npm start` |
| Environment variables set with `sync: false` | `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` |
| Environment variable with a fixed value | `DB_SSL` = `true` |

Steps:

1. Push the repository to GitHub or GitLab.
2. On Render, choose **New > Blueprint** and select the repository, or create a **Background Worker** manually with the build and start commands above.
3. Fill in the secret variables. Do not commit them.
4. Deploy. Check the logs for "Logged in" and the database initialisation message.
5. Run `npm run deploy` once from a machine with the same `.env`, or run it as a one-off job, so the commands are registered.

### Notes on the blueprint

- **Node version.** Not pinned. Render uses its default. `package.json` requires Node 18 or later. Set `NODE_VERSION` in the environment if you need a specific version.
- **Not in the blueprint.** `DB_URL`, `DB_SSL_REJECT_UNAUTHORIZED`, `WEB_APP_URL` and `PORT`. Add them in the Render dashboard if you use them.
- **Worker versus web service.** The blueprint is a worker. Workers do not receive public HTTP traffic. The bot still starts an HTTP server on `PORT`, but that server is not reachable from the internet on a worker. The "keep-alive" wording in older docs does not apply to a worker, so the HTTP server does not keep the service awake. Check Render's current plan terms for idle and sleep behaviour before relying on uptime.
- **Health checks.** Workers have no health-check path. The status endpoint returns JSON and does not check the database.

## 7. Shutdown

The bot handles `SIGINT` (Ctrl+C) by closing the database pool, closing the HTTP server, destroying the Discord client, and exiting with code 0.

It does not handle `SIGTERM`. Render and most container platforms send `SIGTERM` when they stop or redeploy a service. The process then ends without closing the pool or the Discord connection. Game sessions and XP writes are stored in the database, so they are not lost, but an in-progress write can be interrupted. Hangman games in memory are lost.

Adding a `SIGTERM` handler that runs the same steps as `SIGINT` is the recommended fix. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## 8. Health and monitoring

- **HTTP status.** `GET /` on `PORT` returns `{ status: "online", bot: "TaskQuest", version, uptime }`. The version string in code is 3.8.0, not 3.8.3.
- **Logs.** Each event is printed with a timestamp and category. There are no log levels.
- **Uncaught errors.** Logged. An uncaught exception exits the process after one second, so the platform restarts it.

## 9. Upgrading

1. Pull the new version.
2. Run `npm install` if `package.json` changed.
3. Restart the bot. Schema changes are applied by the startup migrations, or by re-running `schema.sql` on a fresh database.
4. Run `npm run deploy` if command definitions changed.

Back up the database before upgrading. The migrations change column types on every boot.

## 10. Security checklist

- [ ] `.env` is not committed, and is listed in `.gitignore`.
- [ ] The bot token has been reset if it was ever shared or committed.
- [ ] `DB_SSL=true` is set for any remote database.
- [ ] `DB_SSL_REJECT_UNAUTHORIZED` is `true` unless you have a specific reason to change it.
- [ ] The database user has only the privileges the bot needs on its own database.
- [ ] Server Members Intent is enabled only if you need leaderboard and profile names.
