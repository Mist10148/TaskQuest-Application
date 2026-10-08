# TaskQuest Architecture

How the TaskQuest web app is put together: the frontend providers and routing, data fetching, the design system, the backend modules, and the request flow for an XP-earning action.

Read [README.md](../README.md) first for setup. Read [API.md](API.md) for endpoint contracts and [GAME_MECHANICS.md](GAME_MECHANICS.md) for the rules that the server applies.

---

## Contents

1. [System overview](#1-system-overview)
2. [Frontend](#2-frontend)
3. [Backend](#3-backend)
4. [Request lifecycle: completing a task](#4-request-lifecycle-completing-a-task)
5. [Design system](#5-design-system)
6. [Build and tooling](#6-build-and-tooling)
7. [Architectural debt](#7-architectural-debt)

---

## 1. System overview

```
┌────────────────────────── Browser ──────────────────────────┐
│  React 18 SPA (Vite build)                                   │
│  App.tsx ─ providers ─ routes ─ pages ─ DashboardLayout      │
│     │                                                        │
│  AuthContext ── useApi.ts (react-query) ── lib/api.ts        │
└─────┬───────────────────────────────────────────────────────┘
      │ HTTPS, JSON, session cookie (credentials: include)
┌─────▼─────────────── Express API (Node ≥ 18) ───────────────┐
│  index.js      routes, CORS, sessions, OAuth, game results   │
│  gameLogic.js  class XP rules, skill bonuses, calculateFinalXP│
│  gameData.js   static definitions (classes, skills, achievements)│
│  db.js         mysql2 pool, SQL, ledger, daily claim, reset  │
└─────┬───────────────────────────────────────────────────────┘
      │ mysql2 pool
┌─────▼──────────────── MySQL (shared with Discord bot) ──────┐
│  users · lists · items · user_skills · achievements          │
│  game_sessions · xp_transactions                             │
└──────────────────────────────────────────────────────────────┘
```

The browser never talks to MySQL. The API is the only writer, and all XP and class logic runs server-side. The frontend's job is presentation and optimistic messaging, with two exceptions described below that matter for correctness.

---

## 2. Frontend

### 2.1 Provider tree

`src/App.tsx` mounts providers in this order (outermost first):

| Provider | Purpose |
|---|---|
| `QueryClientProvider` | react-query client. Default `staleTime` 60 s, `retry` 1. |
| `AuthProvider` | Session user, demo-mode flag, login and logout actions. See [2.3](#23-authentication-and-demo-mode). |
| `TooltipProvider` | Radix tooltip context. |
| `Toaster` (shadcn) | Mounted, but the app's toasts use sonner (see [7](#7-architectural-debt)). |
| `Sonner` | Toast renderer used by all `showXPNotification`-style helpers. |
| `BrowserRouter` | Client-side routing. |

### 2.2 Routes

Every route except `NotFound` renders its page inside `DashboardLayout`. The layout is per page, not a route-level layout, so the sidebar remounts on each navigation.

| Path | Page | Notes |
|---|---|---|
| `/` and `/app` | redirect to `/dashboard` | |
| `/dashboard` | `Dashboard` | Daily claim, stats, recent lists. |
| `/tasks` | `Tasks` | Quest log and quest detail. |
| `/games` | `Games` | Game hub and the six mini-games. |
| `/classes` | `Classes` | Buy and equip classes. |
| `/skills` | `Skills` | Skill trees per class. |
| `/achievements` | `Achievements` | Achievement grid by category. |
| `/leaderboard` | `Leaderboard` | Public top 10. |
| `/profile` | `Profile` | Account stats. |
| `/settings` | `Settings` | Toggles, reset, logout. |
| `*` | `NotFound` | No layout. |

⚠️ **No route is protected.** There is no guard component. `useRequireAuth()` exists in `AuthContext.tsx` but nothing calls it, and its comment says it no longer redirects. An unauthenticated visitor sees the full app, populated with demo data.

⚠️ The quest detail view in `Tasks` is not a URL. The selected list lives in component state, so the browser Back button leaves `/tasks` and a refresh loses the selection.

### 2.3 Authentication and demo mode

`AuthContext` (`src/contexts/AuthContext.tsx`) is the only source of the session user.

1. On mount it calls `GET /api/auth/me`.
2. If that succeeds and the response includes `discord`, it also calls `GET /api/user` and merges the two into `user`. If the second call fails, it keeps the first result.
3. **If `/api/auth/me` fails for any reason**, the context substitutes `MOCK_USER` (a fictional player named QuestMaster, level 12, class HERO) and sets `useMock = true`.

Exposed values: `user`, `discord`, `isLoading`, `isAuthenticated`, `error` (never populated), `login`, `logout`, `refresh`, `useMock`.

- `login()` navigates the browser to `${API_BASE}/api/auth/discord`.
- `logout()` posts to `/api/auth/logout`, ignores failures, then resets to `MOCK_USER`. It does not redirect.
- `getAvatarUrl(discordId, avatar, size)` builds the Discord CDN URL, using `.gif` for animated hashes and falling back to a default avatar.

When `useMock` is true, the sidebar shows a "Login with Discord" button and the Dashboard shows a "Demo mode" notice.

⚠️ **Consequence:** a real outage, a misconfigured `VITE_API_URL`, or a logged-out visitor all look like a working app with a fake player. This is the most important frontend behaviour to know. See [7](#7-architectural-debt).

### 2.4 Server state: `hooks/useApi.ts`

All server data is read and written through react-query hooks. Query keys:

| Key | Hook | Endpoint |
|---|---|---|
| `['user']` | `useUser` | `GET /api/user` |
| `['lists']` | `useLists` | `GET /api/lists` |
| `['lists', id]` | `useList` | `GET /api/lists/:id` |
| `['classes']` | `useClasses` | `GET /api/classes` |
| `['skills']` | `useSkills` | `GET /api/skills` |
| `['achievements']` | `useAchievements` | `GET /api/achievements` |
| `['leaderboard']` | `useLeaderboard` | `GET /api/leaderboard` |
| `['games', 'history']` | `useGameHistory` | `GET /api/games/history` |

Mutations: `useClaimDaily`, `useUpdateSettings`, `useResetProgress`, `useCreateList`, `useUpdateList`, `useDeleteList`, `useCreateItem`, `useUpdateItem`, `useDeleteItem`, `useToggleItem`, `useBuyClass`, `useEquipClass`, `useUnlockSkill`, `useRecordGame`.

Each hook wraps its API call in `try/catch`. **On failure it returns in-memory mock data instead of throwing**, and mutations edit module-level mock arrays (`MOCK_LISTS`, `MOCK_ITEMS`, `MOCK_CLASSES`). Practical effects:

- The `onError` branches in pages are effectively unreachable, because errors never propagate.
- Writes made while the API is down appear to succeed and are lost on reload.
- A user cannot tell from the UI that the server rejected an action.

The XP toast helpers (`showXPNotification`, `showGameXPNotification`, `showAchievementNotifications`) live here and use sonner. They read `xpResult` and `newAchievements` from the server response.

### 2.5 API client: `lib/api.ts`

- `API_BASE` is `import.meta.env.VITE_API_URL`, falling back to `http://localhost:3001`.
- `apiFetch(path, options)` sends JSON with `credentials: 'include'` and throws `Error(body.error)` for non-2xx responses.
- Endpoint groups: `authApi`, `userApi`, `listsApi`, `classesApi`, `skillsApi`, `achievementsApi`, `leaderboardApi`, `gamesApi`, and `xpApi`. `xpApi.getHistory` is defined but unused.
- TypeScript types for responses are declared here. Many runtime shapes (especially mocks) do not match them, because pages use `any` (see [7](#7-architectural-debt)).

### 2.6 Layout: `DashboardLayout`

- **Desktop (`lg` and up):** a sticky 256–288 px sidebar with the logo, the user card (avatar, name, class badge, level, streak), navigation, and a footer with Settings and Logout.
- **Below `lg`:** the sidebar becomes a slide-in drawer opened by a fixed hamburger button. An overlay closes it.
- The active nav item is matched by exact pathname.
- The "Login with Discord" button in the sidebar appears only in demo mode.
- `components/NavLink.tsx` is an unused wrapper.

### 2.7 State in pages

Pages keep local UI state with `useState` (filters, dialogs, drag state, selected list). The `Tasks` page has about 25 such values, and it is the most complex page. There is no global client store beyond react-query and `AuthContext`.

### 2.8 Games page

`src/pages/Games.tsx` is about 1,600 lines and holds all six mini-games as internal components (`BlackjackGame`, `RPSGame`, `HangmanGame`, `SnakeGame`, `DinoGame`, `SpaceInvadersGame`) plus shared pieces (`NeonNumberInput`, `PlayingCard`, `GameInstructions`, `HangmanFigure`). Each game:

1. Runs entirely in the browser, with its own loop (`setInterval` or event-driven).
2. Computes a result, payout and XP delta locally.
3. Posts `{gameType, result, bet, payout}` to `POST /api/games/result`.
4. Calls `refresh()` on `AuthContext` so the balance updates.

The client computes the payout. The server trusts it. See [GAME_MECHANICS.md §8](GAME_MECHANICS.md#8-mini-games).

### 2.9 Component inventory

**Domain components (`src/components/game/`):**

| Component | Purpose |
|---|---|
| `XPProgressBar` | Level progress bar with shimmer and a gold gradient. Props: `currentXP`, `xpToNextLevel`, `level`, `size`. |
| `StatCard` | Metric tile with icon, value, optional trend and colour scheme. |
| `ClassBadge` | Class emoji and name badge. Also exports `getClassConfig`. |
| `TaskComponents` | `TaskItem` (checkbox, priority dot, drag handle, hover actions) and `TaskListCard` (category, priority, progress, deadline). |
| `AchievementBadge` | ⚠️ Unused. The Achievements page renders its own cards. |

**Layout:** `DashboardLayout`.

**Primitives (`src/components/ui/`):** 50 shadcn/ui components generated into the repo. Pages use only a small subset (button, input, textarea, select, dropdown-menu, dialog, alert-dialog, switch, sonner, tooltip). The rest are available but unused.

**Button variants** (`ui/button.tsx`): `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`, `discord`, `xp`, `success`, `hero`, `glass`, `glow`. Sizes: `default`, `sm`, `lg`, `xl`, `icon`.

**Hooks:** `use-toast.ts` (shadcn, unused by pages), `use-mobile.tsx` (used by the sidebar primitive only).

---

## 3. Backend

The backend is one Express app split across four files.

| File | Lines | Responsibility |
|---|---|---|
| `server/index.js` | ~935 | Middleware (CORS, JSON, sessions), `requireAuth`, Discord OAuth, every route handler, static serving in production, server start. |
| `server/db.js` | ~536 | `mysql2/promise` pool, every SQL statement, XP ledger (`addXPTransaction`), daily claim, achievements, game recording, reset. Exports `getPool`, plus named query functions. |
| `server/gameLogic.js` | ~275 | Pure functions: `calculateClassXP`, `getSkillBonuses`, `calculateFinalXP`. No I/O, so these are the easiest functions to unit test. |
| `server/gameData.js` | ~478 | Static data: `CLASSES`, `SKILL_TREES`, `ACHIEVEMENTS`, `HANGMAN_WORDS`, `BLACKJACK_CONFIG`. |

### 3.1 Middleware order (`index.js`)

1. `app.set('trust proxy', 1)`
2. `cors({ origin: FRONTEND_URL, credentials: true })`
3. `express.json()`
4. `express-session` (7-day cookie, `secure` and `sameSite=none` in production, MemoryStore)
5. Routes
6. In production only: `express.static(../dist)` and a catch-all that serves `index.html` for non-`/api` paths

There is no error-handling middleware, no rate limiter, no helmet and no request logging beyond `console.log` in some handlers.

### 3.2 Achievements check

`checkAndUnlockAchievements(discordId)` in `index.js` loads the user and existing achievements, runs `checkAchievements` from `gameData.js`, and inserts new ones with `INSERT IGNORE`. It catches its own errors and returns `[]`, so a failed check never fails the request that triggered it.

### 3.3 Database layer

- `mysql.createPool` is built from `DB_URL` when set, or from `DB_*` variables otherwise. SSL is enabled by `DB_SSL=true`.
- Queries use `execute` with `?` placeholders. Dynamic `UPDATE` statements build column names from object keys. The keys are server-controlled today, which makes this safe for now.
- There are no transactions. Read-modify-write sequences (XP, class purchases) are not atomic. See [7](#7-architectural-debt).

---

## 4. Request lifecycle: completing a task

A representative XP flow, from a click to a toast.

```
Browser                          Express (index.js)              db.js / gameLogic.js
───────                          ──────────────────              ────────────────────
click checkbox
  └─ useToggleItem.mutate ──►  PATCH /api/items/:id/toggle
                                 requireAuth                     
                                 toggleItemComplete(id, discordId) ─► read item, flip completed,
                                                                      UPDATE items, +1 total_items_completed
                                 if now completed:
                                   getUser, getUserSkills
                                   calculateFinalXP(user, skills, 10) ─► classXP, skill mult, crit
                                   addXPTransaction(finalXP,'task_complete') ─► read balance,
                                                                      clamp ≥ 0, write player_xp & level,
                                                                      insert xp_transactions
                                   updateUser(userUpdates)  ─► class counters
                                   checkAndUnlockAchievements
                                 respond { ...item, xpResult, newAchievements }
  ◄── 200 ────────────────────
onSuccess: invalidate ['lists']
  └─ showXPNotification(xpResult)
  └─ showAchievementNotifications(newAchievements)
```

Notes:

- The client does not compute XP. It only displays what the server returned.
- Toggling off does not reverse XP, and toggling on again awards XP again. See [SECURITY.md](../SECURITY.md#xp-farming).
- The item endpoints do not check that the item belongs to the caller. See [SECURITY.md](../SECURITY.md#item-ownership).

---

## 5. Design system

### 5.1 Theme

A single dark theme. There is no light theme and no theme toggle, even though `tailwind.config.ts` sets `darkMode: ["class"]`.

Core tokens are HSL CSS variables on `:root` in `src/index.css`:

| Token | Value | Use |
|---|---|---|
| `--background` | `215 28% 7%` | Page background |
| `--secondary`, `--tertiary` | `215 25% 10%`, `215 22% 13%` | Surfaces |
| `--card` | `215 22% 13%` | Cards |
| `--foreground` | `210 40% 96%` | Text |
| `--foreground-muted` | `215 20% 65%` | Secondary text |
| `--primary` | `235 86% 65%` | Discord blurple, the main accent (with a glow variant) |
| `--xp` | `45 100% 50%` | Gold, XP and rewards |
| `--success` | `145 65% 59%` | Positive states |
| `--destructive` | `0 84% 60%` | Errors and destructive actions |
| `--border`, `--input` | `215 20% 20%` | Borders |
| `--radius` | `0.75rem` | Corner radius |

Domain tokens also exist for class colours (`--class-*`), priority (`--priority-*`), categories (`--category-*`) and the sidebar.

⚠️ Several pages hardcode colours that differ from these tokens. `Classes.tsx`, `Skills.tsx` and `Profile.tsx` each keep their own class colour map, for example Assassin is `#2C3E50` in all three. Some components use raw Tailwind palette names (`red-500`) for priority.

### 5.2 Typography

- **Headings:** Rajdhani (`font-heading`), with `h1`–`h6` set to `font-semibold tracking-wide`.
- **Body:** Inter (`font-body`).
- Both come from `@fontsource`, so they ship with the bundle and do not load from a CDN.

### 5.3 Utilities in `index.css`

- **Glows:** `.glow-primary`, `.glow-xp`, `.glow-success`, `.neon-*`, `.text-glow-*`
- **Gradients:** `.gradient-hero`, `.gradient-card`, `.gradient-xp-bar`, `.gradient-primary`, `.gradient-text-primary`
- **Surfaces:** `.glass`, `.glow-card`, `.animated-border`
- **Backgrounds:** `.cyber-grid`, `.scanlines`
- **Animation:** `.shimmer`, `.glow-pulse`, `.xp-glow-pulse`, `.float`, `.fade-in`, `.stagger-children`, `.level-up-burst`, `.achievement-unlock`
- **Components:** `.rank-gold`, `.rank-silver`, `.rank-bronze`, `.class-card`, `.skill-node.*`, `.achievement-badge.*`, `.progress-bar-*`
- **Scrollbar:** an 8 px custom scrollbar.

Most of these are unused. Pages mostly use inline Tailwind arbitrary values such as `shadow-[0_0_20px_rgba(...)]`. Some keyframes are duplicated: `@keyframes spin` clashes with Tailwind's own, and `pulse-glow` is defined in both `index.css` and `tailwind.config.ts` with different colours.

### 5.4 Motion

Framer Motion fades and slides most blocks in, with staggered delays. There is **no `prefers-reduced-motion` handling**.

### 5.5 Dead styles

`src/App.css` is Vite template CSS (a centred `#root` with a 1280 px max-width). It is not imported anywhere, so it has no effect. Delete it rather than importing it, because importing it would break the layout.

---

## 6. Build and tooling

| Concern | Setup |
|---|---|
| Bundler | Vite 5, with `@vitejs/plugin-react-swc`. |
| Dev server | Port 8080, bound to `::`. |
| Path alias | `@` maps to `./src`. |
| Dev-only plugin | `lovable-tagger`'s `componentTagger`, enabled only in development mode. It is a Lovable.dev leftover. |
| Styling | Tailwind 3 with `tailwindcss-animate` and `@tailwindcss/typography`. PostCSS with Autoprefixer. |
| TypeScript | Split configs: `tsconfig.app.json` (browser code) and `tsconfig.node.json` (Vite config). |
| Lint | ESLint 9 flat config with `typescript-eslint`. Run with `npm run lint`. |
| Tests | None. |
| Backend tooling | None beyond `node --watch` for dev. There is no TypeScript or bundling on the server. |

Production frontend output is `dist/`. In production the Express server also serves `dist/` directly, but `render.yaml` does not build it (see [README.md](../README.md#deployment-render)).

---

## 7. Architectural debt

These items are listed in priority order. Each has a corresponding entry in [PRD.md](PRD.md#11-known-gaps-and-roadmap).

1. **Demo-mode fallback hides failures.** Auth, queries and mutations all fall back to mock data. Users cannot tell an outage from a working app, and writes during an outage are silently lost. The fix is to surface errors, and to show a dedicated logged-out state instead of `MOCK_USER`.
2. **No route protection.** Any URL is reachable without login.
3. **The server trusts the client on games.** `POST /api/games/result` accepts any payout. The server should derive or validate results.
4. **No authorisation on items.** The item routes never check that the item belongs to the caller.
5. **No transactions.** XP and purchase updates are read-modify-write without locks, which allows double spending and double daily claims.
6. **Schema is not in this repo.** There are no migrations and no DDL, so a fresh database cannot be created from the repository.
7. **Duplicate definitions.** `gameData.js` and `gameLogic.js` both define class data, and the frontend has its own copies of classes, skills and achievements in `useApi.ts` and the pages. Drift is already visible (see [GAME_MECHANICS.md §10](GAME_MECHANICS.md#10-known-discrepancies)).
8. **Loose typing.** Pages use `any` for user, list and item types. The mock shapes do not match the declared types. Some mocks reference fields that do not exist in the real responses.
9. **Two toast systems.** Shadcn `Toaster` and `sonner` are both mounted, but only sonner is used.
10. **Dead code.** `App.css`, `NavLink.tsx`, `AchievementBadge.tsx`, `useRequireAuth`, `useUser`, `xpApi.getHistory`, and much of the custom CSS are unused. The leaderboard mock returns an object where the page expects an array.
11. **Dynamic Tailwind class names.** `Profile.tsx` builds classes with template strings (`` `bg-${color}-500/20` ``). Tailwind's JIT cannot detect these, so they are missing from production CSS.
12. **Hardcoded game and level constants.** The level size of 100 XP is written into `Dashboard.tsx` and `Profile.tsx`. The bet limits in `BLACKJACK_CONFIG` are not enforced by the server.
13. **Canvas sizing.** Dino Runner (600 px) and Space Invaders (500 px) overflow narrow screens. Game loops run on `setInterval` rather than `requestAnimationFrame`.
14. **Session storage.** In-memory sessions do not survive a restart, which matters on Render's free plan.
15. **Accessibility.** Many icon-only buttons have no accessible name. Card-style clickable `div`s are not focusable. Drag-and-drop reordering has no keyboard alternative. Some controls rely on colour alone.
