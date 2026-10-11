# @taskquest/web

The TaskQuest web app: React 18, TypeScript, Vite, Tailwind CSS 4 (configured in CSS, in `src/index.css`), shadcn/ui and TanStack Query.

In development, Vite runs on <http://localhost:8080> and proxies `/api` to the Express server
([`apps/server`](../server)) on port 3001. In production, the server serves `dist/` itself, so the
app and the API share one origin.

```bash
npm run dev         # needs apps/server running (npm run dev:server from the repo root)
npm run build       # outputs dist/
npm run lint
npm run typecheck
npm test            # Vitest unit tests for the pure logic in src/lib
npm run e2e         # Playwright smoke tests (seeds a throwaway database; see CONTRIBUTING.md)
```

| Path | Purpose |
|---|---|
| `src/lib/api.ts` | Typed API client |
| `src/hooks/useApi.ts` | React Query hooks and toast notifications |
| `src/contexts/AuthContext.tsx` / `src/components/AuthGate.tsx` | Session state and login screen |
| `src/pages/*` | Dashboard, Tasks, Games, Classes, Skills, Shop, Achievements, Leaderboard, Focus, Stats, Weekly review, Party, Chat, Profile, Settings |

The API is documented in [docs/API.md](../../docs/API.md).
