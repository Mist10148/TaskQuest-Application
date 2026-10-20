# Design: balance

| | |
|---|---|
| **Status** | Implemented as described; the balance pass of October 2026 applied the changes marked "addressed" in the open questions |
| **Scope** | The level curve, class and skill power, and the caps that bound them |
| **Related** | [GAMEPLAY](../GAMEPLAY.md), [XP_GUIDE](../XP_GUIDE.md), [CLASS_GUIDE](../CLASS_GUIDE.md), `packages/shared/src/constants.js`, `packages/shared/src/xp.js` |

This note records why the numbers are what they are, how the class ranking was estimated, and what is still unsettled. It is not a promise that the ranking is fair: it was derived from the formulas in `xp.js`, not from player data.

## Method

Class power was estimated by running the shared `calculateFinalXP` for a task with 10 base XP, five completions a day on a 7-day daily streak, with a fixed random seed, and averaging the result after a warm-up (the figures in [CLASS_GUIDE](../CLASS_GUIDE.md)). "Multiplier" below is that average divided by the base of 10. It is a per-task view: flat bonuses ([XP_GUIDE](../XP_GUIDE.md)) are identical for every class and are not in it. `scripts/balance-sim.js` (`npm run balance`) produces the numbers from `packages/shared/src/simulate.js`, and `packages/shared/test/balance.test.js` keeps every class inside the bands below, so a change that makes a class too strong or too weak fails a test. They are still estimates, not player data.

## The level curve stays linear

A level costs 100 lifetime XP (`XP_PER_LEVEL`). A steeper curve (for example 100 × n^1.3 per level) was designed and **not shipped**.

Reasons:

- **Nobody's level may drop.** A new curve either lowers the level that existing XP maps to, or needs a rule such as "level = the larger of the stored and the computed level", after which the level no longer follows from XP and progress bars, prestige and the level achievements disagree with each other. A flat curve keeps `level = ⌊lifetime XP / 100⌋ + 1` true for everyone, including the veterans reconstructed by the old MySQL migration `002_upgrade_legacy` (squashed into `001_baseline`).
- **Level-scaled effects were tuned against it.** Wizard's Wisdom (level × 2, capped at 50), the Tank shield cap (3 + level ÷ 3, max 15), the Archer hit chance (80% + 0.5% × level) and Hero's Oath (25 + level, max 50) assume levels arrive at today's rate. Slowing levels would quietly nerf all of them.
- **Prestige and the shop are the late-game sinks.** Level 30 (2,900 lifetime XP) is the prestige gate, and cosmetics cost 200 to 2000 XP. A steeper curve would be a second, overlapping sink.

The cost is that levels themselves are cheap, which is why level carries so little weight: it gates a few cosmetics (levels 5, 10, 15 and 20) and prestige, and scales the four effects above.

## Class power ranking (estimate, after the balance passes)

Average multiplier on a 10 base XP task, from the simulation described above.

| Class (price) | No skills, plain task, level 5 / 15 / 30 | No skills, favourable mix | Full tree (all skills), favourable mix |
|---|---|---|---|
| Default (0) | 1.0 | 1.0 | 1.2 |
| Hero (500) | 3.5 | 3.5 (every second task HIGH) | 12.2 |
| Gambler (450) | 3.4 | same | 5.3 |
| Assassin (400) | 1.8 | same | 4.4 |
| Wizard (700) | 1.6 / 2.8 / 4.0 | same | 5.9 / 10.1 / 12.6 |
| Archer (600) | 3.3 / 3.5 / 3.8 | 3.3 / 3.5 / 3.8 (every second task HIGH) | 9.0 / 9.2 / 9.4 |
| Tank (500) | 1.7 / 2.2 / 2.7 | same | 4.3 / 4.8 / 5.6 |
| Monk (550) | 2.6 | same | 6.8 |
| Artisan (650) | 3.0 | 3.5 (lists of 10) | 9.3 |
| Ranger (600) | 1.5 | 2.2 (3 days early) | 4.0 |
| Necromancer (600) | 1.4 | 2.4 (every third task overdue) | 5.1 |
| Paladin (600) | 1.8 | 2.5 (every second task HIGH) | 4.7 |
| Bard (600) | 1.2 | 2.3 (five lists in rotation) | 3.9 |
| Alchemist (650) | 1.2 | 2.2 (LOW, MEDIUM, HIGH in rotation) | 3.8 |
| Druid (600) | 1.3 | 3.0 (daily habits, 8 step streak) | 5.4 |
| Chronomancer (650) | 1.2 | 2.0 (after a focus session) | 4.1 |
| Warden (600) | 1.2 | 1.9 (lists shared with 3 people) | 4.3 |

Assumptions behind it:

- A player completes tasks at a steady pace every day; classes with counters (Assassin, Tank, Monk, Artisan) sit at or near their caps.
- "Favourable mix" is the situation each class is designed for. It is generous for Necromancer (it needs a backlog) and Ranger (it needs due dates set a day ahead).
- Skills are bought in tree order and the whole tree is bought. Prices are 50 to 360 XP per skill level, so a full tree costs 1,090 to 2,190 XP (see [CLASS_GUIDE](../CLASS_GUIDE.md)).
- A full-tree Wizard at level 25 or more (about 12.6×, Wisdom stops at 50) is still the highest figure in the table, while at level 5 it is among the weakest paid classes; that is the intended "strongest late" promise, now at a more reasonable height than the 35× it used to reach, and it no longer grows past it (a level-100 Wizard used to pay 45×, a level-200 one 88×).

## Small actions are capped

Adding a task (base 5) and creating a list (base 10) used to take the full class bonus. A Monk's Rhythm bonus or a Wizard's Burst is a flat amount, so a 5 XP action could pay 100 XP or more, and the 50 rewarded additions a day were worth nearly as much as the completions: about 5,400 XP a day for a full-tree Monk and about 15,000 for a level-29 Wizard, against 300 for Default. Adding is free and needs no finishing, so it was the cheapest source. `SMALL_ACTION_CAP` now limits the whole result of those two actions to 4 × the base, the same idea as the Hero's 3 × cap. `scripts/balance-sim.js` reports the capped daily totals.

## Borrowed skills and unbounded scaling

The class tables above price each class with its own tree. A second pass (October 2026) measured what the other trees add, and found two holes the tables did not show:

- **Flat skills could be borrowed.** Valor (+10 per action per level), Fortify (+5) and Arcane Study (+3) add the same flat XP whatever the class, and Multishot adds +5 on completions. On a 10 XP task that is a 5× multiplier no class has to earn. A *Default* player who bought only these and the other generic skills (2,095 XP in total) earned **79 XP** per plain task, more than every class's own full tree except the Wizard's, and a Hero or Wizard that added them reached 140 to 280. Valor, Fortify, Arcane Study and Multishot are now `classOnly` (like Champion and Legendary), so the same purchase pays about **15 XP** to a Default player. The class tables did not change, because they only ever used the own tree.
- **The Wizard had no ceiling.** Wisdom was level × 2 plus the Tome with no limit, and the level curve never ends: a level-100 Wizard paid 45× the base on a plain task and a level-200 one 88×. `CLASS_RULES.WIZARD.WISDOM_MAX` (50, level 25) now bounds Wisdom, Tome included. Below level 25 nothing changed.

Smaller changes from the same pass: Hero's Champion +50% → +35%, Monk's Steady Breath +0.5 → +0.4 XP per Rhythm day (the Monk paid 7.5× unconditionally, ahead of every class that has a condition to meet), and Tank's Revenge +10% → +15% per level (a full tree used to add only +4 XP over the starter build for 1,500 XP more). `balance.test.js` now also checks that the Default tree plus every other tree stays under 3× the base and that no class keeps growing with level.

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
2. **Hero's Champion (addressed).** Champion is +35% (it was ×2, then +50%) and works only while the Hero is equipped; Legendary is +15%. The full tree is 8.2× at most levels and 11× on every fifth level (12.2× with a HIGH mix).
3. **The Artisan's project reset (fixed).** Clearing a list used to set progress back to 0, so in the model clearing lists of ten paid less (2.6×) than never clearing (3.0×). A clear now keeps half the progress and pays +6 XP per progress on top of the +2 each action already paid.
4. **Priority labels are unverified (bounded).** Paladin, Archer's Sniper, Hero's Rally and Crusade trust the HIGH priority the player sets, so only the first 3 HIGH completions of a day count as HIGH for them (`LIMITS.HIGH_BONUS_PER_DAY`). Nothing stops marking everything HIGH, but it no longer pays past three tasks a day.
5. **Overdue as a resource.** Necromancer pays for overdue tasks and is meant for backlogs, but the bonus also rewards leaving tasks to lapse (capped at 30 XP of days overdue, and the 24-hour due-date rule blocks backdating).
6. **Weak early game (addressed in part).** Tank now starts at 1.7× (cap `min(15, 5 + level ÷ 3)`, +7% per stack), the Ranger without due dates at 1.5×, the Necromancer without overdue tasks at 1.4× (a soul every 10th task) and the Wizard at 1.6× at level 5 (the Wizard is still meant to be weak early). Cheaper first skills (Fortify 70) were used for the Tank.
7. **A flat level curve.** If level should matter more, the tunable pieces are the gate for prestige and cosmetics, not the curve itself (see above).
8. **Prestige power.** +2% per prestige (max +20%) on class-modified XP plus +1 flat XP per prestige on task completions (max +10; the percentage alone rounded away on small rewards). Players who prestige lose their classes and skills, so the bonus may still be too small to attract anyone. Measure how many players reach 30 first.
9. **Data (collection started).** Everything above is derived from the formulas. `xp_transactions.player_class` now records the class at the time of each reward and `npm run xp-report` averages XP per action by class; compare it with the table above once there is history.
10. **Percentage skills compound on strong classes (bounded, not closed).** Quick Learner, Inspire, Focus, Steady Aim, Momentum, Scholar, Night Shift, Bleed work for every class and multiply the class result, so they help an already strong class most. They now share a limit of +75% (`SKILL_RULES.MAX_PERCENT_BONUS`; Execute, Revenge, Crusade and prestige sit outside it). The limit is a guard rather than a nerf: every own-tree figure in this note is unchanged, and a full-tree Wizard that also buys the generic percentages still earns about 175 XP on a 10 XP task (126 with its own tree), an Artisan about 142, an Archer about 129. Critical Hit and Double Down are separate multipliers (about +20% each on average) and are not limited. Closing the gap further would mean making them `classOnly`, which takes skills away from players who own them.
