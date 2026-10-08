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

TaskQuest turns ordinary to-do lists into RPG-style progression. People create lists, add tasks and complete them, and every meaningful action earns XP. XP drives levels, a daily reward with streaks, seven character classes that change how XP is earned, 27 skills, 30 achievements, and a small game centre where XP can be won or wagered.

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
| L6 | Get a DM on a list's deadline day | Sent once per list. It can be turned off with `/automation` or in web Settings. | Done |
| L7 | Have finished or long-expired lists cleaned up | Applies when every task has been done for 5+ days, or the deadline passed 5+ days ago with work unfinished. Opt-out in Settings. | Done |
| L8 | Due dates and priorities on individual tasks | Not built. | Planned |
| L9 | Recurring tasks | Not built. | Planned |

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
| P8 | Compare with others on a leaderboard | Top 10 by XP. Shows the stored display name and avatar, never a Discord ID. | Done |

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
| FR4 | Creation rewards are capped per UTC day: 10 lists and 50 tasks | Done |
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
| **Accessibility** | Keyboard-usable controls on the web, and text equivalents for emoji-only buttons in games. |

## 8. Platform parity

| Capability | Bot | Web |
|---|---|---|
| Lists & tasks (CRUD, filter, sort, search) | ✓ | ✓ (search: Planned) |
| Daily reward, profile, achievements | ✓ | ✓ |
| Classes & skills | ✓ | ✓ |
| Leaderboard | ✓ | ✓ |
| Blackjack (incl. double down), RPS, Hangman | ✓ | ✓ |
| Snake, Dino Runner, Space Invaders | — | ✓ |
| Deadline reminder DMs | ✓ | Setting only |
| Settings (XP, reminders, auto-delete) | `/toggle`, `/automation` | ✓ (all three) |
| Reset progress | — | ✓ |

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
| Next | Web list search UI; per-task due dates and priorities; leaderboard tabs (lifetime XP, streaks) |
| Next | Server-side anti-cheat telemetry for arcade games (input replays or signed checkpoints) |
| Later | Recurring tasks; reminder time-of-day; weekly summary DM |
| Later | Shared or team lists (would require a permission model) |
| Later | Code-split the web bundle; move to Tailwind CSS 4 |

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
