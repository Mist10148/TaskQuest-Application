# TaskQuest: Product Requirements Document

| | |
|---|---|
| **Product** | TaskQuest (Discord bot + web app) |
| **Version** | 4.0.0 (monorepo) |
| **Status** | Living document |
| **Audience** | Product owner, developers, contributors, operators |
| **Related** | [ARCHITECTURE](ARCHITECTURE.md) · [GAMEPLAY](GAMEPLAY.md) · [API](API.md) · [COMMANDS](COMMANDS.md) · [KNOWN_ISSUES](KNOWN_ISSUES.md) |

Status legend: **Done** (works as described), **Partial** (works, with a noted gap), **Planned** (not built yet).

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
10. [Release scope: 4.0](#10-release-scope-40)
11. [Roadmap](#11-roadmap)
12. [Risks and assumptions](#12-risks-and-assumptions)
13. [Glossary](#13-glossary)

---

## 1. Summary

TaskQuest turns ordinary to-do lists into RPG-style progression. People create lists, add tasks and complete them, and every meaningful action earns XP. XP drives levels, a daily reward with streaks, seven character classes that change how XP is earned, 27 skills, 33 achievements, daily and weekly quests, and a small game centre where XP can be won or wagered.

TaskQuest is one product with two front ends that share one account (the Discord identity) and one database:

- **The Discord bot** keeps task management where communities already talk. It also sends deadline reminders by DM.
- **The web app** gives a richer dashboard: visual skill trees, a leaderboard, and three browser arcade games.

Before 4.0 these lived in two repositories with duplicated, drifting game logic. Version 4.0 merges them into a monorepo and moves every rule into one shared package, so behaviour is identical everywhere.

## 2. Problem

Task managers are easy to abandon. Motivation fades once checking boxes stops feeling new. Many gamified tools are shallow: they offer a points counter with no consequence, and live in an app people forget to open.

TaskQuest addresses this in three ways:

1. It meets users **where they already are** (Discord), with an optional web dashboard.
2. It uses **mechanics with real trade-offs**:
   - Classes reshape XP gain (steady, random, streak, cyclic, stacking).
   - Skills reward committing to a path.
   - Spending XP on classes, skills or bets makes progress a choice.
3. It **surfaces work without effort**, through deadline reminders and a daily reward loop.

## 3. Goals and non-goals

### Goals

| ID | Goal | Status |
|---|---|---|
| G1 | Create, organise and complete task lists entirely in Discord or on the web | Done |
| G2 | Reward completion with immediate, visible progression (XP, levels, achievements) | Done |
| G3 | Offer strategic choice through classes and skills that change how XP is earned | Done |
| G4 | Bring users back through a daily reward with streaks and deadline reminders | Done |
| G5 | Provide light entertainment through games using the same XP economy | Done |
| G6 | One account and identical rules across bot and web | Done (4.0) |
| G7 | An XP economy that can't be farmed or exploited | Done (4.0), see [KNOWN_ISSUES](KNOWN_ISSUES.md) for residual arcade trust |
| G8 | Safe to operate: no leaked secrets, hardened web surface, reproducible deploys | Done (4.0) |

### Non-goals

- **Team collaboration.** Lists belong to one user. There is no sharing, assignment or comments.
- **Real money.** XP has no cash value and can't be bought, sold or transferred.
- **A full calendar.** Reminders are a single DM on the deadline day. There are no times of day, recurrence or per-task due dates.
- **Native mobile apps.** The web app is responsive, but there is no app-store product.
- **Server moderation features.**
- **Internationalisation.** The product is English only.

## 4. Personas

**P1. Habit Builder.** A student or professional who wants a routine to stick. They care about streaks, the daily reward, reminders and a sense of progress. They rarely play games.

**P2. Min-Maxer.** Enjoys systems. Reads class and skill rules, plans builds, and expects the numbers to be exact, documented and identical on both platforms.

**P3. Discord Regular.** Already lives in a server that uses the bot. Uses the web app for a bigger view and expects the same account and progress.

**P4. Casual Player.** Enjoys a quick game and a small bet, and wants clear odds and fair outcomes.

**P5. Operator.** Deploys and runs TaskQuest. Needs clear configuration, one-command migrations, health checks and a clear security posture.

## 5. User stories

### 5.1 Account and identity

| ID | Story | Acceptance criteria | Status |
|---|---|---|---|
| A1 | As a user, I sign in to the web app with Discord | The `identify` scope only. `state` is verified. A new session ID is issued at login. I land on the dashboard. | Done |
| A2 | As a user, my progress is the same in Discord and on the web | Both read and write the same rows through the same services. | Done |
| A3 | As a user, I can log out | The session is destroyed server-side and the cookie is cleared. | Done |
| A4 | As a logged-out visitor, I see a login screen, never fake data | No mock fallback. API errors show an error state. | Done |
| A5 | As a user, I can reset all my progress | It requires typing `RESET`. The server requires an explicit confirmation body. | Done |

### 5.2 Lists and tasks

| ID | Story | Acceptance criteria | Status |
|---|---|---|---|
| L1 | Create a list with a name, and optionally a description, category, priority and deadline | Name 1–100 chars and unique per user. Deadline is a real `YYYY-MM-DD` date. | Done |
| L2 | Add, rename, describe, complete, reorder and delete tasks | Task name 1–200 chars. Descriptions up to 1000 chars. | Done |
| L3 | Filter lists (all, current, expired, completed, category) and sort them | Available on both platforms. | Done |
| L4 | Search my lists | Matches name, category and description. `%` and `_` are matched literally. | Done |
| L5 | Nobody else can see or change my lists | Every query is scoped to the owner, including clicks on someone else's public `/list` message. | Done |
| L6 | Get a DM on a list's deadline day | Sent once per list, at the user's reminder hour in their own time zone (`/timezone` or web Settings). A reminder missed during an outage is still sent (up to 3 days late), and temporary Discord errors are retried. One more notice follows if tasks are still open the day after. DMs carry Snooze and Stop buttons. Can be turned off with `/automation` or in web Settings. | Done |
| L7 | Have finished lists cleaned up | Deletes a list when every task has been done for 5+ days. Unfinished lists are never deleted, even when overdue. Opt-out in Settings. | Done |
| L8 | Due dates, priorities, tags and subtasks on individual tasks | Own due date and priority (the task's priority drives class and skill effects), up to 5 tags, one level of subtasks. Shown and editable on the web; `/quick` on Discord. | Done |
| L9 | Recurring tasks | Daily, weekly or monthly. Completing one creates the next copy (no creation XP). | Done |
| L10 | Add a task from one line of text | "Finish report fri !high #work every week" is understood on the web (quick-add bar) and in Discord (`/quick`). | Done |
| L11 | Undo a deletion, and act on several tasks at once | Deleting a task hides it with an Undo toast and only deletes when it expires; select mode completes or deletes several. | Done |
| L12 | Export my data, import it back, and see deadlines in my calendar | JSON and CSV export, reward-free JSON import, and a secret iCalendar feed. | Done |
| L13 | A Monday summary of my week | Opt-in DM (`/weekly`), with the AI recap appended when AI is on. | Done |

### 5.3 Progression

| ID | Story | Acceptance criteria | Status |
|---|---|---|---|
| P1 | Earn XP for creating lists, adding tasks and completing tasks | 10, 5 and 10 base XP. Daily caps apply to creation rewards. Completion XP is paid once per task. | Done |
| P2 | Claim a daily reward with a streak bonus | 100 base XP, plus 5 per streak day (max +50), plus skill bonus. 24h cooldown. A 48h window keeps the streak. | Done |
| P3 | Level up from lifetime XP | Level = ⌊lifetime XP / 100⌋ + 1. Spending XP never lowers your level. | Done |
| P4 | Buy and equip classes | The purchase is atomic, so a double click can't charge twice. Switching class resets class counters. | Done |
| P5 | Unlock and level skills | The tree must be owned and the prerequisite unlocked. Cost is charged per level. Every skill has a working effect. | Done |
| P6 | Unlock achievements and see them immediately | Evaluated in the same transaction as the action that earned them. | Done |
| P7 | Turn XP off entirely | The XP toggle stops rewards, purchases and games. Tasks keep working. | Done |
| P8 | Compare with others on a leaderboard | Top 10 on four boards: lifetime XP (default), XP earned this week, daily streak, current balance; optional class filter. Shows the stored display name and avatar, never a Discord ID. Spending XP does not lower the default board. | Done |
| P9 | Work towards daily and weekly quests | Five quests with progress from real activity; one claim per period. | Done |
| P10 | Protect a streak | A 150 XP streak freeze (max 3) saves a streak of 2+ days that a missed day would break. | Done |
| P11 | Be rewarded for spending | Achievements for spending 1,000 / 5,000 / 10,000 XP on classes, skills and freezes. | Done |

### 5.4 Games

| ID | Story | Acceptance criteria | Status |
|---|---|---|---|
| G1 | Play Blackjack for an XP bet | Bet is 10 to min(25% of balance, 1000). Blackjack pays 3:2. Double down is allowed. The hand resumes across platforms. | Done |
| G2 | Play risk-free Rock Paper Scissors | +10 base XP per win. Losses cost nothing. 3s cooldown. | Done |
| G3 | Play free Hangman | Win max(10, 10 × lives left) base XP. All 26 letters are selectable in Discord. | Done |
| G4 | Play arcade games on the web | Snake, Dino and Invaders. XP is capped per run and must be plausible for the run's duration. | Done |
| G5 | Trust that games are fair | The server shuffles with a CSPRNG and decides every outcome. Hidden information never reaches the client. | Done |
| G6 | Never lose a bet to a crash | The bet is escrowed atomically. Abandoned hands expire after 30 minutes and are refunded. | Done |

## 6. Functional requirements

| ID | Requirement | Status |
|---|---|---|
| FR1 | All XP changes go through one service that locks the user row and writes an `xp_transactions` entry | Done |
| FR2 | Lifetime XP is tracked separately from the spendable balance | Done |
| FR3 | Class and skill effects are computed by one shared function on both platforms | Done |
| FR4 | Rewards are capped per UTC day: 10 list creations, 50 task creations and 50 task completions | Done |
| FR5 | Free games (RPS, Hangman, arcade) share a cap of 500 XP per UTC day | Done |
| FR6 | Game state is persisted in `game_sessions.game_data`, so games survive restarts | Done |
| FR7 | Schema changes happen only through versioned migrations, and legacy databases are upgraded automatically | Done |
| FR8 | Bot interactions that show XP or achievements are ephemeral | Done |
| FR9 | The web app and API are served from one origin | Done |
| FR10 | The bot exposes a health endpoint; the web app exposes `/api/health` | Done |

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| **Security** | OWASP-aligned web surface: CSP, frame-ancestors none, CSRF origin and JSON checks, rate limits, zod validation, owner-scoped queries, no stack traces in responses. No secrets in the repository. See [SECURITY.md](../SECURITY.md). |
| **Integrity** | Every purchase or payout runs in one database transaction with row locks. Concurrent clicks can't double-spend or double-pay; integration tests prove this. |
| **Performance** | List overview and leaderboard use single aggregate queries, with no N+1. Bot interactions defer within Discord's 3-second window. |
| **Availability** | Sessions persist in MySQL, so they survive restarts and redeploys. Graceful SIGTERM handling. Background jobs never crash the process. |
| **Portability** | MySQL 8 and MariaDB 10.4+. TLS with certificate verification for cloud databases. |
| **Quality** | CI runs lint, typecheck, build, syntax checks, unit tests, integration tests on MySQL 8, and a production dependency audit. |
| **Accessibility** | Keyboard-usable controls on the web (shortcuts, skip link, focus trap in the mobile drawer, visible focus), labelled icon buttons, `aria-live` status messages, WCAG AA text contrast in both themes (enforced by a test), a reduce-motion setting, and on-screen controls for touch play. |

## 8. Platform parity

| Capability | Bot | Web |
|---|---|---|
| Lists & tasks (CRUD, filter, sort, search) | ✓ | ✓ |
| Daily reward, profile, achievements | ✓ | ✓ |
| Classes & skills | ✓ | ✓ |
| Leaderboard | ✓ | ✓ |
| Blackjack (incl. double down), RPS, Hangman | ✓ | ✓ |
| Snake, Dino Runner, Space Invaders | — | ✓ |
| Deadline reminder DMs | ✓ | Setting only |
| Settings (XP, reminders, auto-delete) | `/toggle`, `/automation` | ✓ (all three) |
| Reset progress | — | ✓ |
| Quests, streak freeze | `/quests`, `/freeze` | ✓ |
| Time zone, reminder hour, weekly digest | `/timezone`, `/weekly` | ✓ |
| Quick add | `/quick` | ✓ (quick-add bar) |
| Subtasks, tags, recurrence, bulk actions | Set through `/quick` and AI | ✓ |
| Export / import / calendar feed | — | ✓ |
| Light and dark theme | — | ✓ |

## 9. Success metrics

| Metric | Target |
|---|---|
| Weekly active users completing ≥ 1 task | Grows week over week |
| Day-7 daily-reward retention | ≥ 30 % of new users |
| Tasks completed per active user per week | ≥ 5 |
| Users active on both platforms | ≥ 25 % of active users |
| XP economy anomalies (balances far above the 99th percentile, or negative balances) | 0 |
| Interaction error rate (bot "Something went wrong" + API 5xx) | < 0.5 % |

## 10. Release scope: 4.0

**In scope:**

- The monorepo with the shared package.
- A unified schema, with migrations from every legacy layout.
- Server-authoritative games on both platforms.
- An atomic XP economy with anti-farming limits.
- Lifetime-XP levels.
- Working effects for all skills.
- The merged achievement set.
- Web security hardening and the removal of mock data.
- Bot bug fixes (see [CHANGELOG](../CHANGELOG.md)).
- CI and tests.
- Consolidated documentation.

**Out of scope:** the features listed as Planned above, and those in the roadmap.

## 11. Roadmap

| Priority | Item |
|---|---|
| Next | Server-side anti-cheat telemetry for arcade games. Design: [arcade-anti-cheat](design/arcade-anti-cheat.md) |
| Next | Run the AI evals against real Gemini and grow the golden sets. Runbook: [OPERATIONS](OPERATIONS.md#first-live-gemini-run) |
| Later | Shared or team lists (needs a permission model). Design: [shared-lists](design/shared-lists.md) |
| Later | Move to Tailwind CSS 4. Plan: [tailwind-4-migration](design/tailwind-4-migration.md) |
| Later | Search inside task descriptions; per-task reminders; push notifications |
| Done in this release | Per-task due dates, priorities, tags, subtasks, recurrence; leaderboard boards; reminder time zone and hour; weekly digest; quests; streak freeze; export/import/calendar; light theme; route-level code splitting |

## 12. Risks and assumptions

| Risk / assumption | Mitigation |
|---|---|
| Arcade games run in the browser, so a determined user can script scores | Server-issued runs, a plausibility rate limit, per-run caps and the shared daily cap bound the impact to at most 500 XP a day. |
| Old deployments leaked secrets in git history | Fresh-history monorepo. Operators must rotate credentials ([SECURITY.md](../SECURITY.md#1-required-action-rotate-leaked-secrets)). |
| Lifetime XP for pre-4.0 players is reconstructed | Migration 002 uses max(balance, the stored level's floor), so nobody loses a level. Spending before 4.0 isn't counted. |
| Render free web services sleep | The bot should run as a paid worker; the web app tolerates cold starts. |
| Discord API rate limits on DMs | One reminder per list, marked even when DMs are closed. |

## 13. Glossary

| Term | Meaning |
|---|---|
| **Balance / XP** | Spendable XP (`player_xp`). |
| **Lifetime XP** | Total XP ever earned (`lifetime_xp`). It sets the level and is never reduced by spending. |
| **Base XP** | The reward before class and skill modifiers. |
| **Class counters** | Per-class state (Assassin streak/stacks, Wizard counter, Archer streak, Tank stacks). |
| **Free games** | RPS, Hangman and the arcade games, which share the daily free-game XP cap. |
| **Escrow** | The Blackjack bet is deducted when dealt and returned or paid out when the hand settles. |
