# How XP is earned

One page that answers "where does my XP come from, how much, and what limits it?". Every number comes from [`packages/shared/src/constants.js`](../packages/shared/src/constants.js); the exact rules and edge cases are in [GAMEPLAY.md](GAMEPLAY.md), and a test fails if the two disagree. Days, weeks and months below are **yours** (your time zone, UTC until you set one), except where noted.

## Two kinds of XP

- **Modified XP** is a *base* amount that your class and skills reshape (and the prestige bonus multiplies). Only creating lists, adding tasks, completing tasks, the daily reward and the free games are modified.
- **Flat XP** is paid exactly as listed, whatever your class or skills. Bonuses, chests, quests, focus, the review and achievement rewards are flat.

Spending never lowers your level (levels come from lifetime XP), and XP you only get back (a returned bet, a refund) never counts as lifetime XP.

## Every source

| Source (`xp_transactions.source`) | Amount | Daily or period cap | Class and skill modifiers |
|---|---|---|---|
| `list_create` | 10 base | First 10 rewarded creations a day | Yes |
| `item_add` | 5 base | First 50 rewarded additions a day | Yes |
| `item_complete` | 10 base | Once per task, ever; first 50 rewarded completions a day | Yes |
| `daily` | 100 base, plus a streak bonus of 5 per streak day after the first (max +50), plus Early Bird (+10 a level) and Daily Surprise (15% for +50) | One claim per 24 hours | The 100 base only; the streak bonus, Early Bird and Surprise are flat |
| `streak_chest` | +100 / +250 / +600 at a 7 / 14 / 30 day streak | Once per streak run | No |
| `first_of_day` | +10 for the first task you complete each day | Once a day | No |
| `list_cleared` | +25 when your completion leaves a list of 3+ top-level tasks all done | Once per list, ever; 5 lists a day | No |
| `early_finish` | +5 per day early, max +20 per task | Shares 100 XP a day with `overdue_clear` | No |
| `overdue_clear` | +10 for completing an overdue task | Shares 100 XP a day with `early_finish` | No |
| `subtasks_done` | +10 for finishing the last open subtask of a parent | Once per parent; 10 XP a day | No |
| `habit_bonus` | +2 per step of a repeating task's habit streak from a streak of 2, max +20 per completion | 60 XP a day | No |
| `perfect_day` | +30 when every top-level task due today on your own lists is done (at least 3) | Once a day | No |
| `inbox_zero` | +40 when your completion clears the last overdue task, after 3 overdue tasks cleared that week | Once a week | No |
| `boss_defeated` | +30 for the last open subtask of a task with at least 4 subtasks | Once per task, 60 XP a day | No |
| `comeback` | +25 for the first completion after 3 idle days | Once a week | No |
| `party_assist` | +3 per completion while you are in a party of two or more | 15 XP a day | No |
| `estimate_accuracy` | +10 for a task with an estimate finished within 10 minutes after a focus session of about that length (within 25%) | 30 XP a day | No |
| `reflection` | +10 for a one-line note about your day | Once a day | No |
| `weekly_goal` | 10 + 2 per task of the goal you set (3 to 60 tasks), max 80 | Once a week | No |
| `achievement_reward` | +25 per newly unlocked achievement | Each achievement once (33 in total) | No |
| `focus_session` | floor(minutes × 0.6) for a 10 to 90 minute session | 100 XP and 8 sessions a day | No |
| `weekly_review` | +40 after finishing at least one task that week | Once a week | No |
| `quest_reward` | Daily 15 / 25 / 30, weekly 80 / 120 and the rotating quest 50 to 80, monthly boss 400 ([GAMEPLAY §5b](GAMEPLAY.md#5b-quests)) | Once per quest per period | No |
| `party_quest` | +60 for the party weekly quest | Once per person per week (UTC week), after 6 tasks of your own | No |
| `game_reward` | RPS win 10 base; Hangman max(10, 10 × lives left) base; arcade points × rate (Snake 2, Dino 1, Invaders 3 per point, max 100 / 100 / 150 per run; a run under 5 seconds of play pays nothing) | 500 XP a day across all free games, 3 s cooldown | Yes (then trimmed to the remaining allowance) |
| `blackjack_win`, `blackjack_blackjack` | Winnings: 1:1, or 3:2 for a natural | Bet 10 to min(25% of balance, 1000) | No (flat on purpose) |

Task bonuses (`first_of_day` to `subtasks_done`, `habit_bonus`, `perfect_day`, `inbox_zero`, `boss_defeated`, `comeback`, `party_assist`, `estimate_accuracy`) are paid only on a task's **first, paid completion**: un-checking and re-checking pays nothing, neither does a completion over the 50-a-day cap, and imported tasks and auto-created repeat copies never earn them. An *early* or *overdue* effect needs a due date that was set at least 24 hours before the completion. Imports, templates and exports never pay XP.

Giving a skill tree back refunds 75% of its cost as a plain balance credit (`skill_refund`, never lifetime XP), once a day.

Spending sinks: classes (400 to 700), skills (50 to 360 a level), streak freezes (150, or 120 with Freeze Cache), cosmetics (200 to 2000), Blackjack bets. Prestige empties your balance.

## Order of calculation

For a modified reward:

1. **Class mechanic** turns the base into a class result (Hero adds its flat bonus, Wizard a combo or burst, Monk its Rhythm bonus, and so on).
2. **Multiplier** = 1 + percentage skills (Quick Learner, Inspire, Legendary, Focus, Steady Aim, Momentum, Scholar, Night Shift, Bleed), added together and limited to +75%, + the class-gated bonuses (Execute, Revenge, Crusade), which are not limited, + the prestige bonus (+2% each, not limited). These are added together, not multiplied.
3. **Final** = ⌊class result × multiplier⌋ + flat skill bonuses (Valor, Fortify, Arcane Study, which only work with their own class; on task completions also Multishot (Archer only), Rally, Anchor and the prestige flat bonus of +1 per prestige).
4. **Champion** (Hero only) adds 35% when your level is a multiple of 5.
5. **Critical hit** (Assassin skill) adds +50% (+100% with Shadow Step) and arms Bleed.
6. **Double Down** may double it, then **Jackpot** may multiply it by 10.
7. For adding a task and creating a list, the whole result is capped at 4 × the base (20 XP and 40 XP), so class bonuses cannot turn the free, repeatable actions into the best source.
8. For free games, the result is trimmed to what is left of the day's 500 XP allowance.

Flat bonuses are added afterwards by their own source, and each one checks its own cap against the XP it already paid today.

Example (Hero with Valor 3 and Inspire 2, base 10): the class result is 10 + 25 = 35; the multiplier is 1 + 2 × 0.08 = 1.16; ⌊35 × 1.16⌋ = 40, plus 3 × 10 flat from Valor makes **70 XP** for a plain task.

## A worked day

A Default-class player on day 7 of a streak, no skills: creates a list (10), adds five tasks (5 × 5 = 25), completes all five (5 × 10 = 50), which also earns first task of the day (10) and list cleared (25). They claim the daily reward (100 + 30 streak bonus = 130, plus the day-7 chest of 100), and the quests *Daily Grind* (30) and *Planner* (15). That is **395 XP** before any achievement rewards (+25 each). Most of it is flat, which is why the classes matter less for the daily total than for each single task: see [design/balance.md](design/balance.md).

## Related

- [GAMEPLAY.md](GAMEPLAY.md): the full rules, tables for classes, skills and quests.
- [CLASS_GUIDE.md](CLASS_GUIDE.md): which class suits which habits.
- [PLAYER_FAQ.md](PLAYER_FAQ.md): streaks, freezes, XP off, time zones.
