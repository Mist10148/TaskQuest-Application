# @taskquest/server

The Express API for the TaskQuest web app. It handles Discord OAuth2 login and MySQL-backed sessions, and serves
the built web app in production.

```bash
cp .env.example .env    # DISCORD_CLIENT_ID/SECRET, SESSION_SECRET, database
npm run dev             # http://localhost:3001
npm test                # integration tests need TEST_DB_NAME (see CONTRIBUTING.md)
```

| Path | Purpose |
|---|---|
| `index.js` | Startup: config validation, migrations, graceful shutdown |
| `app.js` | Express app factory and route mounting |
| `config.js` | Environment parsing and validation |
| `lib/security.js` | helmet/CSP, rate limits, CSRF origin check, session middleware |
| `lib/sessionStore.js` | express-session store on the `web_sessions` table |
| `lib/schemas.js` | zod request schemas |
| `routes/*` | auth, user, tasks, progression, games |

See [docs/API.md](../../docs/API.md) and [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md).
