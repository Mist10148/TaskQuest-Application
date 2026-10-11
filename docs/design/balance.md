# Design: balance

| | |
|---|---|
| **Status** | Implemented as described; the open questions at the end are not decided |
| **Scope** | The level curve, class and skill power, and the caps that bound them |
| **Related** | [GAMEPLAY](../GAMEPLAY.md), [XP_GUIDE](../XP_GUIDE.md), [CLASS_GUIDE](../CLASS_GUIDE.md), `packages/shared/src/constants.js`, `packages/shared/src/xp.js` |

This note records why the numbers are what they are, how the class ranking was estimated, and what is still unsettled. It is not a promise that the ranking is fair: it was derived from the formulas in `xp.js`, not from player data.

## Method

Class power was estimated by running the shared `calculateFinalXP` for a task with 10 base XP, five completions a day on a 7-day daily streak, with a fixed random seed, and averaging the result after a warm-up (the figures in [CLASS_GUIDE](../CLASS_GUIDE.md)). "Multiplier" below is that average divided by the base of 10. It is a per-task view: flat bonuses ([XP_GUIDE](../XP_GUIDE.md)) are identical for every class and are not in it. A throwaway script produced the numbers; it is not part of the repository, so re-derive them with the same calls if the formulas change (the docs test only checks the constants, not these estimates).

## The level curve stays linear

A level costs 100 lifetime XP (`XP_PER_LEVEL`). A steeper curve (for example 100 × n^1.3 per level) was designed and **not shipped**.

Reasons:

- **Nobody's level may drop.** A new curve either lowers the level that existing XP maps to, or needs a rule such as "level = the larger of the stored and the computed level", after which the level no longer follows from XP and progress bars, prestige and the level achievements disagree with each other. A flat curve keeps `level = ⌊lifetime XP / 100⌋ + 1` true for everyone, including the veterans reconstructed by migration 002.
- **Level-scaled effects were tuned against it.** Wizard's Wisdom (level × 5), the Tank shield cap (3 + level ÷ 3, max 15), the Archer hit chance (80% + 0.5% × level) and Hero's Oath (25 + level, max 50) assume levels arrive at today's rate. Slowing levels would quietly nerf all of them.
- **Prestige and the shop are the late-game sinks.** Level 30 (2,900 lifetime XP) is the prestige gate, and cosmetics cost 200 to 2000 XP. A steeper curve would be a second, overlapping sink.

The cost is that levels themselves are cheap, which is why level carries so little weight: it gates a few cosmetics (levels 5, 10, 15 and 20) and prestige, and scales the four effects above.

## Class power ranking (estimate)

Average multiplier on a 10 base XP task, from the simulation described above.

| Class (price) | No skills, plain task, level 5 / 15 / 30 | No skills, favourable mix | Full tree (all skills), favourable mix |
|---|---|---|---|
| Default (0) | 1.0 | 1.0 | 1.2 |
| Hero (500) | 3.5 | 3.5 | 18.7 (includes Champion's ×2: those levels are multiples of 5) |
| Gambler (300) | 5.2 | 5.2 | 7.9 |
| Assassin (400) | 1.5 | 1.5 | 3.8 |
| Wizard (700) | 2.5 / 5.5 / 10.0 | same | 10.1 / 20.1 / 35.1 |
| Archer (600) | 5.2 / 5.6 / 5.9 | same | about 10.7 |
| Tank (500) | 1.3 / 1.7 / 2.1 | same | 3.5 / 3.9 / 4.3 |
| Monk (550) | 2.8 | 2.8 | 12.5 |
| Artisan (650) | 3.0 | 2.6 (lists of 10) | 7.4 |
| Ranger (600) | 1.3 | 1.9 (3 days early) | 3.7 |
| Necromancer (600) | 1.0 | 2.0 (every third task overdue) | 3.8 |
| Paladin (750) | 1.5 | 2.3 (every second task HIGH) | 3.8 |

Assumptions behind it:

- A player completes tasks at a steady pace every day; classes with counters (Assassin, Tank, Monk, Artisan) sit at or near their caps.
- "Favourable mix" is the situation each class is designed for. It is generous for Necromancer (it needs a backlog) and Ranger (it needs due dates set a day ahead).
- Skills are bought in tree order and the whole tree is bought. Prices are 50 to 360 XP per skill level, so a full tree costs 1,220 to 1,910 XP.
- A full-tree Wizard at level 30 (35×) is the highest figure in the table, while at level 5 it is among the weakest paid classes; that is the intended "strongest late" promise.

## Caps that bound all of it

Class strength only changes how fast XP arrives, because the volume is capped:

| Limit | Value |
|---|---|
| Rewarded task completions a day | 50, so modified XP from completions is at most 50 × the per-task average (500 XP at Default, 1,750 at an unskilled Hero) |
| Rewarded additions and list creations | 50 and 10 a day |
| Free games (RPS, Hangman, arcade) | 500 XP a day, then trimmed after class bonuses |
| Flat task bonuses | `first_of_day` 10, `list_cleared` 5 × 25, `early_finish` + `overdue_clear` 100, `subtasks_done` 10, `habit_bonus` 60: at most 405 XP a day with focus (100) |
| Streak chest, daily | 100 + 50 streak bonus plus the chest on milestone days |
| Blackjack | No bonuses; flat 1:1, bet up to min(25% of balance, 1000) |

Flat sources ignore classes by design, so the daily total of a Default player is not far behind a modified class on most days; the class advantage is mostly in the XP of single actions and in how fast sinks are afforded. Prestige adds +2% per prestige to modified XP only, a deliberately small number.

## Open questions

These are undecided; changing any of them is a balance change that needs a GAMEPLAY update and a test.

1. **Gambler and Archer at about 5×.** With no skills they already pay five times the base, more than most full trees of the conditional classes. Gambler costs only 300 XP, the cheapest class. Is the variance penalty enough, or should the bonus range (0 to base + 99) scale less with the flat 99?
2. **Hero's Champion.** The 3× cap only bites on 5 XP actions (adding a task gets +15 instead of +25), so Hero is 3.5× on a completion. The full tree is about 9× at most levels but 18.7× on every fifth level, because Champion doubles it; that doubling may be too strong.
3. **The Artisan's project reset.** Clearing a list sets progress back to 0, so in the model clearing lists of ten pays less (2.6×) than never clearing (3.0×). The class is designed to reward finishing lists but can punish it. Either keep part of the progress or raise the clear bonus.
4. **Priority labels are unverified.** Paladin, Archer's Sniper, Hero's Rally and the Heavy Lifter quest trust the HIGH priority the player sets. Nothing stops marking everything HIGH.
5. **Overdue as a resource.** Necromancer pays for overdue tasks and is meant for backlogs, but the bonus also rewards leaving tasks to lapse (capped at 30 XP of days overdue, and the 24-hour due-date rule blocks backdating).
6. **Weak early game.** Tank (1.3×), Ranger without due dates (1.3×) and Necromancer without overdue tasks (1.0×) start at or near Default; the Wizard is at 2.5× at level 5. Cheaper first skills could help, or the class prices (500 to 700) could be lowered.
7. **A flat level curve.** If level should matter more, the tunable pieces are the gate for prestige and cosmetics, not the curve itself (see above).
8. **Prestige power.** +2% per prestige (max +20%) on class-modified XP only. Players who prestige lose their classes and skills, so the bonus may be too small to attract anyone. Measure how many players reach 30 first.
9. **No data yet.** Everything above is derived from the formulas. Compare it with real `xp_transactions` (XP per action by class) once there is history.
