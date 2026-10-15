# TaskQuest: Product Requirements Document

| | |
|---|---|
| **Product** | TaskQuest (Discord bot + web app) |
| **Version** | 4.0.0 (monorepo) plus the unreleased improvement pass |
| **Status** | Living document |
| **Audience** | Product owner, developers, contributors, operators |
| **Related** | [ARCHITECTURE](ARCHITECTURE.md) · [GAMEPLAY](GAMEPLAY.md) · [XP_GUIDE](XP_GUIDE.md) · [API](API.md) · [COMMANDS](COMMANDS.md) · [KNOWN_ISSUES](KNOWN_ISSUES.md) |

Status legend: **Done** (works as described), **Partial** (works, with a noted gap), **Planned** (not built yet).

IDs: personas are `P1` to `P5`, goals `G1` to `G8`, user stories `US-<section letter><number>` (for example `US-P1` is a progression story and `US-G1` a games story), functional requirements `FR<number>`.

---

## Contents

1. [Summary](#1-summary)
2. [Problem](#2-problem)
3. [Goals and non-goals](#3-goals-and-non-goals)
4. [Personas](#4-personas)
5. [User stories](#5-user-stories)
6. [Functional requirements](#6-functional-requirements)
7. [Non-functional requirements](#7-non-functional-requirements)
8. [Platform parity](#8-platform-parity)
9. [Success metrics](#9-success-metrics)
10. [Release scope](#10-release-scope)
11. [Roadmap](#11-roadmap)
12. [Risks and assumptions](#12-risks-and-assumptions)
13. [Glossary](#13-glossary)

---

## 1. Summary

TaskQuest turns ordinary to-do lists into RPG-style progression. People create lists, add tasks and complete them, and every meaningful action earns XP. XP drives levels, a daily reward with streaks and chests, seventeen character classes (Default plus sixteen to buy) that change how XP is earned, 96 skills, 33 achievements, daily, weekly, monthly and rotating quests, focus sessions, a weekly review, prestige, a cosmetics shop, and a small game centre where XP can be won or wagered. Lists can be shared, and small parties work on a shared weekly quest.

TaskQuest is one product with two front ends that share one account (the Discord identity) and one database:

- **The Discord bot** keeps task management where communities already talk. It also sends deadline and task reminders by DM.
- **The web app** gives a richer dashboard: visual skill trees, statistics, focus timer, a shop, a leaderboard, three browser arcade games and optional push notifications.

Before 4.0 these lived in two repositories with duplicated, drifting game logic. Version 4.0 merged them into a monorepo and moved every rule into one shared package, so behaviour is identical everywhere. The improvement pass that followed rebalanced the classes, added five classes and many XP sources, and built sharing.

## 2. Problem

Task managers are easy to abandon. Motivation fades once checking boxes stops feeling new. Many gamified tools are shallow: they offer a points counter with no consequence, and live in an app people forget to open.

TaskQuest addresses this in three ways:

1. It meets users **where they already are** (Discord), with an optional web dashboard.
2. It uses **mechanics with real trade-offs**:
   - Classes reshape XP gain (steady, random, streak, cyclic, stacking, daily rhythm, deadlines, overdue work, priorities).
   - Skills reward committing to a path.
   - Spending XP on classes, skills, cosmetics or bets makes progress a choice, and prestige trades a reset for a permanent bonus.
3. It **surfaces work without effort**, through deadline and task reminders, a daily reward loop, quests and a weekly review.

## 3. Goals and non-goals

### Goals

| ID | Goal | Status |
|---|---|---|
| G1 | Create, organise and complete task lists entirely in Discord or on the web | Done |
| G2 | Reward completion with immediate, visible progression (XP, levels, achievements) | Done |
| G3 | Offer strategic choice through classes and skills that change how XP is earned | Done |
| G4 | Bring users back through a daily reward with streaks, quests, a weekly review and deadline reminders | Done |
| G5 | Provide light entertainment through games using the same XP economy | Done |
| G6 | One account and identical rules across bot and web | Done (4.0) |
| G7 | An XP economy that can't be farmed or exploited | Done; residual risks (offline arcade solvers, time zone hopping) are bounded and listed in [KNOWN_ISSUES](KNOWN_ISSUES.md) and [SECURITY](../SECURITY.md#known-residual-risks) |
| G8 | Safe to operate: no leaked secrets, hardened web surface, reproducible deploys | Done (4.0) |
| G9 | Let a few people work on the same list or towards the same quest without sharing an account | Done (shared lists and parties) |

### Non-goals

- **Heavy team collaboration.** Lists can be shared (viewer, editor and manager roles) and small parties share a weekly quest, but there is no task assignment, comments, chat, activity feed or ownership transfer.
- **Real money.** XP has no cash value and can't be bought, sold or transferred.
- **A full calendar.** Tasks and lists have due dates, tasks can repeat, and reminders arrive once on the due day at the user's reminder hour (Discord DM, optionally a browser push). There are no times of day, and the calendar is a read-only `.ics` feed.
- **Native mobile apps.** The web app is responsive, and push notifications are optional and browser-based, but there is no app-store product.
- **Server moderation features.**
- **Internationalisation.** The product is English only.

## 4. Personas

**P1. Habit Builder.** A student or professional who wants a routine to stick. They care about streaks, the daily reward, reminders, the weekly review and a sense of progress. They rarely play games.

**P2. Min-Maxer.** Enjoys systems. Reads class and skill rules, plans builds, and expects the numbers to be exact, documented and identical on both platforms.

**P3. Discord Regular.** Already lives in a server that uses the bot. Uses the web app for a bigger view and expects the same account and progress.

**P4. Casual Player.** Enjoys a quick game and a small bet, and wants clear odds and fair outcomes.

**P5. Operator.** Deploys and runs TaskQuest. Needs clear configuration, one-command migrations, health checks and a clear security posture.

## 5. User stories

### 5.1 Account and identity

| ID | Story | Acceptance criteria | Status |
|---|---|---|---|
| US-A1 | As a user, I sign in to the web app with Discord | The `identify` scope only. `state` is verified. A new session ID is issued at login. I land on the dashboard. | Done |
| US-A2 | As a user, my progress is the same in Discord and on the web | Both read and write the same rows through the same services. | Done |
| US-A3 | As a user, I can log out | The session is destroyed server-side and the cookie is cleared. | Done |
| US-A4 | As a logged-out visitor, I see a login screen, never fake data | No mock fallback. API errors show an error state. | Done |
| US-A5 | As a user, I can reset all my progress | It requires typing `RESET`. The server requires an explicit confirmation body. Lists, memberships, templates, cosmetics and prestige go with it. | Done |

### 5.2 Lists and tasks

| ID | Story | Acceptance criteria | Status |
|---|---|---|---|
| US-L1 | Create a list with a name, and optionally a description, category, priority and deadline | Name 1–100 chars and unique per user. Deadline is a real `YYYY-MM-DD` date. | Done |
| US-L2 | Add, rename, describe, complete, reorder and delete tasks | Task name 1–200 chars. Descriptions up to 1000 chars. | Done |
| US-L3 | Filter lists (all, current, expired, completed, category) and sort them | Available on both platforms. | Done |
| US-L4 | Search my lists and the tasks inside them | Lists match name, category and description; tasks match name and description (web, `scope=tasks`). `%` and `_` are matched literally. | Done |
| US-L5 | Nobody else can see or change my lists unless I share them | Every query goes through one access rule: the owner, or a member with a sufficient role. A stranger gets "not found", including for clicks on someone else's public `/list` message. | Done |
| US-L6 | Get a DM on a list's deadline day | Sent once per list, at the user's reminder hour in their own time zone (`/timezone` or web Settings). A reminder missed during an outage is still sent (up to 3 days late), and temporary Discord errors are retried. One more notice follows if tasks are still open the day after. DMs carry Snooze and Stop buttons. Can be turned off with `/automation` or in web Settings. | Done |
| US-L7 | Have finished lists cleaned up | Deletes a list when every task has been done for 5+ days. Unfinished lists and lists that have members are never deleted. Opt-out in Settings. | Done |
| US-L8 | Due dates, priorities, tags and subtasks on individual tasks | Own due date and priority (the task's priority drives class and skill effects), up to 5 tags, one level of subtasks. Shown and editable on the web and in the `/list` editor's Details dialog; `/quick` on Discord. | Done |
| US-L9 | Recurring tasks | Daily, weekly or monthly. Completing one creates the next copy (no creation XP). | Done |
| US-L10 | Add a task from one line of text | "Finish report fri !high #work every week" is understood on the web (quick-add bar) and in Discord (`/quick`). | Done |
| US-L11 | Undo a deletion, and act on several tasks at once | Deleting a task hides it with an Undo toast and only deletes when it expires; select mode completes or deletes several. | Done |
| US-L12 | Export my data, import it back, and see deadlines in my calendar | JSON and CSV export, reward-free JSON import, and a secret iCalendar feed. | Done |
| US-L13 | A Monday summary of my week | Opt-in DM (`/weekly`), with the AI recap appended when AI is on. | Done |
| US-L14 | Import tasks from a spreadsheet | A CSV file (TaskQuest's own export or any file with a header row naming `list`, `task`, `due`, `priority`, `tags`, `repeat`, `done`) with a dry-run preview and row-numbered errors. All or nothing, within the account quota, no XP. | Done |
| US-L15 | Reuse a checklist as a template | Save a quest's tasks as a template (up to 20 templates of up to 30 tasks) and start a new quest from it or append it to one. Subtasks, due dates and completion are not kept. | Done |
| US-L16 | Be reminded of a single task on its due date | One DM (and push) on the task's due day at the reminder hour, up to 3 days late, with Snooze and Stop. A task due on its list's deadline is covered by the list reminder. At most 20 reminder DMs an hour; the rest collapse into one digest. | Done |
| US-L17 | See how my work and XP develop | The web Stats page: XP per day over 7, 30 or 90 days, XP by source, busiest weekday, streak. | Done |

### 5.3 Progression

| ID | Story | Acceptance criteria | Status |
|---|---|---|---|
| US-P1 | Earn XP for creating lists, adding tasks and completing tasks | 10, 5 and 10 base XP. Daily caps apply (10 lists, 50 additions, 50 completions). Completion XP is paid once per task. | Done |
| US-P2 | Claim a daily reward with a streak bonus | 100 base XP, plus 5 per streak day (max +50), plus skill bonus. 24h cooldown. A claim on consecutive calendar days keeps the streak. | Done |
| US-P3 | Level up from lifetime XP | Level = ⌊lifetime XP / 100⌋ + 1. Spending XP never lowers your level. | Done |
| US-P4 | Buy and equip classes | The purchase is atomic, so a double click can't charge twice. Switching class resets class counters. Seventeen classes: Default plus sixteen. | Done |
| US-P5 | Unlock and level skills | The tree must be owned and the prerequisite unlocked. Cost is charged per level. 96 skills; every skill has a working effect. | Done |
| US-P6 | Unlock achievements and see them immediately | 33 achievements, evaluated in the same transaction as the action that earned them. Each pays 25 XP. | Done |
| US-P7 | Turn XP off entirely | The XP toggle stops rewards, purchases and games. Tasks keep working. | Done |
| US-P8 | Compare with others on a leaderboard | Top 10 on four boards: lifetime XP (default), XP earned this week, daily streak, current balance; optional class filter. Shows the stored display name, avatar, prestige title and equipped cosmetics, never a Discord ID. Spending XP does not lower the default board. | Done |
| US-P9 | Work towards quests | Daily (3), weekly (2), one rotating weekly quest out of four, and a monthly boss; progress from real activity in my own day, week and month; one claim per period. | Done |
| US-P10 | Protect a streak | A 150 XP streak freeze (max 3; Freeze Cache: 120 XP, max 5) saves a streak of 2+ days that a missed day would break. | Done |
| US-P11 | Be rewarded for spending | Achievements for spending 1,000 / 5,000 / 10,000 XP on classes, skills, freezes and cosmetics. | Done |
| US-P12 | Be paid extra for good habits on a task | Flat, capped bonuses on a task's first completion: first task of the day (+10), list cleared (+25), finished early (+5 a day, max +20), overdue cleared (+10), all subtasks done (+10), habit streak (+2 a step). Imported and auto-created tasks never pay them. | Done |
| US-P13 | Get a chest for a long streak | The daily claim that reaches a 7, 14 or 30 day streak also pays +100, +250 or +600 XP, once per streak run. | Done |
| US-P14 | Work in timed focus sessions | A server-timed 10 to 90 minute session pays floor(minutes × 0.6) XP, at most 100 XP and 8 sessions a day; finishing under 10 minutes pays nothing. Web Focus page. | Done |
| US-P15 | Review my week | Once per week, after finishing a task, claim +40 XP from the weekly review (web Review page, `/review`). | Done |
| US-P16 | Start over for a permanent bonus | At level 30, up to 10 times: reset level, balance, class and skills for +2% XP per prestige and a title. Achievements, quest claims, tasks and the daily streak stay. Needs a typed confirmation. | Done |
| US-P17 | Spend XP on how I look | Titles, avatar frames and profile accents bought once with XP (some need a level, a prestige or an achievement), with no gameplay effect (web Shop, `/shop`). | Done |
| US-P18 | See days that match my life | Daily caps, quests, the weekly review and stats use my time zone; a zone change is allowed once every 24 hours. | Done |

### 5.4 Games

| ID | Story | Acceptance criteria | Status |
|---|---|---|---|
| US-G1 | Play Blackjack for an XP bet | Bet is 10 to min(25% of balance, 1000). Pays 1:1 and 3:2 for a natural, with no class or skill bonuses. Double down is allowed. The hand resumes across platforms. | Done |
| US-G2 | Play risk-free Rock Paper Scissors | +10 base XP per win. Losses cost nothing. 3s cooldown. | Done |
| US-G3 | Play free Hangman | Win max(10, 10 × lives left) base XP. All 26 letters are selectable in Discord. | Done |
| US-G4 | Play arcade games on the web | Snake, Dino and Invaders. XP is capped per run; the server replays the recorded inputs and pays on the score it derives. | Done |
| US-G5 | Trust that games are fair | The server shuffles with a CSPRNG and decides every outcome. Hidden information never reaches the client. | Done |
| US-G6 | Never lose a bet to a crash | The bet is escrowed atomically. A hand abandoned for 30 minutes is settled as if I had stood (no refunds, so walking away from a bad hand costs the bet). | Done |

### 5.5 Sharing and parties

| ID | Story | Acceptance criteria | Status |
|---|---|---|---|
| US-S1 | Share a list with someone | A manager invites by exact Discord username (web, with a confirmation of who was found) or by mention (`/share`). Roles: viewer, editor, manager. Up to 10 people besides the owner; invitations last 7 days, 30 a day. | Done |
| US-S2 | Accept, decline, leave and remove | The invitee accepts or declines (`/invites`, web banner); members can leave; managers remove members. | Done |
| US-S3 | Work on a shared list without sharing XP | XP, caps, quests, stats and achievements belong to whoever acted; members see display names only, never Discord IDs. | Done |
| US-S4 | Choose who can invite me | A setting turns invitations off; the inviter gets a neutral answer and cannot tell why. | Done |
| US-S5 | Team up with friends on a weekly quest | A party of up to 6 (owner, `/party`, web Party page) with one weekly quest: 12 tasks per active member, +60 XP each for members who finished 6 themselves. | Done |

### 5.6 Notifications

| ID | Story | Acceptance criteria | Status |
|---|---|---|---|
| US-N1 | Get reminders in my browser too | Optional web push (needs VAPID keys on the server and an opt-in per browser). Never replaces the Discord DM. | Done (optional) |
| US-N2 | Get reminders in my own hours | Reminders and the weekly digest arrive at my reminder hour in my time zone. | Done |

## 6. Functional requirements

| ID | Requirement | Status |
|---|---|---|
| FR1 | All XP changes go through one service that locks the user row and writes an `xp_transactions` entry | Done |
| FR2 | Lifetime XP is tracked separately from the spendable balance, and a never-reset total survives prestige | Done |
| FR3 | Class and skill effects are computed by one shared function on both platforms | Done |
| FR4 | Rewards are capped per day in the user's time zone: 10 list creations, 50 task creations and 50 task completions | Done |
| FR5 | Free games (RPS, Hangman, arcade) share a cap of 500 XP per day in the user's time zone | Done |
| FR6 | Game state is persisted in `game_sessions.game_data`, so games survive restarts | Done |
| FR7 | Schema changes happen only through versioned migrations (a PostgreSQL baseline, `001_baseline`, then `002` onwards). The automatic upgrade of 3.x MySQL databases was removed with the move to PostgreSQL ([MIGRATION_POSTGRES](MIGRATION_POSTGRES.md)) | Done |
| FR8 | Bot interactions that show XP or achievements are ephemeral | Done |
| FR9 | The web app and API are served from one origin | Done |
| FR10 | The bot exposes a health endpoint; the web app exposes `/api/health` | Done |
| FR11 | Seventeen classes and 96 skills are defined only in `packages/shared/src/constants.js`; a test checks `docs/GAMEPLAY.md` against it | Done |
| FR12 | Bonus XP sources (task bonuses, streak chests, achievement rewards, habit streaks, focus sessions, weekly review, quests, party quest) are flat, paid in their own `xp_transactions` source and each has a cap ([XP_GUIDE](XP_GUIDE.md)) | Done |
| FR13 | Task bonuses are paid only on a task's first completion, never for imported or auto-created tasks, and need a due date set at least 24 hours earlier to count as early or overdue | Done |
| FR14 | Quests: daily, weekly, monthly and a rotating weekly pool, with progress derived from real activity and one atomic claim per period | Done |
| FR15 | Focus sessions are timed by the server; the client only starts and finishes them | Done |
| FR16 | The weekly review pays once per week and needs at least one finished task | Done |
| FR17 | Prestige is available from level 30, at most 10 times, and needs a typed confirmation | Done |
| FR18 | Cosmetics are bought once in a locked transaction and have no gameplay effect | Done |
| FR19 | Templates, CSV and JSON imports never grant XP or counters and enforce the per-account quota (200 lists, 5000 tasks) on every creation path | Done |
| FR20 | Search matches list and task names and descriptions, owner and member scoped | Done |
| FR21 | `/api/stats` reads only the caller's own data, grouped into days of their time zone | Done |
| FR22 | List access is decided in one module (`access.js`); members receive a column whitelist; no response carries another person's Discord ID | Done |
| FR23 | Parties: one per user, up to 6 members, one weekly quest with a per-person claim | Done |
| FR24 | Web push is off unless all VAPID variables are set; endpoints are limited to known push services | Done |
| FR25 | The user's time zone defines their day; changing it is limited to once per 24 hours | Done |
| FR26 | Arcade runs are verified by replaying recorded inputs on the server | Done |
| FR27 | Transactions that lock several rows take the user row first and lists in ascending order, and deadlock victims are retried | Done |

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| **Security** | OWASP-aligned web surface: CSP, frame-ancestors none, CSRF origin and JSON checks, rate limits, zod validation, one access rule for lists, no stack traces in responses. No secrets in the repository. See [SECURITY.md](../SECURITY.md). |
| **Integrity** | Every purchase or payout runs in one database transaction with row locks. Concurrent clicks can't double-spend or double-pay; integration tests prove this. |
| **Privacy** | Only the Discord ID, display name, username (for invitations) and avatar hash are stored. Other people see display names, never IDs. Names are escaped in DMs and embeds. |
| **Performance** | List overview and leaderboard use single aggregate queries, with no N+1. Bot interactions defer within Discord's 3-second window. |
| **Availability** | Sessions persist in the database, so they survive restarts and redeploys. Graceful SIGTERM handling. Background jobs never crash the process. |
| **Portability** | PostgreSQL 15+ with pgvector and citext (Supabase in production). TLS with certificate verification for cloud databases. |
| **Quality** | CI runs lint, typecheck, build, syntax checks, unit tests, a docs consistency test, integration tests on PostgreSQL (pgvector), Playwright browser tests, and a production dependency audit. |
| **Accessibility** | Keyboard-usable controls on the web (shortcuts, command palette, skip link, focus trap in the mobile drawer, visible focus), labelled icon buttons, `aria-live` status messages, WCAG AA text contrast in both themes (enforced by a test), a reduce-motion setting, and on-screen controls for touch play. |

## 8. Platform parity

| Capability | Bot | Web |
|---|---|---|
| Lists & tasks (CRUD, filter, sort, search) | ✓ | ✓ |
| Per-task due date, priority, tags, repeat | `/list` Details, `/quick` | ✓ |
| Task search inside names and descriptions | — | ✓ |
| Daily reward, profile, achievements | ✓ | ✓ |
| Classes & skills (17 classes, 96 skills) | ✓ | ✓ |
| Leaderboard | ✓ | ✓ |
| Blackjack (incl. double down), RPS, Hangman | ✓ | ✓ |
| Snake, Dino Runner, Space Invaders | — | ✓ |
| Deadline and task reminder DMs | ✓ | Setting only |
| Browser push for reminders | Sends it | ✓ (opt-in in Settings) |
| Settings (XP, reminders, auto-delete) | `/toggle`, `/automation` | ✓ (all three) |
| Reset progress | — | ✓ |
| Quests (daily, weekly, rotating, monthly), streak freeze | `/quests`, `/freeze` | ✓ |
| Weekly review | `/review` | ✓ (Review page) |
| Prestige | `/prestige` | ✓ (Profile) |
| Cosmetics shop | `/shop` | ✓ (Shop page) |
| Shared lists: invite, members, leave | `/share`, `/invites`, `/members`, `/leave` | ✓ (members dialog, invitation banner) |
| Parties and the party quest | `/party` | ✓ (Party page) |
| Focus sessions | — | ✓ (Focus page) |
| Stats and XP history | — | ✓ (Stats page) |
| Templates | — | ✓ |
| Time zone, reminder hour, weekly digest | `/timezone`, `/weekly` | ✓ |
| Quick add | `/quick` | ✓ (quick-add bar) |
| Subtasks, bulk actions, undo | Set through `/quick` and AI | ✓ |
| Export / import (JSON, CSV) / calendar feed | — | ✓ |
| Command palette, tour, light and dark theme | — | ✓ |

## 9. Success metrics

| Metric | Target |
|---|---|
| Weekly active users completing ≥ 1 task | Grows week over week |
| Day-7 daily-reward retention | ≥ 30 % of new users |
| Tasks completed per active user per week | ≥ 5 |
| Users active on both platforms | ≥ 25 % of active users |
| XP economy anomalies (balances far above the 99th percentile, or negative balances) | 0 |
| Interaction error rate (bot "Something went wrong" + API 5xx) | < 0.5 % |

## 10. Release scope

**Release 4.0 (in scope):**

- The monorepo with the shared package.
- A unified schema, with migrations from every legacy layout (MySQL era; replaced by a PostgreSQL baseline since).
- Server-authoritative games on both platforms.
- An atomic XP economy with anti-farming limits.
- Lifetime-XP levels.
- Working effects for all skills.
- The merged achievement set.
- Web security hardening and the removal of mock data.
- Bot bug fixes (see [CHANGELOG](../CHANGELOG.md)).
- CI and tests.
- Consolidated documentation.

**Improvement pass (unreleased):** the balance rework, ten new classes in all, the new XP sources, quests, prestige, cosmetics, templates, CSV import, search, stats and focus pages, per-task reminders, per-user days, arcade replay verification, optional web push, shared lists and parties, Tailwind 4 and Playwright tests. See the [CHANGELOG](../CHANGELOG.md#unreleased).

**Out of scope:** the items listed under Later in the roadmap.

## 11. Roadmap

| Priority | Item |
|---|---|
| Next | Run the AI evals against real Gemini and grow the golden sets. Runbook: [OPERATIONS](OPERATIONS.md#first-live-gemini-run) |
| Later | Push notifications for AI results |
| Later | More component tests for the web app (the first set exists) |
| Later | Internationalisation (nothing is extracted yet) |
| Later | Screenshots in the README and push delivery tested against real push services (both need a live deployment) |
| Done | Per-task due dates, priorities, tags, subtasks, recurrence; leaderboard boards; reminder time zone and hour; weekly digest; quests; streak freeze; export/import/calendar; light theme; route-level code splitting |
| Done | The class rebalance, five new classes and 96 skills; task bonuses, streak chests, achievement rewards, habit streaks, focus sessions, the weekly review, the monthly boss, rotating quests and prestige; the cosmetics shop |
| Done | CSV import, templates, task search, stats; per-task reminders; per-user days; optional web push |
| Done | Ownership transfer for shared lists; a party board and a focus quest; a Today page, weekly goal and reflection; board and calendar views; previews and skill reset; streak warnings; an archive job and a per-class XP report |
| Done | Shared lists and parties ([shared-lists](design/shared-lists.md)); arcade anti-cheat by replay ([arcade-anti-cheat](design/arcade-anti-cheat.md)); Tailwind 4 ([tailwind-4-migration](design/tailwind-4-migration.md)); Playwright smoke tests |

## 12. Risks and assumptions

| Risk / assumption | Mitigation |
|---|---|
| A script can solve an arcade game offline and submit a valid recording | Replay verification, per-run caps, a 3 s cooldown and the shared daily cap bound the impact to at most 500 XP a day. |
| Old deployments leaked secrets in git history | Fresh-history monorepo. Operators must rotate credentials ([SECURITY.md](../SECURITY.md#1-required-action-rotate-leaked-secrets)). |
| Lifetime XP for pre-4.0 players is reconstructed | The MySQL-era legacy upgrade used max(balance, the stored level's floor), so nobody lost a level. Spending before 4.0 isn't counted. The PostgreSQL database started fresh, so it holds no such players. |
| The level curve is linear, so level-scaled class effects keep growing | A steeper curve was rejected to protect veterans; prestige and the shop are the late-game sinks ([design/balance](design/balance.md)). |
| Class balance rests on estimates, not live data | Rough ranking in [design/balance](design/balance.md); revisit with real XP history. |
| Render free web services sleep | The bot should run as a paid worker; the web app tolerates cold starts. |
| Discord API rate limits on DMs | One reminder per list or task, at most 20 DMs a person an hour (the rest in one digest), marked even when DMs are closed. |
| Invitation probing and spam | One neutral answer for every outcome the inviter must not learn, rate limits per account and address, 30 invitations a day, a decline cooldown and an opt-out. A patient inviter can still tell some cases apart ([SECURITY](../SECURITY.md#known-residual-risks)). |
| Time zone hopping reopens daily caps | A zone change is limited to once every 24 hours (worth about 70 XP a day at most). |
| Web push needs HTTPS, VAPID keys and real push services | Off by default; never replaces the Discord DM; delivery is untested against live push services ([KNOWN_ISSUES](KNOWN_ISSUES.md)). |
| Supabase's pooler allows a limited number of clients | Use the session pooler and keep `DB_POOL_SIZE` small per service ([DEPLOYMENT](DEPLOYMENT.md#2-database)). |
| Spare accounts could farm a party or shared list | Rewards need a member's own work since joining, XP stays with the actor, and the target counts only active members. |

## 13. Glossary

| Term | Meaning |
|---|---|
| **Balance / XP** | Spendable XP (`player_xp`). |
| **Lifetime XP** | XP earned since the last prestige (`lifetime_xp`). It sets the level and is never reduced by spending. |
| **Lifetime XP total** | The never-reset total (`lifetime_xp_total`) behind the XP achievements and the lifetime leaderboard. |
| **Base XP** | The reward before class and skill modifiers. |
| **Class counters** | Per-class state (Assassin streak/stacks, Gambler streak, Wizard counter, Archer streak, Tank stacks, Monk Rhythm, Artisan progress, Necromancer souls). |
| **Flat bonus** | XP paid in its own source with no class or skill modifiers (task bonuses, chests, quests, focus, review). |
| **Free games** | RPS, Hangman and the arcade games, which share the daily free-game XP cap. |
| **Escrow** | The Blackjack bet is deducted when dealt and returned or paid out when the hand settles. |
| **Your day** | A day in the user's time zone (UTC until set); quests, caps and the weekly review follow it. |
| **Party** | Up to six people with one shared weekly quest. |
