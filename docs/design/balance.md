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

## Class power ranking (estimate, after the balance passes)

Average multiplier on a 10 base XP task, from the simulation described above.

| Class (price) | No skills, plain task, level 5 / 15 / 30 | No skills, favourable mix | Full tree (all skills), favourable mix |
|---|---|---|---|
| Default (0) | 1.0 | 1.0 | 1.2 |
| Hero (500) | 3.5 | 3.5 (every second task HIGH) | 13.6 |
| Gambler (450) | 3.4 | same | 5.0 |
| Assassin (400) | 1.8 | same | 4.4 |
| Wizard (700) | 1.6 / 2.8 / 4.6 | same | 5.7 / 9.7 / 15.7 |
| Archer (600) | 3.3 / 3.5 / 3.8 | 3.3 / 3.5 / 3.8 (every second task HIGH) | 7.5 / 7.6 / 7.8 |
| Tank (500) | 1.7 / 2.2 / 2.7 | same | 4.1 / 4.6 / 5.3 |
| Monk (550) | 2.6 | same | 6.4 |
| Artisan (650) | 3.0 | 3.5 (lists of 10) | 8.6 |
| Ranger (600) | 1.5 | 2.2 (3 days early) | 4.0 |
| Necromancer (600) | 1.4 | 2.4 (every third task overdue) | 4.5 |
| Paladin (600) | 1.8 | 2.5 (every second task HIGH) | 4.6 |

Assumptions behind it:

- A player completes tasks at a steady pace every day; classes with counters (Assassin, Tank, Monk, Artisan) sit at or near their caps.
- "Favourable mix" is the situation each class is designed for. It is generous for Necromancer (it needs a backlog) and Ranger (it needs due dates set a day ahead).
- Skills are bought in tree order and the whole tree is bought. Prices are 50 to 360 XP per skill level, so a full tree costs 1,220 to 1,910 XP.
- A full-tree Wizard at level 30 (about 16×) is still the highest figure in the table, while at level 5 it is among the weakest paid classes; that is the intended "strongest late" promise, now at a more reasonable height than the 35× it used to reach.

## Small actions are capped

Adding a task (base 5) and creating a list (base 10) used to take the full class bonus. A Monk's Rhythm bonus or a Wizard's Burst is a flat amount, so a 5 XP action could pay 100 XP or more, and the 50 rewarded additions a day were worth nearly as much as the completions: about 5,400 XP a day for a full-tree Monk and about 15,000 for a level-29 Wizard, against 300 for Default. Adding is free and needs no finishing, so it was the cheapest source. `SMALL_ACTION_CAP` now limits the whole result of those two actions to 4 × the base, the same idea as the Hero's 3 × cap. `scripts/balance-sim.js` reports the capped daily totals.

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

Flat sources ignore classes by design, so the daily total of a Default player is not far behind a modified class on most days; the class advantage is mostly in the XP of single actions and in how fast sinks are afforded. Prestige adds +2% per prestige to modified XP plus +1 flat XP per prestige on task completions.

## Open questions

These are undecided; changing any of them is a balance change that needs a GAMEPLAY update and a test.

1. **Gambler and Archer (addressed).** They paid about 5× the base with no skills. The Gambler's bonus range is now 0 to (2 × base + 40) and the class costs 450 XP, the Archer's streak, headshot and perfect-shot numbers were cut: about 3.4× and 3.5× unskilled. Re-check with real data.
2. **Hero's Champion (addressed).** Champion is +50% instead of ×2 and works only while the Hero is equipped; Legendary is +15%. The full tree is 8.2× at most levels and 12.3× on every fifth level.
3. **The Artisan's project reset (fixed).** Clearing a list used to set progress back to 0, so in the model clearing lists of ten paid less (2.6×) than never clearing (3.0×). A clear now keeps half the progress and pays +8 per progress instead of +5.
4. **Priority labels are unverified (bounded).** Paladin, Archer's Sniper, Hero's Rally and Crusade trust the HIGH priority the player sets, so only the first 3 HIGH completions of a day count as HIGH for them (`LIMITS.HIGH_BONUS_PER_DAY`). Nothing stops marking everything HIGH, but it no longer pays past three tasks a day.
5. **Overdue as a resource.** Necromancer pays for overdue tasks and is meant for backlogs, but the bonus also rewards leaving tasks to lapse (capped at 30 XP of days overdue, and the 24-hour due-date rule blocks backdating).
6. **Weak early game (addressed in part).** Tank now starts at 1.7× (cap `min(15, 5 + level ÷ 3)`, +7% per stack), the Ranger without due dates at 1.5×, the Necromancer without overdue tasks at 1.4× (a soul every 10th task) and the Wizard at 1.6× at level 5 (the Wizard is still meant to be weak early). Cheaper first skills (Fortify 70) were used for the Tank.
7. **A flat level curve.** If level should matter more, the tunable pieces are the gate for prestige and cosmetics, not the curve itself (see above).
8. **Prestige power.** +2% per prestige (max +20%) on class-modified XP plus +1 flat XP per prestige on task completions (max +10; the percentage alone rounded away on small rewards). Players who prestige lose their classes and skills, so the bonus may still be too small to attract anyone. Measure how many players reach 30 first.
9. **No data yet.** Everything above is derived from the formulas. Compare it with real `xp_transactions` (XP per action by class) once there is history.
