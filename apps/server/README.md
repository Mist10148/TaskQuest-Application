# @taskquest/server

The Express API for the TaskQuest web app. It handles Discord OAuth2 login and database-backed sessions, and serves
the built web app in production.

```bash
# configure the shared root .env (cp ../../.env.example ../../.env)
npm run dev             # http://localhost:3001
npm test                # integration tests need TEST_DB_NAME (see CONTRIBUTING.md)
```

| Path | Purpose |
|---|---|
| `index.js` | Startup: config validation, migrations, graceful shutdown |
| `app.js` | Express app factory and route mounting |
| `config.js` | Environment parsing and validation |
| `lib/security.js` | helmet/CSP, rate limits, CSRF origin check, session middleware |
| `lib/sessionStore.js` | `DbSessionStore`, the express-session store on the `web_sessions` table (Postgres) |
| `lib/schemas.js` | zod request schemas |
| `lib/push.js`, `lib/pushConfig.js` | Web push sending and the optional VAPID configuration |
| `lib/aiClient.js`, `lib/http.js` | The AI service client and shared HTTP helpers |
| `routes/*` | auth, user, tasks, sharing (list members and invitations), parties, templates, import, progression (classes, skills, achievements, leaderboard), quests, cosmetics, focus, review, stats, push, calendar, games, ai, internal |

See [docs/API.md](../../docs/API.md) and [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md).
