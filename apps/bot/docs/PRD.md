# TaskQuest Bot: Product Requirements Document

**Version:** 3.8.3 (as built) · **Status:** Living document · **Audience:** product owner, developers, contributors

Status labels used throughout:

- **Implemented:** present in the code and working as described.
- **Partial:** present but incomplete, or with known defects listed in [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
- **Proposed:** not built yet.

---

## 1. Overview

TaskQuest is a Discord bot for personal and small-group task management. It applies RPG-style progression to ordinary to-do lists, so that finishing work earns experience, levels, classes, skills and achievements. A short mini-game centre gives players a way to spend or win that experience.

Everything happens inside Discord through slash commands, buttons, select menus and modals. No separate app is required. An optional web dashboard is linked through `/app`, but it is not part of this codebase.

## 2. Problem statement

Task managers are easy to abandon. Users open them once, add a few items, and stop. Gamified productivity tools exist, but most are standalone apps that people must remember to open. Users who already spend their day in Discord have no lightweight, in-context way to track tasks with some reward for finishing them.

TaskQuest addresses this by keeping task management inside Discord, using small rewards to create momentum, and using deadline reminders so that work surfaces without the user opening anything.

## 3. Goals

| ID | Goal | Status |
|---|---|---|
| G1 | Let a user create, organise and complete task lists entirely inside Discord. | Implemented |
| G2 | Reward task completion with visible progression (XP, levels, classes, achievements). | Implemented |
| G3 | Provide light, low-stakes entertainment that uses the same XP economy. | Implemented |
| G4 | Remind users about lists due today without requiring them to check. | Implemented |
| G5 | Keep the bot responsive on Discord and on remote, latency-prone databases (TiDB Cloud). | Partial |
| G6 | Make progression meaningful. Each skill and achievement should change play in some visible way. | Partial |

## 4. Non-goals

- **Team collaboration.** Lists belong to one user. There is no sharing, assignment or comments.
- **Real-money or tradable currency.** XP is the only currency and cannot be bought or traded.
- **Full calendar or reminder system.** Reminders are a single daily DM for lists due today. There are no times of day, recurrence or per-item due dates.
- **Web app.** The `/app` command links to an external dashboard. This repository does not implement it.
- **Moderation.** The bot has no server moderation features.

## 5. Users and personas

**Solo organiser.** Uses one or two lists for personal work or study. Wants a light reward loop and a reminder for deadlines. Typically uses `/list`, `/daily` and `/profile`.

**Gamer.** Enjoys progression systems. Chooses classes, buys skills and chases achievements. Plays `/game` for variety. Checks `/leaderboard` and `/achievements`.

**Server member.** Shares a Discord server with the others who use the bot. Compares progress on the leaderboard and sees public profiles.

**Server operator.** Installs and runs the bot. Needs clear setup, command deployment and database configuration. Uses [DEPLOYMENT.md](DEPLOYMENT.md).

## 6. User stories

Stories are grouped by area. Each has a status.

### 6.1 Lists and tasks

| ID | As a… I want to… | Status |
|---|---|---|
| L-1 | create a named list with an optional description, deadline and category | Implemented |
| L-2 | set a priority (Low, Medium, High) on a list | Implemented |
| L-3 | add, rename, describe, complete and delete items in a list | Implemented |
| L-4 | reorder items by swapping two positions | Implemented |
| L-5 | filter the overview by All, Current, Expired, Completed, or category | Implemented |
| L-6 | sort the overview by name, creation date or priority | Implemented |
| L-7 | sort items A-Z, Z-A, or incomplete first | Implemented |
| L-8 | search lists by name | Partial. The search query references a `notes` column that does not exist. See KNOWN_ISSUES. |
| L-9 | rename a list and change its deadline | Implemented |
| L-10 | delete a list after confirming | Implemented. Deletion removes all items. |
| L-11 | see a progress bar for each list | Implemented |
| L-12 | set due dates and priorities on individual items | Proposed |
| L-13 | recurring tasks | Proposed |
| L-14 | share a list with another user | Proposed |
| L-15 | have old completed lists cleaned up automatically | Partial. Runs daily for users with the setting enabled, but there is no command to change the setting. |

### 6.2 Progression and gamification

| ID | As a… I want to… | Status |
|---|---|---|
| P-1 | earn XP for creating lists (10), adding items (5) and completing items (8) | Implemented. Toggling an item repeatedly can award XP each time. See KNOWN_ISSUES. |
| P-2 | claim a daily reward with a streak bonus | Implemented |
| P-3 | see my level, XP toward the next level, focus rate and tasks done on `/profile` | Implemented |
| P-4 | choose from seven classes, each with a different XP modifier | Implemented |
| P-5 | buy a class with XP and switch between owned classes freely | Implemented |
| P-6 | spend XP on skills in a class tree | Partial. Many skills have no effect. |
| P-7 | earn achievements and see them on `/achievements` | Partial. Some achievement checks are called incorrectly. See KNOWN_ISSUES. |
| P-8 | see a leaderboard of the top 10 players by XP | Implemented. Global, not per server. |
| P-9 | turn XP off without losing my lists | Implemented |
| P-10 | earn XP that reflects my real effort, not repetitive toggling | Proposed |

### 6.3 Games

| ID | As a… I want to… | Status |
|---|---|---|
| G-1 | play Blackjack with an XP bet, using a standard deck | Implemented. Requires `schema.sql` tables. |
| G-2 | resume a Blackjack hand after restarting Discord | Implemented. Sessions persist in the database. |
| G-3 | play Rock-Paper-Scissors for a small XP reward | Implemented |
| G-4 | play Hangman with six lives and a reward that depends on lives left | Implemented. Game state is in memory and is lost on restart. |
| G-5 | see my game history and win rate on `/profile` | Partial |

### 6.4 Reminders and automation

| ID | As a… I want to… | Status |
|---|---|---|
| R-1 | get a DM each hour about lists due today | Implemented. Only for users with `/automation` enabled. |
| R-2 | turn reminders on or off | Implemented |
| R-3 | choose the time of day for reminders | Proposed |
| R-4 | have game sessions expire automatically | Implemented. Sessions expire after 30 minutes. |

### 6.5 Discovery and help

| ID | As a… I want to… | Status |
|---|---|---|
| D-1 | see every command in one place | Implemented (`/help`) |
| D-2 | check that the bot is responsive | Implemented (`/ping`) |
| D-3 | open the web dashboard from Discord | Implemented (`/app`). The URL is configurable. |

## 7. Functional requirements

### 7.1 Task management

- A list belongs to one Discord user and has a unique name per user.
- Name is required, up to 100 characters. Description is free text. Category is up to 50 characters. Deadline is a calendar date in `YYYY-MM-DD` form.
- A deadline in the wrong format is silently dropped, and the list has no deadline.
- Priority is `LOW`, `MEDIUM`, `HIGH` or none.
- Items have a name (up to 200 characters), an optional description, a completion flag and a position in their list.
- Completing an item awards XP when gamification is on. Un-completing an item awards nothing.
- Deleting a list deletes its items.

### 7.2 Gamification

- Level is `floor(XP / 100) + 1`.
- Daily reward: base 100 XP, claimable once every 24 hours, with a streak bonus of `min((streak - 1) × 5, 50)`. A streak continues if the previous claim was within 48 hours.
- Classes are bought once with XP and remain owned. Equipping an owned class resets its internal counters.
- Skills are bought with XP, can be upgraded up to a maximum level, and some require another skill first.
- Achievements are unlocked once and stored per user.
- The leaderboard shows users with gamification enabled, sorted by XP.

### 7.3 Games

- Games use XP as currency. An active game takes the bet at the start.
- Blackjack has a minimum bet of 10 XP. The maximum bet is defined as 25% of balance, capped at 1000 XP. The limit is not enforced in the current code path (KNOWN_ISSUES).
- Rock-Paper-Scissors and Hangman do not require a bet.
- A game session for a user and game type is unique while active. Sessions expire after 30 minutes.

### 7.4 Reminders

- Every hour, the bot finds lists whose deadline is today (UTC date), whose reminder has not been sent, and whose owner has automation enabled.
- It sends a DM summary for each list and marks the list as notified. A list is notified once per deadline. Editing the list resets the flag.

### 7.5 Commands and interaction

- Every feature is reachable through slash commands and component interactions. Message content commands do not exist.
- Ephemeral responses are used for personal state: XP results, achievements, class and skill purchases, games, and settings. Public responses are used for `/profile`, `/leaderboard`, `/help`, and list views.

## 8. Non-functional requirements

| Area | Requirement | Current state |
|---|---|---|
| Responsiveness | Commands acknowledge within Discord's 3-second limit. Slow database operations use deferred replies. | Partial. Game handlers defer. Many list and gamification handlers do not defer. |
| Availability | The bot should restart cleanly after a crash and keep running after database errors at startup. | Partial. Startup database failures are logged and the bot continues. There is no SIGTERM handler. |
| Data integrity | XP changes should not lose or double-count value. | Partial. Game payouts use a locked transaction. Daily reward and class purchases do not. |
| Security | Secrets come from the environment. Users may only change their own lists. | Partial. List-level actions check ownership. Item-level actions do not. |
| Privacy | Personal state is ephemeral by default. | Implemented for most personal features. |
| Portability | Runs on MySQL 8, MariaDB and TiDB Cloud. | Partial. Some migrations use MariaDB syntax. |
| Operability | Setup and deployment are documented. | Implemented in these docs. |

## 9. Success metrics

These are suggested measures. The codebase does not collect analytics.

- **Activation:** share of servers where at least one list is created within 7 days of install.
- **Retention:** share of users who claim `/daily` in week 2 after their first claim.
- **Engagement:** completed items per active user per week.
- **Reward health:** share of users who buy at least one class. A very low value suggests the XP economy is too tight.
- **Reminder usefulness:** share of reminded lists that are completed by the deadline.

## 10. Constraints and assumptions

- Discord rate limits and interaction timing apply. Every interaction must be acknowledged within three seconds.
- All state for interactions is in the database except a few in-memory maps: list pagination, achievement pagination, class browser state, Hangman games, and list reorder selection. These are lost on restart.
- The bot runs as one process. There is no clustering or sharding.
- Deadlines and reminders use the UTC date.
- The database connection pool is fixed at 10 connections in code.
- The leaderboard and profile rely on Discord member and user lookups, which can fail for users who have left a server.

## 11. Release scope

### Shipped in 3.8.3

Everything marked Implemented or Partial in section 6, including the 12 slash commands, seven classes, 29 achievements, three mini-games, daily reward, hourly reminders, and the MySQL / TiDB persistence layer.

### Proposed next

1. Fix the defects in [KNOWN_ISSUES.md](KNOWN_ISSUES.md), starting with the achievement check signature and the missing skill effects.
2. Item-level due dates and priorities (L-12).
3. Server-wide leaderboard scope and per-server reminder time (R-3).
4. Graceful shutdown on SIGTERM, for Render deployments.
5. Remove or consolidate the duplicate gamification module.

## 12. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Achievements silently fail to unlock | Players lose progression feedback | Fix the signature and field names (KNOWN_ISSUES #1) |
| Skill purchases cost XP without effect | Players feel cheated | Implement effects or hide unimplemented skills |
| XP farming by toggling items | Economy inflation | Count completion once per item, or add a cooldown |
| In-memory game state lost on restart | Hangman progress lost | Persist Hangman sessions, as Blackjack already does |
| Discord API changes | Commands break | Track discord.js releases |
| Database schema drift between auto-create and `schema.sql` | Blackjack fails on fresh installs | Make auto-create complete, or document the step clearly |

## 13. Open questions

1. Should XP be scoped per server, or stay global per user?
2. Should skill purchases be refunded when a skill is found to have no effect?
3. Is the 20% Gambler loss chance intended to be part of the design?
4. Should reminders go to a server channel as well as DMs?
5. Which hosting target is primary: Render worker, or a long-running VM?

## 14. Glossary

- **XP:** experience points. The only currency.
- **Class:** a progression path with its own XP modifier, bought once with XP.
- **Skill:** an upgrade within a class tree, bought with XP.
- **Streak:** consecutive daily claims.
- **Session:** an active game. Blackjack sessions persist in the database.
- **Ephemeral:** a Discord reply visible only to the user who triggered it.
