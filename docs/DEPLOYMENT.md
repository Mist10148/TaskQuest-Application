# Deployment and operations

TaskQuest runs as two processes sharing one MySQL-compatible database:

| Process | Start command | Needs |
|---|---|---|
| **Web** (API + built SPA) | `npm run build && npm run start:server` | Public HTTPS URL, Discord OAuth credentials, session secret, DB |
| **Bot** | `npm run start:bot` | Discord bot token, DB. It must stay running (gateway connection). |

## Contents

1. [Discord application setup](#1-discord-application-setup)
2. [Database](#2-database)
3. [Environment variables](#3-environment-variables)
4. [Deploying on Render](#4-deploying-on-render)
5. [Deploying elsewhere](#5-deploying-elsewhere)
6. [Upgrading from the old repositories](#6-upgrading-from-the-old-repositories)
7. [Operations](#7-operations)

---

## 1. Discord application setup

Use one Discord application for both the bot and web login.

1. Go to the [Developer Portal](https://discord.com/developers/applications) and create an application. The **Application ID** is your `CLIENT_ID` / `DISCORD_CLIENT_ID`.
2. **Bot** tab:
   - Reset the token. This is your `DISCORD_TOKEN`; keep it secret.
   - No privileged gateway intents are required, so leave them off.
3. **OAuth2** tab:
   - Copy the **Client Secret**. This is `DISCORD_CLIENT_SECRET`.
   - Add a redirect: `https://<your-web-domain>/api/auth/callback`. For local development, add `http://localhost:8080/api/auth/callback`.
4. **Invite the bot.** In OAuth2 → URL Generator, select the scopes `bot` and `applications.commands`. Under bot permissions, select *Send Messages* and *Embed Links*. Open the URL to add the bot to a server.
5. **Register commands.** Do this once, and again whenever command definitions change:
   ```bash
   DISCORD_TOKEN=... CLIENT_ID=... npm run deploy:commands                 # global (≤1h to appear)
   DISCORD_TOKEN=... CLIENT_ID=... npm run deploy:commands -- --guild=ID   # one server, instant
   ```

## 2. Database

TaskQuest needs MySQL 8.0+ or MariaDB 10.4+ with InnoDB and utf8mb4. Managed options that work include Aiven, Railway, PlanetScale-compatible MySQL, TiDB Cloud, and DigitalOcean.

```sql
CREATE DATABASE taskquest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'taskquest'@'%' IDENTIFIED BY '<strong password>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON taskquest.* TO 'taskquest'@'%';
```

- **Migrations.** These run automatically when either app starts, or manually with `npm run db:migrate`.
- **Least privilege.** If you prefer, run migrations with an admin user, then run the apps with `MIGRATE_ON_START=false` and a user that only has `SELECT, INSERT, UPDATE, DELETE`.
- **TLS.** Cloud databases need TLS. Set `DB_SSL=true` and keep `DB_SSL_REJECT_UNAUTHORIZED=true`. If your provider uses a private CA (Aiven does), put its PEM certificate in `DB_SSL_CA`.

## 3. Environment variables

### Web server (`apps/server`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | prod | `development` | `production` enables secure cookies, HSTS, static serving and the strict config checks |
| `PORT` | | `3001` | Listen port |
| `PUBLIC_URL` | prod | `http://localhost:8080` in dev | The origin users open. Used for OAuth redirects and CSRF origin checks. |
| `ALLOWED_ORIGINS` | | — | Extra comma-separated origins allowed to make write requests |
| `SESSION_SECRET` | prod | random per run in dev | ≥ 32 characters. `openssl rand -base64 48` |
| `DISCORD_CLIENT_ID` | ✓ | — | Application ID |
| `DISCORD_CLIENT_SECRET` | ✓ | — | OAuth2 client secret |
| `DISCORD_REDIRECT_URI` | | `${PUBLIC_URL}/api/auth/callback` | Override only if it differs |
| `TRUST_PROXY` | | `1` in prod, `0` in dev | Number of proxies in front of the server (affects secure cookies and rate-limit IPs) |
| `SERVE_FRONTEND` | | `true` in prod | Serve `apps/web/dist` |
| `MIGRATE_ON_START` | | `true` | Set `false` to only verify the schema |
| `DB_*` | ✓ | — | See below |

### Bot (`apps/bot`)

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | ✓ | Bot token |
| `CLIENT_ID` | for `deploy:commands` | Application ID |
| `GUILD_ID` | | Default guild for `deploy:commands` |
| `WEB_APP_URL` | | Link used by `/app` (e.g. your `PUBLIC_URL`) |
| `PORT` | | Health endpoint port (default 3000) |
| `MIGRATE_ON_START` | | Default `true` |
| `DB_*` | ✓ | See below |

### Database (both apps)

| Variable | Default | Description |
|---|---|---|
| `DB_URL` | — | `mysql://user:pass@host:port/db`. Takes precedence over the individual settings. |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | `localhost`, `3306`, `root`, empty, `taskquest` | Individual settings |
| `DB_SSL` | `false` | `true` to enable TLS (also for `DB_URL`) |
| `DB_SSL_REJECT_UNAUTHORIZED` | `true` | Verify certificates. Only disable for local testing. |
| `DB_SSL_CA` | — | PEM CA certificate contents |
| `DB_POOL_SIZE` | `10` | Connections per process |

### Web build (`apps/web`, optional)

| Variable | Description |
|---|---|
| `VITE_API_URL` | Only for split deployments where the API is on another origin. Not recommended: third-party cookies are often blocked. |
| `VITE_DEV_API_TARGET` | Dev proxy target (default `http://localhost:3001`) |

## 4. Deploying on Render

The repository includes [`render.yaml`](../render.yaml).

1. Push the repository to GitHub. In Render, choose **New → Blueprint** and select the repository.
2. Fill in the prompted secrets:
   - In the `taskquest-database` group: `DB_URL`, plus `DB_SSL_CA` if needed.
   - On `taskquest-web`: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `PUBLIC_URL`.
   - On `taskquest-bot`: `DISCORD_TOKEN`, `CLIENT_ID` and `WEB_APP_URL`.
   - `SESSION_SECRET` is generated for you.
3. After the first deploy, set `PUBLIC_URL` to the web service URL (or your custom domain). Add `<PUBLIC_URL>/api/auth/callback` to Discord's OAuth2 redirects.
4. Register slash commands from your machine (see §1).

**Notes:**

- The web service builds with `npm ci --include=dev && npm run build`, because dev dependencies are needed to build the SPA.
- Render background workers need a paid plan. The bot also exposes a health endpoint on `$PORT`, so it can run as a free **web** service, but free services sleep when idle, which disconnects the bot. Use a paid worker for reliability.
- Health checks: the web service uses `GET /api/health`. The bot's `GET /` returns 200 once it is connected to Discord.

## 5. Deploying elsewhere

Any Node 20 host works, including Railway, Fly.io, a VPS with systemd or PM2, and Docker.

```bash
npm ci --include=dev
npm run build                 # web assets → apps/web/dist
NODE_ENV=production npm run start:server
NODE_ENV=production npm run start:bot
```

Put the web server behind HTTPS (a reverse proxy or the platform's TLS). Set `TRUST_PROXY` to the number of proxies in front of it. Both processes handle `SIGTERM` gracefully.

## 6. Upgrading from the old repositories

If you ran `taskquest-botv2` (v3.x) and/or `taskquest-web_deploy` (v1.5):

1. **Rotate secrets first.** See [SECURITY.md](../SECURITY.md#1-required-action-rotate-leaked-secrets).
2. **Back up the database:** `mysqldump --single-transaction taskquest > backup.sql`.
3. **Deploy 4.0** pointing at the same database. On first start, migration `002_upgrade_legacy` upgrades the schema in place. [DATABASE.md](DATABASE.md#upgrading-a-legacy-database) lists what it changes, including refunds of stuck Blackjack bets.
4. **Replace the two old services** with the two from `render.yaml`. The web app is now served by the API itself:
   - Delete the old static site.
   - Point your domain at `taskquest-web`.
   - Update the Discord OAuth redirect to `<PUBLIC_URL>/api/auth/callback`.
5. **Re-run `deploy:commands`.** The `/list` command definition changed (its `name` option now has a length limit).

Behaviour changes players may notice are listed in [CHANGELOG.md](../CHANGELOG.md#400).

## 7. Operations

| Task | How |
|---|---|
| Check health | `GET /api/health` (web); `GET /` on the bot's port |
| Logs | stdout/stderr. Errors include the route or interaction ID. User-facing messages never include internals. |
| Apply migrations | `npm run db:migrate` (safe to repeat) |
| Invalidate all web sessions | `DELETE FROM web_sessions;`, or rotate `SESSION_SECRET` |
| Inspect a player's XP | `SELECT * FROM xp_transactions WHERE discord_id = ? ORDER BY id DESC LIMIT 50;` |
| Undo an abusive balance | Insert a compensating `xp_transactions` row and update `users.player_xp` in one transaction. Never edit balances without a ledger entry. |
| Data retention | Archive old `xp_transactions` and `game_sessions` rows periodically (see [DATABASE.md](DATABASE.md#backups-and-maintenance)) |
