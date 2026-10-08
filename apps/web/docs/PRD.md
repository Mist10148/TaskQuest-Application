# TaskQuest Web: Product Requirements Document

| | |
|---|---|
| **Product** | TaskQuest Web |
| **Version covered** | v1.5 (as implemented in this repository) |
| **Status** | Pre-production. Core features are built. Security and integrity work is outstanding. |
| **Document type** | Retrospective PRD. It records what v1.5 does, the intent behind it, and what is still open. |
| **Related** | [README](../README.md), [GAME_MECHANICS](GAME_MECHANICS.md), [API](API.md), [ARCHITECTURE](ARCHITECTURE.md), [SECURITY](../SECURITY.md) |

Requirement status legend: **Implemented** (works as described), **Partial** (works with a noted gap), **Planned** (described but not built).

---

## Contents

1. [Summary](#1-summary)
2. [Problem and opportunity](#2-problem-and-opportunity)
3. [Goals and non-goals](#3-goals-and-non-goals)
4. [Personas](#4-personas)
5. [User stories and acceptance criteria](#5-user-stories-and-acceptance-criteria)
6. [Functional requirements](#6-functional-requirements)
7. [Non-functional requirements](#7-non-functional-requirements)
8. [Data and integrations](#8-data-and-integrations)
9. [Success metrics](#9-success-metrics)
10. [Release scope: v1.5](#10-release-scope-v15)
11. [Known gaps and roadmap](#11-known-gaps-and-roadmap)
12. [Risks and assumptions](#12-risks-and-assumptions)
13. [Open questions](#13-open-questions)
14. [Glossary](#14-glossary)

---

## 1. Summary

TaskQuest turns everyday to-do lists into an RPG-style progression. People create quest lists, add tasks, and complete them. Every meaningful action earns XP. XP drives levels, a daily reward streak, character classes that change how XP is earned, skill trees, achievements, and a small set of mini-games where XP can be wagered.

Sign-in uses Discord, and the web app shares its database with a TaskQuest Discord bot. Progress made in the bot shows up on the web and the reverse.

---

## 2. Problem and opportunity

Task managers are effective but dull. Motivation fades once the novelty of checking boxes wears off. Gamification is a common answer, but many implementations are shallow: a points counter with no consequence.

TaskQuest aims for mechanics with real trade-offs. Classes change the shape of XP gain (steady, random, streak-based, cyclic, or stacking). Skills reward commitment to one path. Spending XP on classes, skills or bets means progress is not only accumulated but chosen.

The Discord integration targets communities that already live in Discord. People can manage tasks where they already talk, and use the web app for a fuller view.

---

## 3. Goals and non-goals

### Goals (v1.5)
- **G1.** Let a user create, organise and complete tasks in quest lists with categories, priorities and deadlines.
- **G2.** Make every completion feel rewarding through immediate XP feedback, a level, and visible progress.
- **G3.** Offer strategic choice through classes and skills that change how XP is earned.
- **G4.** Keep the user returning through a daily reward with streaks, and achievements for milestones.
- **G5.** Provide light entertainment through mini-games where a stake can be wagered.
- **G6.** Share identity and progress with the Discord bot, so one account spans both products.

### Non-goals (v1.5)
- **NG1.** Team or shared lists, and collaboration between users.
- **NG2.** Real-money or any currency that converts to money. XP has no cash value.
- **NG3.** Native mobile apps. The web app is responsive but not an app store product.
- **NG4.** Notifications, reminders and automations. Settings exist for these, but no behaviour is implemented.
- **NG5.** Internationalisation. The UI is English only.
- **NG6.** A light theme or user-selectable themes.

---

## 4. Personas

**P1. The Habit Builder.** A student or professional who wants a daily routine to stick. They care about streaks, daily rewards and a sense of progress. They rarely touch the mini-games.

**P2. The Min-Maxer.** A player who enjoys systems. They read the class and skill rules, plan a build, and want the numbers to be exact and transparent.

**P3. The Discord Regular.** Someone who already uses the TaskQuest bot in their server. They want the web dashboard for a bigger view, and expect the same account and progress.

**P4. The Casual Gambler.** Someone who enjoys a bet for fun. They want quick games with clear odds and small stakes.

**P5. The Operator.** The person who deploys and maintains the app. They need clear configuration, a working deployment on Render, and a clear view of known risks.

---

## 5. User stories and acceptance criteria

Stories are grouped by epic. Each has acceptance criteria (AC). Status refers to the functional requirements in [section 6](#6-functional-requirements).

### Epic A: Authentication and account

**A1.** As a user, I can sign in with my Discord account so that I do not need a separate password.
- AC1: Clicking "Login with Discord" redirects to Discord's authorisation page.
- AC2: After approving, I am returned to the dashboard and my profile is shown.
- AC3: My account is created automatically on first login.
- AC4: My Discord username and avatar are shown in the sidebar.

**A2.** As a user, I can sign out.
- AC1: Logout ends my session and returns the app to the signed-out state.
- ⚠️ *Current behaviour:* logout ends the session but then resets the UI to demo data, not a signed-out state. See A3.

**A3.** As a signed-out visitor, I am told I am not signed in.
- AC1: The app shows a clear signed-out state with a login action.
- ⚠️ *Current behaviour:* the app shows demo data instead of a signed-out state. This does not meet AC1. See [section 11](#11-known-gaps-and-roadmap).

### Epic B: Quest lists and tasks

**B1.** As a user, I can create a quest list with a name, description, category, priority and deadline.
- AC1: Name is required.
- AC2: Category is chosen from School, Work, Personal, Health, Finance, Shopping, Fitness, Other.
- AC3: Priority is HIGH, MEDIUM or LOW.
- AC4: Creating a list awards 10 base XP and shows a toast.
- ⚠️ *Gap:* the server does not validate name or the category and priority values.

**B2.** As a user, I can add tasks to a list.
- AC1: A task has a name and optional description.
- AC2: Adding a task awards 5 base XP.

**B3.** As a user, I can complete and un-complete a task.
- AC1: Completing a task awards 10 base XP, modified by class and skills.
- AC2: The list progress bar updates. A list at 100% shows "Quest Complete".
- ⚠️ *Gap:* un-completing and re-completing awards XP again. Proposed behaviour: a task awards its XP once and cannot be farmed by toggling.

**B4.** As a user, I can reorder tasks by dragging them.
- AC1: Dropping a task places it at the new position, and the order persists.
- ⚠️ *Gap:* drag-and-drop is mouse only. There is no keyboard or touch alternative.

**B5.** As a user, I can edit and delete lists and tasks.
- AC1: Editing saves the changed fields.
- AC2: Deleting a list removes its tasks.
- AC3: Deleting asks for confirmation.
- ⚠️ *Gap:* any authenticated user can edit or delete any task by ID. See [section 11](#11-known-gaps-and-roadmap).

**B6.** As a user, I can filter, search and sort my lists.
- AC1: Filter by category, priority and status. Show an active filter count and a clear action.
- AC2: Search matches name and category.
- AC3: Sort by newest, oldest, name, priority or deadline.
- AC4: Tabs show All, Current, Expired and Completed. Expired means the deadline has passed and the list is not complete.

**B7.** As a user, I can see when a list is due and whether it is overdue.
- AC1: Deadlines show on cards and in the detail view. Overdue lists are visibly marked.

### Epic C: XP and levels

**C1.** As a user, I earn XP for actions and see the amount.
- AC1: Each XP-earning action shows a toast with the final XP and, when relevant, a breakdown of base, class, skill and crit bonuses.
- AC2: The XP balance shown in the UI matches the server.

**C2.** As a user, I can see my level and progress to the next level.
- AC1: Level equals `floor(XP / 100) + 1`.
- AC2: A progress bar shows XP toward the next level.
- ⚠️ *Gap:* the 100 XP level size is hardcoded in the frontend.

**C3.** As a user, I can turn gamification off.
- AC1: With gamification off, actions still work but award base XP only, with no class or skill modifiers.
- AC2: A user with gamification off is excluded from the leaderboard.

**C4.** As a user, I can see my XP history.
- ⚠️ *Status:* the API endpoint exists, but no page shows it. **Planned.**

### Epic D: Classes

**D1.** As a user, I can see the available classes and what each one does.
- AC1: Each class shows its cost, playstyle and description.
- AC2: Owned, equipped and locked states are clearly distinct.

**D2.** As a user, I can buy a class with XP.
- AC1: The purchase fails with a clear message if XP is insufficient or the class is already owned.
- AC2: Buying also equips the class.

**D3.** As a user, I can switch between owned classes.
- AC1: Equipping a class resets that class's internal counters.

**D4.** As a user, I can rely on each class's rule working as described.
- ⚠️ *Gap:* several in-game descriptions do not match the rules (for example the Hero description in one place). See [GAME_MECHANICS §10](GAME_MECHANICS.md#10-known-discrepancies).

### Epic E: Skills

**E1.** As a user, I can see the skill tree for each class.
- AC1: Each tree lists its skills, costs, max levels and prerequisites.
- AC2: Trees for unowned classes are visibly locked.

**E2.** As a user, I can unlock and upgrade skills with XP.
- AC1: A skill can be bought only when its class is owned and its prerequisite is at level 1 or more.
- AC2: A skill cannot exceed its max level.
- ⚠️ *Gap:* 16 of 27 skills have no effect. The UI still allows buying them. See [GAME_MECHANICS §5](GAME_MECHANICS.md#5-skills).

### Epic F: Achievements

**F1.** As a user, I can see my achievements and which are unlocked.
- AC1: Achievements are grouped by category with progress counts.
- AC2: Each unlocked achievement shows its unlock date.
- ⚠️ *Gap:* achievements in categories the page does not list are hidden.

**F2.** As a user, I am notified when I unlock an achievement.
- AC1: A toast appears when an achievement unlocks.

### Epic G: Daily reward and streaks

**G1.** As a user, I can claim a daily reward once every 24 hours.
- AC1: The claim awards 100 base XP plus any class, streak and skill bonuses.
- AC2: A second claim within 24 hours is refused with the time remaining.
- AC3: The streak increases on claims made within 48 hours of the previous claim and resets otherwise.
- AC4: The streak bonus is capped at +50.
- ⚠️ *Gap:* two simultaneous claims can both succeed.

### Epic H: Mini-games

**H1.** As a user, I can play free arcade games for XP.
- AC1: Snake, Dino Runner and Space Invaders award XP in proportion to score or kills.
- AC2: Scores are shown and a session best is kept.
- ⚠️ *Gap:* the server accepts any reported payout. See [section 11](#11-known-gaps-and-roadmap).

**H2.** As a user, I can wager XP on Blackjack, Rock-Paper-Scissors or Hangman.
- AC1: A bet cannot be below 10 XP or above the lesser of 25% of balance and 1000 XP.
- AC2: Results and XP changes are shown and recorded.
- ⚠️ *Gap:* bet limits are enforced in the browser only.

**H3.** As a user, I can see my recent game history.
- AC1: The last 10 games are shown with the result and XP change.

### Epic I: Leaderboard

**I1.** As a user, I can see the top players by XP.
- AC1: The top 3 are shown in a podium, and the top 10 in a table.
- AC2: My own row is highlighted.
- AC3: The page is viewable without signing in.

### Epic J: Settings

**J1.** As a user, I can turn gamification on or off.
- AC1: The change takes effect on the next XP action.

**J2.** As a user, I can turn on automation and auto-delete of old lists.
- ⚠️ *Status:* the toggles save their values, but no behaviour is implemented. **Planned.**

**J3.** As a user, I can reset my progress.
- AC1: A reset requires typing `RESET` to confirm.
- AC2: A reset clears lists, XP, class, skills, achievements and history.
- AC3: The reset is irreversible, and the confirmation dialog says so.

**J4.** As a user, I can add the TaskQuest bot to my Discord server.
- ⚠️ *Status:* the button is a placeholder with no invite link. **Planned.**

### Epic K: Discord bot synchronisation

**K1.** As a user of both the bot and the web app, I see the same progress in each.
- AC1: Logging in with the same Discord account shows the progress created through the bot.
- AC2: XP earned in either place appears in both.
- ⚠️ *Dependency:* this relies on the bot sharing the schema. The bot's code is not in this repository.

### Epic L: Operations

**L1.** As an operator, I can deploy the API and the frontend.
- AC1: A Render blueprint defines the API service with a health check.
- ⚠️ *Gap:* the frontend has no defined deployment in the blueprint, and the API does not build `dist/`.

**L2.** As an operator, I can see whether the app and its database are healthy.
- AC1: `GET /api/health` reports database status.
- ⚠️ *Gap:* the response includes raw error text.

---

## 6. Functional requirements

| ID | Requirement | Status | Notes |
|---|---|---|---|
| FR-01 | Discord OAuth2 login with `identify` scope | Implemented | No `state` parameter. |
| FR-02 | Session cookie, 7-day lifetime | Partial | In-memory store. Lost on restart. |
| FR-03 | Logout destroys the session | Implemented | Does not clear the cookie or require auth. |
| FR-04 | Route protection for authenticated pages | Planned | No guard exists. |
| FR-05 | Signed-out state instead of demo data | Planned | Currently falls back to `MOCK_USER`. |
| FR-06 | Create, read, update and delete lists | Partial | No ownership checks on item routes; no validation. |
| FR-07 | Create, update, delete and toggle items | Partial | No ownership checks. Toggle awards XP repeatedly. |
| FR-08 | Drag-and-drop reordering | Partial | Mouse only. Persists `position`. |
| FR-09 | Category, priority, deadline and status on lists | Implemented | Free-text on the server; enumerated in the UI. |
| FR-10 | Level derived from XP | Implemented | `floor(XP/100)+1`. Frontend hardcodes 100. |
| FR-11 | XP ledger | Implemented | Clamped at zero. Purchases bypass the ledger. |
| FR-12 | Six classes with purchase and equip | Implemented | Counters reset on equip. |
| FR-13 | Skill trees with prerequisites and levels | Partial | 16 of 27 skills are inert. |
| FR-14 | 24 achievements, awarded once | Implemented | Some are based on the current balance. |
| FR-15 | Daily reward with cooldown, streak and bonuses | Implemented | Race condition on concurrent claims. |
| FR-16 | Free arcade games (Snake, Dino, Invaders) | Partial | Client-trusted payouts. |
| FR-17 | Betting games (Blackjack, RPS, Hangman) | Partial | Client-trusted bets and results. |
| FR-18 | Game history | Implemented | Last 20 on the API, last 10 shown in the UI. |
| FR-19 | Leaderboard | Implemented | Public. Exposes Discord IDs. |
| FR-20 | Gamification toggle | Implemented | Also controls leaderboard inclusion. |
| FR-21 | Automation and auto-delete toggles | Planned | Stored only. |
| FR-22 | Progress reset with typed confirmation | Implemented | No server-side confirmation. |
| FR-23 | XP history view | Planned | API exists, no UI. |
| FR-24 | Bot invite link | Planned | Placeholder. |
| FR-25 | Health endpoint | Partial | Leaks raw error text. |
| FR-26 | Responsive layout with mobile drawer | Partial | Game canvases overflow phones. |
| FR-27 | Accessible controls | Partial | Several gaps. See [NFR](#7-non-functional-requirements). |
| FR-28 | Input validation on all write endpoints | Planned | Not present. |
| FR-29 | Rate limiting | Planned | Not present. |
| FR-30 | Database schema and migrations in repo | Planned | Owned by the bot today. |

---

## 7. Non-functional requirements

### Security
- **NFR-S1.** Authenticate every write endpoint. *Status: Partial. Every write requires a session, but item routes do not check ownership.*
- **NFR-S2.** Authorise every object access by owner. *Status: Partial. Lists and classes do; items do not.*
- **NFR-S3.** Server is authoritative for XP, bets and results. *Status: Partial. Only the XP calculation is server-side.*
- **NFR-S4.** Secrets are never committed. *Status: Not met. `server/.env` is tracked in git.*
- **NFR-S5.** The session secret has no insecure default. *Status: Not met. A public fallback exists.*
- **NFR-S6.** Input is validated and coerced. *Status: Not met.*
- **NFR-S7.** Abuse is rate-limited. *Status: Not met.*
- **NFR-S8.** OAuth uses a `state` parameter. *Status: Not met.*

### Reliability
- **NFR-R1.** Concurrent writes do not corrupt balances or double-award. *Status: Not met. No transactions or locks.*
- **NFR-R2.** Sessions survive a restart. *Status: Not met. In-memory store.*
- **NFR-R3.** API errors are visible to the user. *Status: Not met. Errors are replaced by mock data.*
- **NFR-R4.** Unknown API paths return a JSON 404. *Status: Not met. Production requests hang.*

### Performance
- **NFR-P1.** The leaderboard responds without a noticeable delay. *Status: Partial. About 50 queries per request and no cache.*
- **NFR-P2.** Lists load without N+1 queries. *Status: Not met.*
- **NFR-P3.** The UI stays responsive during game loops. *Status: Partial. `setInterval` loops, not frame-synced.*

### Accessibility
- **NFR-A1.** Interactive elements have accessible names and keyboard access. *Status: Partial. Many icon-only buttons are unlabelled; card-style clickable elements are not focusable.*
- **NFR-A2.** Colour is not the only signal. *Status: Partial.*
- **NFR-A3.** Motion respects reduced-motion preferences. *Status: Not met.*
- **NFR-A4.** Dialogs trap focus and restore it on close. *Status: Implemented, via Radix.*

### Responsiveness
- **NFR-U1.** The layout works at phone width with no horizontal scrolling. *Status: Partial. Game canvases and the Tasks tab strip can overflow.*
- **NFR-U2.** Navigation works on small screens. *Status: Implemented, via the drawer.*

### Maintainability
- **NFR-M1.** Game definitions have one source of truth. *Status: Not met. Duplicated across server and frontend.*
- **NFR-M2.** Types match runtime data. *Status: Not met. Heavy use of `any`.*
- **NFR-M3.** Automated tests cover XP and class logic. *Status: Not met. There are no tests.*
- **NFR-M4.** The database schema is versioned in the repo. *Status: Not met.*

---

## 8. Data and integrations

### Data owned by TaskQuest
- User progress: XP, level, class, class counters, streak, daily claim timestamp, settings.
- Lists and items.
- Skill levels, achievements, game sessions, XP ledger.

### Data the app reads from Discord
- The `identify` scope: user ID, username, global name, avatar, discriminator.
- Discord user data is cached on the user row at login (`discord_username`, `discord_avatar`).

### Shared with the Discord bot
- The same MySQL database, with the same tables and IDs. The bot is the source of the schema.

### Privacy considerations
- The public leaderboard exposes Discord IDs, usernames and avatars for players who have gamification on. A future change should make this opt-in.
- The app keeps no Discord access token after login.
- There is no data export or account deletion beyond "reset progress", which does not delete the user row.

---

## 9. Success metrics

These are proposed targets for measuring v1.5. The app currently has no analytics, so none of these can be measured yet.

| Metric | Proposed target | Why |
|---|---|---|
| Daily claim rate | At least 40% of weekly active users claim each day | Habit formation (G4). |
| 7-day streak rate | At least 15% of users reach a 7-day streak | Retention (G4). |
| Tasks completed per active user per week | At least 10 | Core usage (G1). |
| Wager share of XP spend | Under 20% | Keeps the games from dominating progression (G5). |
| Discord-linked accounts | Measured as the share of web users who also use the bot | Integration value (G6). |
| Cheating incidents | Zero reports of XP above the rule maximum | Integrity (NFR-S3). |

---

## 10. Release scope: v1.5

### Included
- Discord login and sessions (FR-01 to FR-03).
- Lists, items, categories, priorities, deadlines, filters and sorting (FR-06 to FR-09).
- XP, levels and the XP ledger (FR-10, FR-11).
- Classes and skill trees (FR-12, FR-13).
- Achievements (FR-14).
- Daily reward and streaks (FR-15).
- Mini-games and game history (FR-16 to FR-18).
- Leaderboard (FR-19), gamification toggle (FR-20), progress reset (FR-22).
- Responsive layout, Render blueprint for the API, health check (FR-25, FR-26).

### Deliberately excluded from v1.5
- Route protection and a signed-out state (FR-04, FR-05). The app is still behind a shared login and is not public.
- Automation features (FR-21) and the bot invite (FR-24).
- XP history UI (FR-23).

### Release readiness
v1.5 is suitable for trusted testers. It is **not** suitable for a public launch until the items in [section 11](#11-known-gaps-and-roadmap) marked **Critical** are fixed.

---

## 11. Known gaps and roadmap

Items are ranked by risk to users and to the product. Each one links to where the detail lives.

### Critical (fix before any public exposure)

| # | Gap | Impact | Reference |
|---|---|---|---|
| C-1 | **Game results are trusted from the client.** Any payout can be reported, so XP can be minted at will. | Unlimited XP, a broken leaderboard, and abuse of the bet system. | [SECURITY: client-trusted game results](../SECURITY.md#client-trusted-game-results) |
| C-2 | **No ownership check on item routes.** Any signed-in user can edit, delete or complete any task. | Data tampering across accounts, and XP credited to other people's tasks. | [SECURITY: item ownership](../SECURITY.md#item-ownership) |
| C-3 | **`server/.env` is committed and there is no `.gitignore`.** | Secrets exposed in repository history. | [SECURITY: committed secrets](../SECURITY.md#committed-secrets) |
| C-4 | **Public fallback session secret.** | Session cookies can be forged if `SESSION_SECRET` is unset. | [SECURITY: session secret](../SECURITY.md#session-secret) |

### High (fix before a wider release)

| # | Gap | Impact | Reference |
|---|---|---|---|
| H-1 | **XP farming.** Toggling tasks and creating or deleting items awards XP each time. | Inflated XP and levels. | [SECURITY: XP farming](../SECURITY.md#xp-farming) |
| H-2 | **No rate limiting.** | Brute force, XP farming and leaderboard load. | [SECURITY: rate limiting](../SECURITY.md#no-rate-limiting) |
| H-3 | **No input validation.** Empty bodies cause 500 errors, and types are not coerced. | Crashes, bad data, and inconsistent records. | [API: known issues](API.md#15-known-api-issues) |
| H-4 | **Race conditions** in XP, class purchases and the daily claim. | Double spending and double rewards. | [SECURITY: race conditions](../SECURITY.md#race-conditions) |
| H-5 | **Demo-mode fallback hides real failures.** | Users believe writes succeeded when they did not. | [ARCHITECTURE §2.4](ARCHITECTURE.md#24-server-state-hooksuseapits) |
| H-6 | **Routes are unprotected.** | Demo data is shown to signed-out visitors (FR-04, FR-05). | [ARCHITECTURE §2.2](ARCHITECTURE.md#22-routes) |
| H-7 | **OAuth without `state`.** | Login CSRF. | [SECURITY: OAuth state](../SECURITY.md#oauth-state) |
| H-8 | **Schema and migrations are not in the repo.** | A fresh environment cannot be built from this repository. | [README: Database](../README.md#database) |
| H-9 | **Sessions are in memory.** | Users are logged out on every restart and on Render's free-tier spin-down. | [SECURITY: session storage](../SECURITY.md#session-storage) |

### Medium (product quality)

| # | Gap | Impact |
|---|---|---|
| M-1 | Skills: 16 of 27 have no effect, and several descriptions are wrong. | Players pay XP for nothing. |
| M-2 | Class and skill descriptions do not match the rules. | Confusion and mistrust. |
| M-3 | Achievements for XP use the current balance, not lifetime XP. | Achievements can be lost by spending. |
| M-4 | Streak Shield and the "miss" mechanics are not implemented. | A promised protection does nothing. |
| M-5 | Level size is hardcoded in the frontend. | Progress bars break if the curve changes. |
| M-6 | The leaderboard mock returns an object, not an array. | Possible crash in demo mode. |
| M-7 | Profile colours use dynamic Tailwind class names that are purged. | Missing colours in production. |
| M-8 | Game canvases are fixed size. | Overflow on phones. |
| M-9 | Snake food can spawn on the snake, and the Dino bird hitbox is misaligned. | Visible bugs. |
| M-10 | The blackjack shuffle is biased. | Fairness concern. |
| M-11 | Hangman has no replay. | Friction. |
| M-12 | Settings reset dialog nests invalid HTML. | Console warnings. |
| M-13 | Achievement page hides categories it does not list. | Some achievements never appear. |
| M-14 | The Tasks detail view is not addressable by URL. | Back button and refresh lose place. |
| M-15 | Hover-only task controls cannot be reached by touch. | Touch users cannot edit or delete tasks. |
| M-16 | No XP history UI. | Users cannot see where XP went. |

### Low (cleanup)

| # | Item |
|---|---|
| L-1 | Remove dead code: `App.css`, `NavLink.tsx`, `AchievementBadge.tsx`, `useRequireAuth`, `useUser`. |
| L-2 | Remove the duplicate toaster (shadcn `Toaster` next to sonner). |
| L-3 | Remove `lovable-tagger` or document why it stays. |
| L-4 | Remove the duplicated server dependencies from `server/package.json`, or the root `package.json`. |
| L-5 | Remove the unused `sign` variable, `dbUser`, and the unused `luckBonus`, `streakProtect` plumbing. |
| L-6 | Add a LICENSE file and a `license` field in `package.json`. |
| L-7 | Add `prefers-reduced-motion` handling. |
| L-8 | Add tests for `gameLogic.js`, starting with the pure functions. |

### Roadmap (proposed order)

1. **Security hardening:** fix C-1 to C-4, then H-1, H-2 and H-7. Keep the `.env` rotation and history rewrite as a separate, explicitly approved step.
2. **Integrity:** add transactions or row locks around XP and purchases (H-4), and validate every write (H-3).
3. **Honest UI:** replace the demo fallback with a signed-out state and visible errors (H-5, H-6, FR-05).
4. **Persistence and ops:** move sessions to MySQL or Redis (H-9). Add the schema and a migration tool to the repo (H-8). Define the frontend deployment in the Render blueprint.
5. **Content parity:** make skills real or remove them, align descriptions with the rules, and move the game definitions to one source (M-1, M-2, NFR-M1).
6. **Polish and access:** fix the medium items, then the accessibility gaps in NFR-A1 and NFR-A3.
7. **Features:** XP history (FR-23), then automation (FR-21), then the bot invite (FR-24).

---

## 12. Risks and assumptions

### Risks
- **Schema drift with the bot.** The web app depends on tables it does not own. A bot change could break the web app without warning. *Mitigation:* agree a shared schema contract, and document it in this repo.
- **Integrity failures are visible.** Once someone publishes an XP exploit, the leaderboard loses credibility. *Mitigation:* fix Critical items before any public link is shared.
- **Free-tier hosting.** Render's free plan sleeps and restarts, which logs users out and slows the first request. *Mitigation:* persistent sessions (H-9), and a paid plan if usage grows.
- **Cross-site cookies.** Production uses `SameSite=None; Secure` across two origins, which some browsers block. *Mitigation:* serve the frontend and API from one origin, or use a shared parent domain.
- **Balance design.** Skills and classes interact in ways that have not been tested. Some combinations may trivialise progression. *Mitigation:* simulate XP curves before tuning.

### Assumptions
- Users have a Discord account and are comfortable signing in with it.
- The Discord bot continues to share the same database and schema.
- XP has no monetary value and no cross-user transfer.
- The app is used by individuals, not teams.
- Operators can manage a MySQL database and a Render deployment.

---

## 13. Open questions

1. **Who owns the schema?** Is the Discord bot repository the source of truth for the tables, and where is it?
2. **Should the leaderboard be opt-in?** It currently exposes Discord IDs and avatars publicly.
3. **What is the intended XP curve?** The implementation is linear at 100 XP per level, but "XP" is spendable. Is that deliberate?
4. **Should spending XP reduce level?** Today it does. Should levels be permanent once reached?
5. **What should the achievements that mention "total XP" count?** Lifetime earnings or current balance?
6. **Are skills meant to stack across classes?** Today they do, regardless of which class is equipped.
7. **Should game bets be real stakes at all?** If so, they need the integrity work in Critical items C-1 and H-4 before launch.
8. **What is the target platform for the frontend?** A static site on Render, or served by the API?
9. **Is automation (FR-21) in scope for the next release?**
10. **What license applies?** The README says MIT, but no LICENSE file exists.

---

## 14. Glossary

| Term | Meaning |
|---|---|
| **Quest** | A list of tasks. The UI uses "quest" for lists. |
| **Task** | An item inside a quest. The API calls these items. |
| **XP** | The spendable balance. Earned by actions, spent on classes, skills and bets. |
| **Level** | `floor(XP / 100) + 1`. |
| **Base XP** | The amount an action awards before class and skill modifiers. |
| **Final XP** | The amount actually added to the balance, after modifiers. |
| **Class** | A playstyle that changes how XP is earned. Bought with XP. |
| **Skill** | An upgrade within a class tree. Bought with XP. |
| **Streak** | Consecutive daily claims made within the streak window. |
| **Gamification** | The user setting that turns class and skill modifiers on or off. |
| **Demo mode** | The frontend state that shows mock data when the API cannot be reached. |
| **Ledger** | The `xp_transactions` table, which records XP changes. |
