# Choosing a class

Seventeen classes change how the XP of every rewarded action is calculated: [GAMEPLAY §3](GAMEPLAY.md#3-classes) has the exact rules, [XP_GUIDE](XP_GUIDE.md) says which XP sources a class touches (creating lists, adding and completing tasks, the daily reward and the free games; never flat bonuses, quests or Blackjack). This page helps you pick one. Buying a class equips it, and switching class resets every class counter (streaks, stacks, Rhythm, progress, souls), though not your daily streak.

## How to read the numbers

The tables below were computed with the shared XP functions (`calculateFinalXP`), not guessed: a task with **10 base XP** completed five times a day, every day, on a 7-day daily streak, with a fixed random seed, averaged after a warm-up. Gambler and Archer are random, so their figures are averages; any single task can be far above or below.

- **Plain task:** medium priority, no due date, not overdue.
- **Favourable mix:** what the class is built for (stated under each class).
- Levels 5, 15 and 30 are all multiples of 5, so Hero's Champion skill (+35% XP at such levels) is active in those columns.
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
| juggle many lists | Bard |
| use all three priorities | Alchemist |
| keep daily or weekly routines | Druid |
| work in focus sessions | Chronomancer |
| share lists with others | Warden |

## Hero (500 XP)

**Rewards:** a flat +25 on every action, never more than 3 × the base (a 5 XP action gets +15). **Suits:** anyone who wants a dependable bonus without tracking anything. **Pitfalls:** the cap makes small actions (adding a task) worth less than the flat amount suggests; the skills are mostly flat and percentage boosts, so the full tree is the most expensive way to scale.

Favourable mix for the Hero: every second task is HIGH priority (Rally).

| Build | Skills (in order) | Skill cost | Plain task, level 5 / 15 / 30 | Favourable mix, level 5 / 15 / 30 |
|---|---|---|---|---|
| No skills | - | 0 | 35 / 35 / 35 | 35 / 35 / 35 |
| Starter | Valor ×3, Inspire ×2 | 600 | 70 / 70 / 70 | 70 / 70 / 70 |
| Full tree | Valor ×3, Inspire ×2, Champion, Legendary, Oath, Rally, Last Stand | 1830 | 110 / 110 / 110 | 122 / 122 / 122 |

At a level that is not a multiple of 5 the full tree gives 82 and 91 instead of 110 and 122: the Champion skill adds 35% on levels 5, 10, 15 and so on.

## Gambler (450 XP)

**Rewards:** each action rolls a bonus of 0 to (2 × base + 40); 20% of the time it is bad luck and shrinks the reward instead (never below 1 XP). **Suits:** players who enjoy randomness and do not mind uneven days. **Pitfalls:** the average is still well above Default, but single actions swing widely, and a run of bad luck is real; Lucky Streak lowers the odds and Insurance and Safety Net soften losses.

| Build | Skills (in order) | Skill cost | Average XP for a plain task, level 5 / 15 / 30 |
|---|---|---|---|
| No skills | - | 0 | 34 / 34 / 34 |
| Starter | Lucky Streak ×3, Double Down ×2 | 480 | 46 / 46 / 46 |
| Full tree | Lucky Streak ×3, Double Down ×2, Safety Net ×2, Jackpot, Insurance, Hot Hand, Loaded Dice | 1720 | 53 / 53 / 53 |

## Assassin (400 XP)

**Rewards:** each action extends a streak; from the 3rd it adds a stack (max 10) worth +8% each. **Suits:** people who finish tasks in bursts several times a day. **Pitfalls:** after more than 48 hours without a rewarded action (72 with Night Owl) the streak and stacks reset, and a plain 5-per-day routine tops out at +80%. The big numbers come from Execute (+100% at 10 stacks) and critical hits in the full tree.

| Build | Skills (in order) | Skill cost | Average XP for a plain task, level 5 / 15 / 30 |
|---|---|---|---|
| No skills | - | 0 | 18 / 18 / 18 |
| Starter | Swift Strike ×3, Critical Hit ×2 | 530 | 20 / 20 / 20 |
| Full tree | Swift Strike ×3, Critical Hit ×2, Shadow Step, Execute, Night Owl, Bleed, Vanish | 1690 | 44 / 44 / 44 |

## Wizard (700 XP)

**Rewards:** Wisdom = level × 2, never more than 50 (reached at level 25). Every 3rd action adds Wisdom (Combo), every 5th adds twice Wisdom (Burst). **Suits:** long-term players; it is the weakest class at level 5 and the strongest at 30. **Pitfalls:** an expensive class (700 XP) that only pays off with levels, and stops growing at level 25 (prestige is the next step); the cycle makes tasks uneven (most actions get nothing, a few get a lot).

| Build | Skills (in order) | Skill cost | Average XP for a plain task, level 5 / 15 / 30 |
|---|---|---|---|
| No skills | - | 0 | 16 / 28 / 40 |
| Starter | Arcane Study ×3, Spell Combo ×2 | 600 | 27 / 43 / 59 |
| Full tree | Arcane Study ×3, Spell Combo ×2, Focus ×2, Arcane Mastery, Overcharge, Tome, Cantrip | 2190 | 59 / 101 / 126 |

## Archer (600 XP)

**Rewards:** every action is a shot with an 80% + 0.5% × level hit chance; hits build a streak (max 15) for bonus XP (6% of the base per step) and can headshot or land a 3% perfect shot. **Suits:** risk-takers who like frequent spikes. **Pitfalls:** misses lower the streak by 2 (Piercing Shot stops that); the variance is high; Sniper only helps with HIGH priority tasks.

Favourable mix: every second task is HIGH priority (Sniper makes those always hit and headshot).

| Build | Skills (in order) | Skill cost | Plain task, level 5 / 15 / 30 | Favourable mix, level 5 / 15 / 30 |
|---|---|---|---|---|
| No skills | - | 0 | 33 / 35 / 38 | 33 / 35 / 38 |
| Starter | Steady Aim ×3, Multishot ×2 | 535 | 45 / 47 / 51 | 45 / 47 / 51 |
| Full tree | Steady Aim ×3, Multishot ×2, Piercing Shot, Sniper, Quiver ×2, Eagle Eye, Ricochet | 1865 | 65 / 68 / 72 | 90 / 92 / 94 |

## Tank (500 XP)

**Rewards:** every action adds a shield stack (cap min(15, 5 + level ÷ 3), plus Absorb); each stack adds +7% XP plus +1 XP per two stacks. **Suits:** steady daily workers; with Unstoppable the daily streak never resets. **Pitfalls:** the cap is small at low levels, so the bare class is the weakest of the always-on classes early (level 5: 17); Fortify and Absorb do most of the early work.

| Build | Skills (in order) | Skill cost | Average XP for a plain task, level 5 / 15 / 30 |
|---|---|---|---|
| No skills | - | 0 | 17 / 22 / 27 |
| Starter | Fortify ×3, Absorb ×2 | 500 | 37 / 41 / 47 |
| Full tree | Fortify ×3, Absorb ×2, Revenge ×2, Unstoppable, Bulwark, Anchor, Taunt | 2000 | 43 / 48 / 56 |

## Monk (550 XP)

**Rewards:** Rhythm (max 14) counts consecutive days of your own on which you finished a rewarded action; every action pays 2% of the base per Rhythm day plus 1 XP per day. **Suits:** habit builders who act daily, even a little. **Pitfalls:** a missed day sends Rhythm back to 1 (Serenity forgives one missed day), it starts from 1 after a class switch, and the level does not matter.

| Build | Skills (in order) | Skill cost | Average XP for a plain task, level 5 / 15 / 30 |
|---|---|---|---|
| No skills | - | 0 | 26 / 26 / 26 |
| Starter | Steady Breath ×3 | 360 | 42 / 42 / 42 |
| Full tree | Steady Breath ×3, Inner Focus ×2, Discipline, Serenity, Meditation | 1620 | 68 / 68 / 68 |

## Artisan (650 XP)

**Rewards:** every action adds 1 progress (max 10) and pays +2 XP per progress; finishing the last open task of a list of at least 3 tasks pays +6 XP per progress on top. **Suits:** people who work through whole lists. **Pitfalls:** completing a list halves your progress, so a long run of clearing small lists builds less than steadily working one big one; the clear bonus is paid once per list, ever, and repeating tasks and subtasks never count as the last task.

Favourable mix: lists of ten tasks, cleared on every tenth completion. Keeping half the progress and the +6 clear bonus make clearing lists worth more than never clearing them.

| Build | Skills (in order) | Skill cost | Plain task, level 5 / 15 / 30 | Favourable mix, level 5 / 15 / 30 |
|---|---|---|---|---|
| No skills | - | 0 | 30 / 30 / 30 | 35 / 35 / 35 |
| Starter | Toolkit ×3 | 390 | 45 / 45 / 45 | 45 / 45 / 45 |
| Full tree | Toolkit ×3, Blueprint ×2, Assembly Line, Masterwork, Prototype | 1730 | 66 / 66 / 66 | 93 / 93 / 93 |

## Ranger (600 XP)

**Rewards:** finishing a task with a due date early pays 10% of the base plus 3 XP per day early (up to 7 days), due today 25% of the base, overdue nothing; every other action +5. **Suits:** planners who give tasks due dates and finish ahead. **Pitfalls:** the due date must have been set at least 24 hours before, so a date typed just before finishing counts as none; overdue tasks earn nothing from the class; Only your first 8 early or overdue completions of a day count for the class; Long Sight, Bullseye and Second Wind only matter for far-ahead, on-the-day and late tasks.

Favourable mix: every task finished three days early.

| Build | Skills (in order) | Skill cost | Plain task, level 5 / 15 / 30 | Favourable mix, level 5 / 15 / 30 |
|---|---|---|---|---|
| No skills | - | 0 | 15 / 15 / 15 | 22 / 22 / 22 |
| Starter | Scout ×3 | 390 | 15 / 15 / 15 | 40 / 40 / 40 |
| Full tree | Scout ×3, Long Sight, Bullseye, Second Wind, Tracker | 1460 | 19 / 19 / 19 | 40 / 40 / 40 |

## Necromancer (600 XP)

**Rewards:** completing an overdue task pays +150% of the base plus 3 XP per day overdue (max 30) and binds a soul (max 5, or 8 with Soul Jar), and every 10th task you complete also binds one; every soul adds +8% of the base to every action. **Suits:** people with a backlog to clear. **Pitfalls:** plain tasks pay the base plus the soul bonus only; the overdue date must be at least 24 hours old; souls never decay. Only your first 8 overdue completions of a day count for the class. Letting tasks go overdue on purpose is a poor trade, because the days-overdue part of the bonus is capped at 30 XP and every overdue task also lacks the early-finish bonus.

Favourable mix: every third task is three days overdue.

| Build | Skills (in order) | Skill cost | Plain task, level 5 / 15 / 30 | Favourable mix, level 5 / 15 / 30 |
|---|---|---|---|---|
| No skills | - | 0 | 14 / 14 / 14 | 24 / 24 / 24 |
| Starter | Siphon ×3 | 390 | 17 / 17 / 17 | 27 / 27 / 27 |
| Full tree | Siphon ×3, Soul Jar, Dark Ritual, Lichdom, Soul Eater | 1550 | 21 / 21 / 21 | 51 / 51 / 51 |

## Paladin (600 XP)

**Rewards:** completing a HIGH priority task pays +100% of the base plus 10; every other action +8. Your daily streak always has the Streak Shield window for free (one missed day forgiven, two with Sanctuary). **Suits:** people who really separate the important tasks, and who sometimes miss a day. **Pitfalls:** the priority is your own label: tagging everything HIGH works and is not checked, which empties the idea (only the first 3 HIGH completions a day count); the price is 600 XP.

Favourable mix: every second task is HIGH priority.

| Build | Skills (in order) | Skill cost | Plain task, level 5 / 15 / 30 | Favourable mix, level 5 / 15 / 30 |
|---|---|---|---|---|
| No skills | - | 0 | 18 / 18 / 18 | 25 / 25 / 25 |
| Starter | Holy Aura ×3 | 420 | 27 / 27 / 27 | 34 / 34 / 34 |
| Full tree | Holy Aura ×3, Smite ×2, Crusade, Sanctuary, Aegis | 1780 | 31 / 31 / 31 | 47 / 47 / 47 |

## Bard (600 XP)

**Rewards:** every list beyond the first among your last 5 completions adds 4% of the base plus 3 XP, so finishing tasks from five different lists in a row is a medley of 4 steps; every other action pays +2. **Suits:** people who juggle several lists. **Pitfalls:** grinding one list pays almost nothing (the +2); the medley counts completions, not days, and Ballad only helps the first task of a day.

Favourable mix: every task comes from a different list than the last four.

| Build | Skills (in order) | Skill cost | Plain task, level 5 / 15 / 30 | Favourable mix, level 5 / 15 / 30 |
|---|---|---|---|---|
| No skills | - | 0 | 12 / 12 / 12 | 23 / 23 / 23 |
| Starter | Encore ×3 | 330 | 12 / 12 / 12 | 35 / 35 / 35 |
| Full tree | Encore ×3, Harmony, Crescendo, Ballad | 1090 | 21 / 21 / 21 | 39 / 39 / 39 |

## Alchemist (650 XP)

**Rewards:** each completion adds its priority to the brew and pays +2 XP per ingredient; completing the third different priority finishes the brew for 150% of the base plus 15 and starts a new one. Other actions pay +2. **Suits:** people who really use all three priorities. **Pitfalls:** a player who marks everything MEDIUM never brews and earns only the +2; HIGH is the player's own label, so only the first 3 HIGH completions of a day count as HIGH for the brew; the brew is kept until it finishes, however long that takes.

Favourable mix: LOW, MEDIUM and HIGH tasks in rotation.

| Build | Skills (in order) | Skill cost | Plain task, level 5 / 15 / 30 | Favourable mix, level 5 / 15 / 30 |
|---|---|---|---|---|
| No skills | - | 0 | 12 / 12 / 12 | 22 / 22 / 22 |
| Starter | Catalyst ×3 | 330 | 12 / 12 / 12 | 27 / 27 / 27 |
| Full tree | Catalyst ×3, Elixir, Transmute, Distill | 1090 | 14 / 14 / 14 | 38 / 38 / 38 |

## Druid (600 XP)

**Rewards:** finishing a repeating task pays 6% of the base times the steps of its habit streak plus 2 XP per step (up to 10 steps), and at least +3; every other action pays +3. **Suits:** people with daily or weekly routines kept as repeating tasks. **Pitfalls:** the habit streak is the one on the task (finish it on or before the due date, a late finish resets it), so a skipped routine pays little; without repeating tasks the Druid is a +3 class.

Favourable mix: every task is a daily habit with an 8 step streak.

| Build | Skills (in order) | Skill cost | Plain task, level 5 / 15 / 30 | Favourable mix, level 5 / 15 / 30 |
|---|---|---|---|---|
| No skills | - | 0 | 13 / 13 / 13 | 30 / 30 / 30 |
| Starter | Roots ×3 | 330 | 13 / 13 / 13 | 54 / 54 / 54 |
| Full tree | Roots ×3, Bloom, Seasons, Grove | 1090 | 16 / 16 / 16 | 54 / 54 / 54 |

## Chronomancer (650 XP)

**Rewards:** the first 3 tasks you complete within 30 minutes after a finished focus session pay +100% of the base plus 5; every other action pays +2. **Suits:** people who work in focus sessions (the Focus page or the API). **Pitfalls:** with no focus session the class pays only +2; a session needs at least 10 minutes to count as finished; the flow covers 3 tasks, however many you finish (Echo makes it 5).

Favourable mix: a focus session finished just before the first three tasks of every day.

| Build | Skills (in order) | Skill cost | Plain task, level 5 / 15 / 30 | Favourable mix, level 5 / 15 / 30 |
|---|---|---|---|---|
| No skills | - | 0 | 12 / 12 / 12 | 20 / 20 / 20 |
| Starter | Hourglass ×3 | 330 | 12 / 12 / 12 | 29 / 29 / 29 |
| Full tree | Hourglass ×3, Time Dilation, Echo, Temporal Surge | 1090 | 12 / 12 / 12 | 41 / 41 / 41 |

## Warden (600 XP)

**Rewards:** finishing a task on a shared list pays 10% of the base plus 2 XP for every other person on that list (up to 5); every other action pays +2. **Suits:** people who share lists with a partner, a team or a household. **Pitfalls:** a list nobody else is on pays only +2; shared lists are not part of exports or templates; clearing the list pays the person who finished its last task, not the whole group.

Favourable mix: every task is on a list shared with three other people.

| Build | Skills (in order) | Skill cost | Plain task, level 5 / 15 / 30 | Favourable mix, level 5 / 15 / 30 |
|---|---|---|---|---|
| No skills | - | 0 | 12 / 12 / 12 | 19 / 19 / 19 |
| Starter | Beacon ×3 | 330 | 12 / 12 / 12 | 37 / 37 / 37 |
| Full tree | Beacon ×3, Shield Wall, Rally Cry, Vigil | 1090 | 12 / 12 / 12 | 43 / 43 / 43 |

## Changing your mind

You can own every class and switch freely (each switch resets the class counters). The skills you learned in a class tree stay; the ones marked *(class)* in [GAMEPLAY §4](GAMEPLAY.md#4-skills) only work while that class is equipped, and the generic ones (Quick Learner, Inspire, Focus, Steady Aim, Critical Hit, Double Down and a few more) work with any class. The flat per-action skills Valor, Fortify, Arcane Study and Multishot are tied to their own class too, so a Default or Monk player cannot collect them from other trees. Champion and Legendary are the exception: they need the Hero equipped, so they cannot be borrowed by a class that is already strong. At level 30 you may [prestige](PLAYER_FAQ.md#prestige), which resets your classes and skills for a permanent bonus.
