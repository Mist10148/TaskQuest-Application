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
npm test            # Vitest unit and component tests (*.test.ts / *.test.tsx next to the code; jsdom + Testing Library)
npm run e2e         # Playwright smoke tests (seeds a throwaway database; see CONTRIBUTING.md)
```

| Path | Purpose |
|---|---|
| `src/lib/api.ts` | Typed API client |
| `src/hooks/useApi.ts` | React Query hooks and toast notifications |
| `src/contexts/AuthContext.tsx` / `src/components/AuthGate.tsx` | Session state and login screen |
| `src/pages/*` | Today, Dashboard, Tasks, Games, Classes, Skills, Shop, Achievements, Leaderboard, Focus, Stats, Weekly review, Party, Chat, Profile, Settings, NotFound (404) |

The API is documented in [docs/API.md](../../docs/API.md).

## How the app is organised

- **Data.** Every server call goes through the typed client in `src/lib/api.ts`. React Query hooks in `src/hooks/useApi.ts` wrap it, own the cache keys, show the toasts and do the optimistic updates (reorder; see `useReorderItems` for the pattern: cancel, snapshot, patch, roll back on error, invalidate). The query client defaults are in `src/App.tsx` (one-minute `staleTime`, a global query and mutation error handler).
- **Rules are not duplicated.** XP, dates and validation come from `@taskquest/shared`; the web app never computes a reward, it shows what the server returned. Day-based logic uses the user's own day (`localToday()` in `src/lib/dates.ts`), not UTC.
- **State.** Server state lives in React Query. Per-device preferences (theme, text size, contrast) are in `src/contexts/PreferencesContext.tsx` and `localStorage`, always wrapped in try/catch.
- **Keyboard.** `src/hooks/useHotkeys.ts` owns the global shortcuts and skips them while a dialog or text field has focus. The list of shortcuts shown to users is `ShortcutsDialog.tsx`; keep the two in sync.
- **i18n.** `src/i18n/messages.ts` is the catalog (`en` is the source and the fallback); use `useT()` for text. Most pages are still hard-coded English, so convert a page at a time and add its keys to the catalog in the same commit.
- **Styling.** Tailwind 4 configured in `src/index.css`. Colours are tokens (`--foreground-muted`, `--success`, ...); `src/lib/theme.test.ts` checks the WCAG contrast of the tokens in both themes, so add a token there when you add a text colour. Use `rem`-based text sizes so the Text size setting scales them.
- **Accessibility.** Controls need an accessible name that says the current state, not just the action; live regions use `aria-live="polite"`.

## Tests

- `*.test.ts(x)` next to the code run in Vitest (jsdom, Testing Library; setup in `src/test/setup.ts`).
- `e2e/*.e2e.ts` run in Playwright against the built app. `e2e/seed.mjs` resets `taskquest_e2e`, creates a player and writes a signed session row; `e2e/helpers.ts` holds the signed-cookie helpers (`playerContext`, `signedSessionCookie`, `unique`). Run `npm run build` first. Details: [docs/TESTING.md](../../docs/TESTING.md).

