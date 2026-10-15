# Choosing a class

Twelve classes change how the XP of every rewarded action is calculated: [GAMEPLAY §3](GAMEPLAY.md#3-classes) has the exact rules, [XP_GUIDE](XP_GUIDE.md) says which XP sources a class touches (creating lists, adding and completing tasks, the daily reward and the free games; never flat bonuses, quests or Blackjack). This page helps you pick one. Buying a class equips it, and switching class resets every class counter (streaks, stacks, Rhythm, progress, souls), though not your daily streak.

## How to read the numbers

The tables below were computed with the shared XP functions (`calculateFinalXP`), not guessed: a task with **10 base XP** completed five times a day, every day, on a 7-day daily streak, with a fixed random seed, averaged after a warm-up. Gambler and Archer are random, so their figures are averages; any single task can be far above or below.

- **Plain task:** medium priority, no due date, not overdue.
- **Favourable mix:** what the class is built for (stated under each class).
- Levels 5, 15 and 30 are all multiples of 5, so Hero's Champion skill (double XP at such levels) is active in those columns.
- These are per-task averages. Everything is limited by the 50 rewarded completions a day, and flat bonuses ([XP_GUIDE](XP_GUIDE.md)) are the same for every class. A skill's cost is paid once per level; the class price is extra.

| Baseline | Plain task at level 5 / 15 / 30 |
|---|---|
| Default, no skills | 10 / 10 / 10 |
| Default, Quick Learner ×3 and Momentum ×3 (360 XP) | 12 / 12 / 12 |
| Hero, no skills (500 XP) | 35 / 35 / 35 |

A bare Default player gets exactly the base. Every class beats it, by very different margins: see [design/balance.md](design/balance.md) for why that is left as it is.

## Quick picker

| If you... | Try |
|---|---|
| want the simplest possible bonus | Hero |
| like variance and big swings | Gambler or Archer |
| work every single day | Monk, Assassin, Tank |
| plan with due dates | Ranger |
| clear lists and finish projects | Artisan |
| work through a backlog of overdue tasks | Necromancer |
| mark real priorities | Paladin |
| want rewards that grow with your level | Wizard (and Tank, Archer slowly) |

## Hero (500 XP)

**Rewards:** a flat +25 on every action, never more than 3 × the base (a 5 XP action gets +15). **Suits:** anyone who wants a dependable bonus without tracking anything. **Pitfalls:** the cap makes small actions (adding a task) worth less than the flat amount suggests; the skills are mostly flat and percentage boosts, so the full tree is the most expensive way to scale.

Favourable mix for the Hero: every second task is HIGH priority (Rally).

| Build | Skills (in order) | Skill cost | Plain task, level 5 / 15 / 30 | Favourable mix, level 5 / 15 / 30 |
|---|---|---|---|---|
| No skills | - | 0 | 35 / 35 / 35 | 35 / 35 / 35 |
| Starter | Valor ×3, Inspire ×2 | 600 | 70 / 70 / 70 | 70 / 70 / 70 |
| Full tree | Valor ×3, Inspire ×2, Champion, Legendary, Oath, Rally | 1570 | 172 / 172 / 172 | 187 / 187 / 187 |

At a level that is not a multiple of 5 the full tree gives 86 and 93 instead of 172 and 187: the Champion skill doubles everything on levels 5, 10, 15 and so on.

## Gambler (300 XP)

**Rewards:** each action rolls a bonus of 0 to (base + 99); 20% of the time it is bad luck and shrinks the reward instead (never below 1 XP). **Suits:** players who enjoy randomness and do not mind uneven days. **Pitfalls:** the average is high, but single actions swing widely, and a run of bad luck is real; Lucky Streak lowers the odds and Insurance and Safety Net soften losses.

| Build | Skills (in order) | Skill cost | Average XP for a plain task, level 5 / 15 / 30 |
|---|---|---|---|
| No skills | - | 0 | 52 / 52 / 52 |
| Starter | Lucky Streak ×3, Double Down ×2 | 480 | 75 / 75 / 75 |
| Full tree | Lucky Streak ×3, Double Down ×2, Safety Net ×2, Jackpot, Insurance, Hot Hand | 1460 | 79 / 79 / 79 |

## Assassin (400 XP)

**Rewards:** each action extends a streak; from the 3rd it adds a stack (max 10) worth +5% each. **Suits:** people who finish tasks in bursts several times a day. **Pitfalls:** after more than 36 hours without a rewarded action (48 with Night Owl) the streak and stacks reset, and a plain 5-per-day routine tops out at +50%. The big numbers come from Execute (+100% at 10 stacks) and critical hits in the full tree.

| Build | Skills (in order) | Skill cost | Average XP for a plain task, level 5 / 15 / 30 |
|---|---|---|---|
| No skills | - | 0 | 15 / 15 / 15 |
| Starter | Swift Strike ×3, Critical Hit ×2 | 530 | 16 / 16 / 16 |
| Full tree | Swift Strike ×3, Critical Hit ×2, Shadow Step, Execute, Night Owl, Bleed | 1430 | 38 / 38 / 38 |

## Wizard (700 XP)

**Rewards:** Wisdom = level × 5. Every 3rd action adds Wisdom (Combo), every 5th adds twice Wisdom (Burst). **Suits:** long-term players; it is the weakest class at level 5 and the strongest at 30. **Pitfalls:** an expensive class (700 XP) that only pays off with levels; the cycle makes tasks uneven (most actions get nothing, a few get a lot).

| Build | Skills (in order) | Skill cost | Average XP for a plain task, level 5 / 15 / 30 |
|---|---|---|---|
| No skills | - | 0 | 25 / 55 / 100 |
| Starter | Arcane Study ×3, Spell Combo ×2 | 600 | 39 / 79 / 139 |
| Full tree | Arcane Study ×3, Spell Combo ×2, Focus ×2, Arcane Mastery, Overcharge, Tome | 1910 | 101 / 201 / 351 |

## Archer (600 XP)

**Rewards:** every action is a shot with an 80% + 0.5% × level hit chance; hits build a streak (max 15) for bonus XP and can headshot or land a perfect shot. **Suits:** risk-takers who like frequent spikes. **Pitfalls:** misses lower the streak by 2 (Piercing Shot stops that); the variance is high; Sniper only helps with HIGH priority tasks.

Favourable mix: every second task is HIGH priority (Sniper makes those always hit and headshot).

| Build | Skills (in order) | Skill cost | Plain task, level 5 / 15 / 30 | Favourable mix, level 5 / 15 / 30 |
|---|---|---|---|---|
| No skills | - | 0 | 52 / 56 / 59 | 52 / 56 / 59 |
| Starter | Steady Aim ×3, Multishot ×2 | 535 | 66 / 70 / 74 | 66 / 70 / 74 |
| Full tree | Steady Aim ×3, Multishot ×2, Piercing Shot, Sniper, Quiver ×2, Eagle Eye | 1585 | 77 / 80 / 84 | 106 / 106 / 109 |

## Tank (500 XP)

**Rewards:** every action adds a shield stack (cap min(15, 3 + level ÷ 3), plus Absorb); each stack adds +4% XP plus +1 XP per two stacks. **Suits:** steady daily workers; with Unstoppable the daily streak never resets. **Pitfalls:** the cap is small at low levels, so the bare class is the weakest of the always-on classes early (level 5: 13); Fortify and Absorb do most of the early work.

| Build | Skills (in order) | Skill cost | Average XP for a plain task, level 5 / 15 / 30 |
|---|---|---|---|
| No skills | - | 0 | 13 / 17 / 21 |
| Starter | Fortify ×3, Absorb ×2 | 575 | 32 / 35 / 39 |
| Full tree | Fortify ×3, Absorb ×2, Revenge ×2, Unstoppable, Bulwark, Anchor | 1795 | 35 / 39 / 43 |

## Monk (550 XP)

**Rewards:** Rhythm (max 14) counts consecutive days of your own on which you finished a rewarded action; every action pays 3% of the base per Rhythm day plus 1 XP per day. **Suits:** habit builders who act daily, even a little. **Pitfalls:** a missed day sends Rhythm back to 1 (Serenity forgives one missed day), it starts from 1 after a class switch, and the level does not matter.

| Build | Skills (in order) | Skill cost | Average XP for a plain task, level 5 / 15 / 30 |
|---|---|---|---|
| No skills | - | 0 | 28 / 28 / 28 |
| Starter | Steady Breath ×3 | 360 | 70 / 70 / 70 |
| Full tree | Steady Breath ×3, Inner Focus ×2, Discipline, Serenity | 1320 | 125 / 125 / 125 |

## Artisan (650 XP)

**Rewards:** every action adds 1 progress (max 10) and pays +2 XP per progress; finishing the last open task of a list of at least 3 tasks pays +8 XP per progress on top. **Suits:** people who work through whole lists. **Pitfalls:** completing a list halves your progress, so a long run of clearing small lists builds less than steadily working one big one; the clear bonus is paid once per list, ever, and repeating tasks and subtasks never count as the last task.

Favourable mix: lists of ten tasks, cleared on every tenth completion. Keeping half the progress and the +8 clear bonus make clearing lists worth more than never clearing them.

| Build | Skills (in order) | Skill cost | Plain task, level 5 / 15 / 30 | Favourable mix, level 5 / 15 / 30 |
|---|---|---|---|---|
| No skills | - | 0 | 30 / 30 / 30 | 26 / 26 / 26 |
| Starter | Toolkit ×3 | 390 | 60 / 60 / 60 | 43 / 43 / 43 |
| Full tree | Toolkit ×3, Blueprint ×2, Assembly Line, Masterwork | 1410 | 90 / 90 / 90 | 74 / 74 / 74 |

## Ranger (600 XP)

**Rewards:** finishing a task with a due date early pays 10% of the base plus 2 XP per day early (up to 7 days), due today 25% of the base, overdue nothing; every other action +3. **Suits:** planners who give tasks due dates and finish ahead. **Pitfalls:** the due date must have been set at least 24 hours before, so a date typed just before finishing counts as none; overdue tasks earn nothing from the class; Long Sight, Bullseye and Second Wind only matter for far-ahead, on-the-day and late tasks.

Favourable mix: every task finished three days early.

| Build | Skills (in order) | Skill cost | Plain task, level 5 / 15 / 30 | Favourable mix, level 5 / 15 / 30 |
|---|---|---|---|---|
| No skills | - | 0 | 13 / 13 / 13 | 19 / 19 / 19 |
| Starter | Scout ×3 | 390 | 13 / 13 / 13 | 37 / 37 / 37 |
| Full tree | Scout ×3, Long Sight, Bullseye, Second Wind | 1220 | 13 / 13 / 13 | 37 / 37 / 37 |

## Necromancer (600 XP)

**Rewards:** completing an overdue task pays +150% of the base plus 3 XP per day overdue (max 30) and binds a soul (max 5, or 8 with Soul Jar); every soul adds +5% of the base to every action. **Suits:** people with a backlog to clear. **Pitfalls:** plain tasks pay only the base plus the soul bonus; the overdue date must be at least 24 hours old; souls never decay. Letting tasks go overdue on purpose is a poor trade, because the days-overdue part of the bonus is capped at 30 XP and every overdue task also lacks the early-finish bonus.

Favourable mix: every third task is three days overdue.

| Build | Skills (in order) | Skill cost | Plain task, level 5 / 15 / 30 | Favourable mix, level 5 / 15 / 30 |
|---|---|---|---|---|
| No skills | - | 0 | 10 / 10 / 10 | 20 / 20 / 20 |
| Starter | Siphon ×3 | 390 | 10 / 10 / 10 | 23 / 23 / 23 |
| Full tree | Siphon ×3, Soul Jar, Dark Ritual, Lichdom | 1230 | 10 / 10 / 10 | 38 / 38 / 38 |

## Paladin (750 XP)

**Rewards:** completing a HIGH priority task pays +100% of the base plus 10; every other action +5. Your daily streak always has the 72-hour Streak Shield window for free (96 hours with Sanctuary). **Suits:** people who really separate the important tasks, and who sometimes miss a day. **Pitfalls:** the priority is your own label: tagging everything HIGH works and is not checked, which empties the idea; the most expensive class.

Favourable mix: every second task is HIGH priority.

| Build | Skills (in order) | Skill cost | Plain task, level 5 / 15 / 30 | Favourable mix, level 5 / 15 / 30 |
|---|---|---|---|---|
| No skills | - | 0 | 15 / 15 / 15 | 23 / 23 / 23 |
| Starter | Holy Aura ×3 | 420 | 21 / 21 / 21 | 29 / 29 / 29 |
| Full tree | Holy Aura ×3, Smite ×2, Crusade, Sanctuary | 1480 | 21 / 21 / 21 | 38 / 38 / 38 |

## Changing your mind

You can own every class and switch freely (each switch resets the class counters). The skills you learned in a class tree stay; the ones marked *(class)* in [GAMEPLAY §4](GAMEPLAY.md#4-skills) only work while that class is equipped, and the generic ones (Quick Learner, Valor, Inspire, Focus, Steady Aim, Fortify, Critical Hit, Double Down and a few more) work with any class. Champion and Legendary are the exception: they need the Hero equipped, so they cannot be borrowed by a class that is already strong. At level 30 you may [prestige](PLAYER_FAQ.md#prestige), which resets your classes and skills for a permanent bonus.
