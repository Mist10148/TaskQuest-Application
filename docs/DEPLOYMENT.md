# Deployment and operations

TaskQuest runs as two processes sharing one PostgreSQL database:

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

TaskQuest needs PostgreSQL 15+ with the `vector` (pgvector) and `citext` extensions. Production runs on **Supabase**; locally, any Postgres with pgvector works (the `pgvector/pgvector:pg16` Docker image is what CI uses). MySQL, MariaDB and TiDB are no longer supported; the move is described in [MIGRATION_POSTGRES.md](MIGRATION_POSTGRES.md).

**Supabase.** Create a project in the region closest to your app hosts, enable `vector` and `citext` under Database → Extensions (the baseline migration also creates them, which the default `postgres` user may do), and copy the **Session pooler** connection string from Connect:

```
DB_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
DB_SSL=true
```

- Use the **session** pooler on port **5432**. It is reachable over IPv4 (Render has no IPv6), and it is session-level, so the migration advisory lock and the AI service's prepared statements work. The transaction pooler (port 6543) breaks both, and the direct host `db.<project-ref>.supabase.co` is IPv6-only.
- Supabase certificates chain to a public root, so `DB_SSL_CA` can stay empty; to pin it, paste the CA from Database → Settings → SSL Configuration.
- The free tier limits pooler clients. The web server, bot, AI service and archive job each open a pool, so keep `DB_POOL_SIZE` small (5 or lower per Node service).

**Self-hosted Postgres.**

```sql
CREATE DATABASE taskquest;
-- then, connected to taskquest:
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE ROLE taskquest LOGIN PASSWORD '<strong password>';
GRANT CONNECT, TEMPORARY ON DATABASE taskquest TO taskquest;
GRANT USAGE, CREATE ON SCHEMA public TO taskquest;
```

- **Migrations.** These run automatically when either app starts, or manually with `npm run db:migrate`.
- **Least privilege.** If you prefer, run migrations with an admin (owner) role, then run the apps with `MIGRATE_ON_START=false` and a role that has only data access: `GRANT USAGE ON SCHEMA public TO app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app;` (identity columns use sequences). Re-run the grants after a migration adds tables, or set `ALTER DEFAULT PRIVILEGES` for the migrating role.
- **TLS.** Cloud databases need TLS. Set `DB_SSL=true` and keep `DB_SSL_REJECT_UNAUTHORIZED=true`. If your provider uses a private CA, put its PEM certificate in `DB_SSL_CA`.

## 3. Environment variables

For local development, everything lives in one git-ignored file at the repository root: `cp .env.example .env`. Settings are read in this order, and the first one found wins:

1. Real environment variables (Render, CI, your shell).
2. `apps/bot/.env` or `apps/server/.env` (optional per-app overrides).
3. The root `.env`.

In production, set the variables in your host's dashboard instead. Because the bot and server can share a file, they use `BOT_PORT` and `SERVER_PORT`. Each falls back to `PORT`, which hosting platforms set per service.

### Web server (`apps/server`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | prod | `development` | `production` enables secure cookies, HSTS, static serving and the strict config checks |
| `SERVER_PORT` / `PORT` | | `3001` | Listen port (`SERVER_PORT` wins) |
| `PUBLIC_URL` | prod | `http://localhost:8080` in dev | The origin users open. Used for OAuth redirects and CSRF origin checks. In production it must start with `https://` (the session cookie is `Secure`); startup refuses anything else except `localhost`. |
| `ALLOWED_ORIGINS` | | — | Extra comma-separated origins allowed to make write requests |
| `SESSION_SECRET` | prod | random per run in dev | ≥ 32 characters. `openssl rand -base64 48` |
| `DISCORD_CLIENT_ID` | ✓ | — | Application ID |
| `DISCORD_CLIENT_SECRET` | ✓ | — | OAuth2 client secret |
| `DISCORD_REDIRECT_URI` | | `${PUBLIC_URL}/api/auth/callback` | Override only if it differs |
| `TRUST_PROXY` | | `1` in prod, `0` in dev | Proxies in front of the server: a hop count (`1`), `true`, `false` or a comma-separated subnet list. Anything else stops startup. Affects secure cookies and rate-limit IPs. In production an explicit `false` or `0` logs a warning, because behind a TLS proxy the session cookie is then never sent. |
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
| `BOT_PORT` / `PORT` | | Health endpoint port (default 3000; `BOT_PORT` wins) |
| `MIGRATE_ON_START` | | Default `true` |
| `DB_*` | ✓ | See below |

### Database (both apps)

| Variable | Default | Description |
|---|---|---|
| `DB_URL` | — | `postgresql://user:pass@host:port/db` (on Supabase, the session-pooler URL above). Takes precedence over the individual settings. |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | `localhost`, `5432`, `postgres`, empty, `taskquest` | Individual settings |
| `DB_SSL` | `false` | `true` to enable TLS (also for `DB_URL`) |
| `DB_SSL_REJECT_UNAUTHORIZED` | `true` | Verify certificates. Only disable for local testing. |
| `DB_SSL_CA` | — | PEM CA certificate contents |
| `DB_POOL_SIZE` | `10` | Connections per process |

### Game rules (both apps, optional)

| Variable | Description |
|---|---|
| `XP_WEEKLY_MODIFIER` | Set to `off` to turn the [weekly modifier](GAMEPLAY.md#5c-bonus-xp-sources) off (it doubles one flat bonus source each week). Default: on. |

### Web build (`apps/web`, optional; read from the root `.env`, only `VITE_*` reach the browser)

| Variable | Description |
|---|---|
| `VITE_API_URL` | Only for split deployments where the API is on another origin. Not recommended: third-party cookies are often blocked. |
| `VITE_DEV_API_TARGET` | Dev proxy target (default `http://localhost:3001`) |
| `VITE_BOT_INVITE_URL` | An `https://` Discord invite URL (scopes `bot applications.commands`) at build time; Settings then shows an "Add the bot" button. Without it there is no button. |

### AI service (`apps/ai`, optional)

Off by default. See [AI_INTEGRATION.md](AI_INTEGRATION.md) for the design and [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) for how it is built. The web service, the bot (for `/summary`, `/prioritize`, `/ask`, `/forget`, `/ai-format` and @mention chat) and the AI service read these:

| Variable | Where | Description |
|---|---|---|
| `AI_ENABLED` | web, bot | `true` turns the AI features on (default `false`). The UI hides every AI entry point while it is off, and the bot's AI commands answer "AI is off". |
| `AI_SERVICE_URL` | web, bot | Base URL of the AI service (`http://localhost:8000` locally; the private service host on Render) |
| `AI_INTERNAL_TOKEN` | web, bot, ai | Shared secret, **at least 32 characters**, identical everywhere. The web server refuses to start with `AI_ENABLED=true` and a short token, and the AI service refuses to start with a token of 1 to 31 characters. |
| `AI_TIMEOUT_MS` | web, bot | Per-request timeout for non-streaming calls (default `20000`) |
| `AI_STREAM_IDLE_MS` | web | A chat stream that sends nothing for this long is cut and the browser gets an error (default `90000`) |
| `AI_CHAT_MESSAGE_CONTENT` | bot | `true` also answers replies to the bot that have the ping turned off. This needs the privileged **Message Content** intent in the Discord Developer Portal (Bot → Privileged Gateway Intents), otherwise the bot fails to log in. Mentions and DMs work without it (default `false`). |
| `WEB_INTERNAL_URL` | ai | Base URL of the web service, used by chat tools to make confirmed changes (`/internal/*`) |
| `GEMINI_API_KEY` | ai | Google AI Studio key. Server-side only, never a `VITE_*` variable. |
| `GEMINI_CHAT_MODEL`, `GEMINI_REASONING_MODEL`, `GEMINI_EMBED_MODEL`, `EMBED_DIM` | ai | Model ids and embedding size (defaults: `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-embedding-001`, `768`). **Check them against Google's current model list.** Changing the embedding model re-embeds everything automatically (vectors are stored with the model name). |
| `AI_DAILY_REQUEST_LIMIT` | ai | Requests per user per day across all features (default `100`). A user's day is their own calendar day (`users.timezone`, UTC until they set one), so the quota refills at their local midnight |
| `AI_DB_USER` / `AI_DB_PASSWORD` | ai | Optional separate Postgres role for the AI service. Give it `SELECT` on the task tables and write access only to the `ai_*` tables (plus `USAGE` on the `ai_embeddings` id sequence). It never writes tasks directly. |
| `LANGSMITH_API_KEY` | ai | Optional tracing |
| `AI_RECONCILE_MINUTES` | ai | How often missed re-index calls are caught up (default `15`) |
| `SUMMARY_MAP_REDUCE_CHARS` | ai | Summaries are made in parts above this input size (default `40000`) |
| `MAX_TOOL_ITERATIONS` | ai | Tool rounds per chat turn (default `6`) |
| `DB_POOL_SIZE` | ai | The AI service's own Postgres pool (SQLAlchemy + asyncpg; default `5`; the Node apps default to `10`) |
| `LOG_LEVEL` | ai | AI service JSON log level (default `INFO`) |

The AI service reads the same root `.env` as the other apps, plus the database variables above. It builds a `postgresql+asyncpg://` URL from them and needs the `ai_*` tables of `001_baseline`, which the web service and the bot apply on startup. The AI service never runs DDL.

**Local run**

```bash
npm run dev                                   # web + server
cd apps/ai
python -m venv .venv && .venv/Scripts/activate   # Linux/macOS: source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
python -m app.rag.index_docs                  # once: embed the help docs
python -m app.rag.backfill                    # once: embed existing quests
```

Set `AI_ENABLED=true`, `AI_INTERNAL_TOKEN`, `GEMINI_API_KEY` in `.env`, then open `/api/ai/ping` while logged in.

### Web push (optional)

Browser notifications for reminders, **off unless all three VAPID values are set** (set one or two and the server refuses to start). Generate a key pair once with `npx web-push generate-vapid-keys` and keep the private key secret. The bot owns the reminder job, so it asks the web server to send the push (the server holds the keys); the push is best effort and never delays or replaces the Discord DM.

| Variable | Where | Description |
|---|---|---|
| `WEB_PUSH_PUBLIC_KEY` | web | VAPID public key (base64url, about 87 characters). Sent to browsers, so it is safe to expose. |
| `WEB_PUSH_PRIVATE_KEY` | web | VAPID private key (about 43 characters). Server-side only, never a `VITE_*` variable. |
| `WEB_PUSH_SUBJECT` | web | Contact for the push services: `mailto:you@example.com` or an `https://` URL |
| `WEB_PUSH_ALLOWED_HOSTS` | web | Optional. Extra host suffixes (comma separated, e.g. `push.example.com`) a push endpoint may use. By default only the browsers' own push services are accepted (`fcm.googleapis.com`, `push.services.mozilla.com` and subdomains, `notify.windows.com`, `push.apple.com` and `web.push.apple.com`), on port 443, because the server sends to the endpoint a browser hands it. |
| `WEB_PUSH_INTERNAL_URL` | bot | Base URL of the web service (`http://localhost:3001`; the private host on Render). Without it the bot never pushes. |
| `WEB_PUSH_INTERNAL_TOKEN` | web, bot | Shared secret, **at least 32 characters**, identical on both. Optional: it falls back to `AI_INTERNAL_TOKEN`, so with the AI token already shared you only need `WEB_PUSH_INTERNAL_URL`. Sent as the `X-AI-Token` header of `POST /internal/push` and checked in constant time. |
| `WEB_PUSH_TIMEOUT_MS` | bot | How long the bot waits for the web server per push (default `5000`) |

Users then turn it on per browser under **Settings → Push notifications**. The service worker (`/sw.js`) is only registered at that point, shows the notification, opens the right page on click and caches nothing. Push needs HTTPS (or `localhost`). Subscriptions are stored in `push_subscriptions`; dead ones are removed when the push service answers 404 or 410.

## 4. Deploying on Render

The repository includes [`render.yaml`](../render.yaml).

1. Push the repository to GitHub. In Render, choose **New → Blueprint** and select the repository.
2. Fill in the prompted secrets:
   - In the `taskquest-database` group: `DB_URL` (the Supabase session-pooler URL, see §2), plus `DB_SSL_CA` if you pin the CA.
   - On `taskquest-web`: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `PUBLIC_URL`.
   - On `taskquest-bot`: `DISCORD_TOKEN`, `CLIENT_ID` and `WEB_APP_URL`.
   - `SESSION_SECRET` is generated for you.
3. After the first deploy, set `PUBLIC_URL` to the web service URL (or your custom domain). Add `<PUBLIC_URL>/api/auth/callback` to Discord's OAuth2 redirects.
4. Register slash commands from your machine (see §1).

**Notes:**

- The web service builds with `npm ci --include=dev && npm run build`, because dev dependencies are needed to build the SPA.
- Render background workers need a paid plan. The bot also exposes a health endpoint on `$PORT`, so it can run as a free **web** service, but free services sleep when idle, which disconnects the bot. Use a paid worker for reliability.
- **Archive job.** `render.yaml` also defines a weekly cron job `taskquest-archive` (a paid plan) that runs `npm run archive -- --days 365` against the same database. It only moves old `xp_transactions` rows to the archive table; take the usual backup first and remove the job from the blueprint if you do not want it.
- **AI service.** `render.yaml` also defines a private service `taskquest-ai` (a paid plan) and a `taskquest-ai` env group holding a generated `AI_INTERNAL_TOKEN`, shared with the web service and the bot. To enable AI: set `GEMINI_API_KEY` and `WEB_INTERNAL_URL` on `taskquest-ai`, set `AI_SERVICE_URL` (its internal host) on `taskquest-web` and `taskquest-bot`, then flip `AI_ENABLED` to `true` on both. Re-register slash commands (`npm run deploy:commands`) so `/summary`, `/prioritize` and `/ask` appear. Its build command embeds the help docs; that step is skipped, not failed, if the database or key is unavailable at build time.
- The first AI request after a free web instance wakes can take 10 to 30 seconds. The UI shows a "waking up" message after 5 seconds.
- Health checks: the web service uses `GET /api/health`. The bot's `GET /` returns 200 once it is connected to Discord.

## 5. Deploying elsewhere

Any Node 22 host works, including Railway, Fly.io, a VPS with systemd or PM2, and Docker.

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
2. **Start on a new database.** The old repositories used MySQL. The in-place upgrade of a 3.x MySQL database (the MySQL-era `002_upgrade_legacy` migration) was removed with the move to PostgreSQL, so the current release cannot open an old database. Create a Postgres database (§2) and let the apps migrate it; players link again on their first bot command or web login. Keep a `mysqldump` of the old database if you want an archive.
3. **Replace the two old services** with the two from `render.yaml`. The web app is now served by the API itself:
   - Delete the old static site.
   - Point your domain at `taskquest-web`.
   - Update the Discord OAuth redirect to `<PUBLIC_URL>/api/auth/callback`.
4. **Re-run `deploy:commands`.** The `/list` command definition changed (its `name` option now has a length limit).

Behaviour changes players may notice are listed in [CHANGELOG.md](../CHANGELOG.md#400---2026-10-08).

**Moving a MySQL-era deployment (TiDB) to PostgreSQL**: follow the cutover runbook in [MIGRATION_POSTGRES.md](MIGRATION_POSTGRES.md#cutover-runbook). The Supabase database starts empty (no rows are copied), so it is a configuration switch: set `DB_URL` and `DB_SSL=true`, deploy, and the first service to start runs `001_baseline`. Then re-run `npm run deploy:commands` if the release added commands. The checklist is in the [CHANGELOG upgrade notes](../CHANGELOG.md#unreleased).

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
