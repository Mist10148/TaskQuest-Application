# Gameplay reference

Every number on this page comes from [`packages/shared/src/constants.js`](../packages/shared/src/constants.js) and [`xp.js`](../packages/shared/src/xp.js). The bot and the web app use the same code, so the rules are identical on both. Randomness uses Node's CSPRNG.

## Contents

1. [XP and levels](#1-xp-and-levels)
2. [How XP is calculated](#2-how-xp-is-calculated)
3. [Classes](#3-classes)
4. [Skills](#4-skills)
5. [Daily reward](#5-daily-reward) (and streak freezes, streak chests)
   - [Quests](#5b-quests)
   - [Bonus XP sources](#5c-bonus-xp-sources)
   - [Focus sessions](#5d-focus-sessions)
   - [Weekly review](#5e-weekly-review)
   - [Reflection and weekly goal](#5e-reflection-and-weekly-goal)
   - [Prestige](#5f-prestige)
   - [Cosmetics](#5g-cosmetics-the-shop)
   - [Parties](#5h-parties)
6. [Achievements](#6-achievements)
7. [Games](#7-games)
8. [Limits and anti-farming](#8-limits-and-anti-farming)

---

## 1. XP and levels

- **Balance** (`player_xp`) is what you spend on classes, skills and bets.
- **Lifetime XP** is everything you have ever earned. Spending never reduces it. Returned bets and refunds don't add to it.
- **Level** = ⌊lifetime XP / 100⌋ + 1, so each level needs 100 XP. Your level never goes down.
- XP achievements use lifetime XP.
- When XP is turned off (`/toggle` or Settings), actions still work but grant no XP. Games, purchases and the daily reward are unavailable.

| Action | Base XP | Notes |
|---|---|---|
| Create a list | 10 | Only the first 10 list creations per day are rewarded |
| Add a task | 5 | Only the first 50 per day are rewarded |
| Complete a task | 10 | **Once per task, ever**, and only the first **50 completions per day** are rewarded (so add, complete, delete loops can't farm XP). Un-completing and re-completing pays nothing. A repeating task's next copy is a new task that can earn its own completion XP, within the same daily cap. |
| Claim a quest | 15–120 | Flat reward, once per period (see §5b) |
| Daily reward | 100 | Plus streak and skill bonuses (see §5) |
| RPS win | 10 | Free game |
| Hangman win | max(10, 10 × lives left) | Free game |
| Arcade run | points × rate, capped | Free game (web) |
| Blackjack win | your winnings | Flat 1:1 (3:2 for a natural). Class and skill bonuses do **not** apply, and winnings do not count toward lifetime XP or level |

## 2. How XP is calculated

For every reward:

```
1. classXP    = class mechanic(base XP)                          (§3)
2. multiplier = 1 + Σ percentage skills + Bleed, Momentum, Scholar, Night Shift
                  (together at most +75%)
                  + class-gated skills: Execute, Revenge, Crusade  (§4, not limited)
                  + prestige bonus (+2% each, not limited)
3. final      = ⌊classXP × multiplier⌋ + Σ flat skill bonuses
                  (Valor, Fortify, Arcane Study, and on task completions Multishot, each only
                   with its own class equipped; Rally for HIGH priority, Anchor for recurring tasks)
4. Hero Champion: ×1.35 if your level is a multiple of 5 (Hero equipped)
5. Crit (Assassin Critical Hit): +50 % (or +100 % with Shadow Step); a crit arms Bleed
6. Double Down skill: chance to ×2
7. Jackpot skill: 1 % chance to ×10
8. Small actions (adding a task, creating a list): the result never exceeds 4 × the base
```

The class mechanic sees more than the base XP: the **action** (create list, add task, complete task, daily, game), the task's **priority**, whether it is **recurring**, its **due date**, how many days it was **overdue**, and whether completing it **cleared a list**. Task completions always carry all of these; other actions carry only the action.

Each toast or embed shows a breakdown like `Base: 10 | 🎯 Hit x4 +10 💥+32 | 📚 Skill +10`.

Assassin decay is a rolling clock. Monk Rhythm counts **your** days, and Ranger and Necromancer compare due dates with **your** calendar day (your time zone setting, UTC when unset). See [your day](#your-day).

## 3. Classes

The Default class is free. Buying a class also equips it. Switching class resets every class counter (streaks, stacks, charges, Rhythm, Project progress, souls).

| Class | Cost | Mechanic (per rewarded action) |
|---|---|---|
| ⚪ **Default** | 0 | No modifier. |
| ⚔️ **Hero** | 500 | +25 flat XP, but never more than 3 × the base reward (so a 5 XP action gets +15, not +25). |
| 🎲 **Gambler** | 450 | Rolls a bonus of 0 to (2 × base + 40). 20% of the time it is *bad luck* instead: the reward shrinks by min(bonus, base − 1), and never drops below 1 XP. Counts consecutive lucky rolls (`gambler_streak`) for Hot Hand. |
| 🗡️ **Assassin** | 400 | Each action raises the streak by 1. From streak 3, each action also adds a stack (max 10). Bonus is +8% per stack. **Decay:** after more than 48 hours without a rewarded action the streak and stacks reset to 0 before the action is applied. |
| 🔮 **Wizard** | 700 | Wisdom = level × 2, never more than 50 (level 25), Tome included. The 3rd action in a cycle adds +Wisdom (Combo). The 5th adds +2 × Wisdom (Burst). Then the cycle restarts. |
| 🏹 **Archer** | 600 | Hit chance is min(97%, 80% + 0.5% × level). A **hit** raises the streak by 1 (max 15) and adds ⌊base × streak × 6%⌋ + 2 + ⌊streak ÷ 2⌋. On a hit, a *headshot* triggers if the roll is under min(30, hit% × 0.2) and adds ⌊1.5 × base⌋ + 2 × streak. A 3% *perfect shot* adds 3 × base + 6 × streak. A **miss** lowers the streak by 2. |
| 🛡️ **Tank** | 500 | +1 shield stack per action, capped at min(15, 5 + ⌊level / 3⌋) (plus 2 per Absorb level). Bonus is ⌊base × stacks × 7%⌋ + ⌊stacks / 2⌋. |
| 🧘 **Monk** | 550 | **Rhythm** (max 14, counted in your days). The first rewarded action on a new day continues the Rhythm if you were active yesterday (+1), otherwise it restarts at 1. Further actions the same day keep it. Bonus on every action = ⌊base × Rhythm × 2%⌋ + Rhythm. |
| 🛠️ **Artisan** | 650 | **Project** (max 10). Every action adds 1 progress and pays +2 XP per progress. Completing the last open task of a list that has at least 3 tasks finishes the project: +6 XP per progress on top, then half of the progress is kept (rounded down). Repeating tasks and subtasks never count as the last task. |
| 🧭 **Ranger** | 600 | **Deadline Hunter.** (The due date must be at least 24 hours old; a freshly set date counts as no due date.) Completing a task with a due date *early* by d days (up to 7) pays ⌊base × 10% × d⌋ + 3 × d. *Due today* pays ⌊base × 25%⌋. *Overdue* pays nothing. Every other action (including completing a task with no due date) pays +5. No counter. |
| 💀 **Necromancer** | 600 | **Revive.** (The due date must be at least 24 hours old, or the task is not overdue for this purpose.) Completing an overdue task pays ⌊base × 150%⌋ + min(30, 3 × days overdue) and binds a soul (max 5). Every soul you hold adds ⌊base × 8%⌋ to *every* action (counted after the new soul). Every 10th task you complete also binds a soul. Souls do not decay. |
| ⚜️ **Paladin** | 600 | **Vow.** Completing a HIGH priority task pays base + 10; every other action pays +8. Passive: your daily streak always has the Streak Shield window (one missed day forgiven) for free, including on the streak leaderboard. |
| 🎵 **Bard** | 600 | **Variety.** Completing a task remembers its list; among your last 5 completions, every list beyond the first adds ⌊base × 4%⌋ + 3 XP (a medley of up to 4 steps). Other actions, and a medley of one list, pay +2. The counter is `bard_recent`. |
| ⚗️ **Alchemist** | 650 | **Brew.** Completing a task adds its priority to the brew (`alchemist_mix`) and pays +2 XP per ingredient in it. Completing the third different priority finishes the brew: ⌊base × 150%⌋ + 15, and the brew starts over. Other actions pay +2. A task with no priority counts as MEDIUM. |
| 🌿 **Druid** | 600 | **Habits.** Completing a repeating task pays ⌊base × 6%⌋ × steps + 2 per step of its habit streak (up to 10 steps; the streak is the one shown on the task and kept by [habit streaks](#5c-bonus-xp-sources)), at least +3. Every other action pays +3. |
| ⏳ **Chronomancer** | 650 | **Flow.** The first 3 tasks you complete within 30 minutes after a [focus session](#5d-focus-sessions) finished (finished, not cancelled or expired) pay +100% of the base XP and 5 more. Every other action pays +2. The window comes from your last finished focus session; nothing is stored on your account. |
| 🤝 **Warden** | 600 | **Guard.** Completing a task on a [shared list](#5h-parties) pays ⌊base × 10% × n⌋ + 2 × n XP, where n is the number of other people on that list (up to 5; members and the owner count, you do not). Every other action, and tasks on lists nobody shares, pay +2. |

All class bonuses are multiplied by your percentage skills (§2), like any other class bonus.

## 4. Skills

- You can learn skills from the **Default** tree and from the trees of classes you **own**. The class doesn't need to be equipped for generic bonuses. Skills marked *(class)* only work while that class is equipped; this includes the flat per-action skills Valor, Fortify, Arcane Study and Multishot, so they cannot be borrowed by another class.
- Each level costs the listed price.
- A skill's prerequisite must be unlocked (at any level) first.
- Effects marked *(class)* only matter while that class is equipped.

### ⚪ Default

| Skill | Max | Cost/level | Effect per level | Requires |
|---|---|---|---|---|
| 📚 Quick Learner | 3 | 50 | +5% XP | — |
| 🌅 Early Bird | 2 | 75 | +10 daily-reward XP | Quick Learner |
| 🛡️ Streak Shield | 1 | 100 | The daily streak survives a missed day (a claim up to 2 days after the last one still continues it) | Early Bird |
| 🔥 Momentum | 3 | 70 | +0.5% XP for each day of your current daily streak, counting up to 10 days (max +15% at level 3) | Quick Learner |
| 🧊 Freeze Cache | 1 | 120 | Hold 5 streak freezes instead of 3, and each costs 120 XP instead of 150 | Streak Shield |
| 🎁 Daily Surprise | 1 | 140 | The daily reward has a 15% chance to add +50 XP | Freeze Cache |
| 🎓 Scholar | 1 | 90 | +15% XP on the first task you complete each day | Quick Learner |
| 🌃 Night Shift | 2 | 80 | +5% XP per level on actions between 21:00 and 05:00 (your time) | Scholar |
| 🧹 Tidy Mind | 2 | 90 | +8 XP per level when your completion clears a list | Momentum |

### ⚔️ Hero

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| ⚔️ Valor | 3 | 100 | +10 flat XP *(class)* | — |
| ✨ Inspire | 2 | 150 | +8% XP | Valor |
| 👑 Champion | 1 | 200 | +35% XP while your level is a multiple of 5 *(class)* | Inspire |
| 🏆 Legendary | 1 | 300 | +15% XP *(class)* | Champion |
| 🛡️ Oath | 1 | 250 | Hero bonus becomes min(25 + level, 50), still capped at 3 × base *(class)* | Legendary |
| 📣 Rally | 1 | 220 | +15 flat XP when you complete a HIGH priority task | Oath |
| 🚩 Last Stand | 1 | 260 | +20 flat XP when your completion clears a list | Rally |

### 🎲 Gambler

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| 🍀 Lucky Streak | 3 | 80 | Bad-luck chance −5% (20% → 5%) *(class)* | — |
| 🎰 Double Down | 2 | 120 | 10% chance to double an action's XP | Lucky Streak |
| 🪢 Safety Net | 2 | 150 | Bad-luck losses 25% smaller *(class)* | Double Down |
| 💎 Jackpot | 1 | 250 | 1% chance for ×10 XP | Safety Net |
| 🎟️ Insurance | 1 | 200 | Bad luck can never cut a reward below 60% of the base XP *(class)* | Jackpot |
| 🔁 Hot Hand | 1 | 230 | After 3 lucky rolls in a row the next roll cannot be bad luck, then the run restarts *(class)* | Insurance |
| 🎯 Loaded Dice | 1 | 260 | Lucky rolls never roll below a quarter of the range *(class)* | Hot Hand |

### 🗡️ Assassin

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| 💨 Swift Strike | 3 | 90 | Streak builds +1 faster *(class)* | — |
| 🎯 Critical Hit | 2 | 130 | +10% chance to crit for +50% XP | Swift Strike |
| 🌑 Shadow Step | 1 | 180 | Crits grant +100% instead of +50% | Critical Hit |
| ☠️ Execute | 1 | 280 | +100% XP at 10/10 stacks *(class)* | Shadow Step |
| 🌙 Night Owl | 1 | 200 | The streak decay window is 72 hours instead of 48 *(class)* | Execute |
| 🩸 Bleed | 1 | 240 | After a crit, your next 3 actions get +20% XP (any class that crits; the counter is `assassin_bleed`) | Night Owl |
| 🌫️ Vanish | 1 | 260 | When the streak decays it halves instead of resetting *(class)* | Bleed |

### 🔮 Wizard

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| 📖 Arcane Study | 3 | 100 | +3 flat XP *(class)* | — |
| 🔥 Spell Combo | 2 | 150 | Combo bonus +50% *(class)* | Arcane Study |
| 🧘 Focus | 2 | 200 | +10% XP | Spell Combo |
| 🌟 Arcane Mastery | 1 | 350 | Burst = 3 × Wisdom instead of 2 × *(class)* | Focus |
| 🕯️ Overcharge | 1 | 300 | After a Burst the cycle restarts at 2 charges instead of 0 *(class)* | Arcane Mastery |
| 📚 Tome | 1 | 260 | Wisdom + ⌊tasks ever completed / 20⌋ *(class)* | Overcharge |
| ✨ Cantrip | 1 | 280 | The 2nd and 4th action of a cycle add a quarter of your Wisdom *(class)* | Tome |

### 🏹 Archer

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| 🎯 Steady Aim | 3 | 85 | +3% XP | — |
| 🏹 Multishot | 2 | 140 | +5 XP on task completions *(class)* | Steady Aim |
| 💫 Piercing Shot | 1 | 190 | Misses don't reduce the streak *(class)* | Multishot |
| 🦅 Sniper | 1 | 300 | Completing a HIGH-priority task (its own priority, else the priority of its list) is always a hit and headshot *(class)* | Piercing Shot |
| 🪶 Quiver | 2 | 150 | +3% hit chance per level, still capped at 97% *(class)* | Sniper |
| 🦉 Eagle Eye | 1 | 260 | Headshot chance × 1.5 *(class)* | Quiver |
| 🪃 Ricochet | 1 | 280 | Every hit adds +1 XP per streak step *(class)* | Eagle Eye |

### 🛡️ Tank

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| 🧱 Fortify | 3 | 70 | +5 flat XP *(class)* | — |
| 💪 Absorb | 2 | 145 | +2 max shield stacks *(class)* | Fortify |
| ⚡ Revenge | 2 | 200 | +15% XP while at max stacks *(class)* | Absorb |
| 🚀 Unstoppable | 1 | 320 | The daily streak never resets. A missed day just continues it. | Revenge |
| 🏰 Bulwark | 1 | 240 | Each action adds 2 shield stacks instead of 1 *(class)* | Unstoppable |
| ⚓ Anchor | 1 | 260 | +8 flat XP when you complete a recurring task | Bulwark |
| 📢 Taunt | 1 | 280 | Completing a HIGH priority task adds one extra shield stack *(class)* | Anchor |

### 🧘 Monk

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| 🌬️ Steady Breath | 3 | 120 | +0.4 XP per Rhythm day on every action, per level *(class)* | — |
| 🧠 Inner Focus | 2 | 180 | Monk bonus +15% per level *(class)* | Steady Breath |
| 🪷 Discipline | 1 | 260 | Maximum Rhythm +2 (14 → 16) *(class)* | Inner Focus |
| ☯️ Serenity | 1 | 340 | Rhythm survives one missed day (a gap of 2 days continues it) *(class)* | Discipline |
| 🕯️ Meditation | 1 | 300 | The first action of each new day pays double the Monk bonus *(class)* | Serenity |

### 🛠️ Artisan

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| 🔧 Toolkit | 3 | 130 | +0.5 XP per progress on every action, per level *(class)* | — |
| 📐 Blueprint | 2 | 190 | Maximum progress +3 per level (10 → 16) *(class)* | Toolkit |
| 🏭 Assembly Line | 1 | 280 | Each action adds 2 progress instead of 1 *(class)* | Blueprint |
| 🏆 Masterwork | 1 | 360 | Completing a project pays +50% more *(class)* | Assembly Line |
| 🧩 Prototype | 1 | 320 | A finished project keeps 75% of its progress instead of 50% *(class)* | Masterwork |

### 🧭 Ranger

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| 🔭 Scout | 3 | 130 | +2 XP per day early on early completions, per level *(class)* | — |
| 🗺️ Long Sight | 1 | 220 | The early bonus counts up to 10 days instead of 7 *(class)* | Scout |
| 🎯 Bullseye | 1 | 280 | +10 XP when you complete a task on its due date *(class)* | Long Sight |
| 🌅 Second Wind | 1 | 330 | Overdue completions pay half the due-today bonus *(class)* | Bullseye |
| 👣 Tracker | 1 | 240 | Actions that are not early, on time or late pay +4 XP more *(class)* | Second Wind |

### 💀 Necromancer

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| 🫧 Siphon | 3 | 130 | Each soul adds +2% more of the base XP per level *(class)* | — |
| 🏺 Soul Jar | 1 | 210 | Hold up to 8 souls instead of 5 *(class)* | Siphon |
| 🕯️ Dark Ritual | 1 | 280 | Reviving pays +50% more *(class)* | Soul Jar |
| ☠️ Lichdom | 1 | 350 | Reviving also pays +3 XP per soul you hold *(class)* | Dark Ritual |
| 👻 Soul Eater | 1 | 320 | A revive pays 25% more while you hold 3 or more souls *(class)* | Lichdom |

### ⚜️ Paladin

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| ✨ Holy Aura | 3 | 140 | +3 XP on every action, per level *(class)* | — |
| ⚔️ Smite | 2 | 210 | The HIGH priority Vow bonus is +25% larger per level *(class)* | Holy Aura |
| 📯 Crusade | 1 | 290 | +20% XP when you complete a HIGH priority task *(class)* | Smite |
| 🏛️ Sanctuary | 1 | 350 | Your daily streak survives two missed days (a claim up to 3 days after the last one) *(class)* | Crusade |
| 🔰 Aegis | 1 | 300 | The +8 on non-HIGH actions is 50% larger *(class)* | Sanctuary |

### 🎵 Bard

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| 🎶 Encore | 3 | 110 | +1 XP per medley step on every completion, per level *(class)* | — |
| 🎼 Harmony | 1 | 200 | The medley looks at your last 7 completions instead of 5 *(class)* | Encore |
| 📯 Crescendo | 1 | 260 | +25% Bard bonus when every task of the medley is from a different list *(class)* | Harmony |
| 🪕 Ballad | 1 | 300 | The first task you complete each day counts as a full medley *(class)* | Crescendo |

### ⚗️ Alchemist

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| 🧪 Catalyst | 3 | 110 | +5 XP on a finished brew, per level *(class)* | — |
| 🍶 Elixir | 1 | 200 | Each ingredient in the brew pays +2 XP more *(class)* | Catalyst |
| 💎 Transmute | 1 | 260 | A finished brew pays 50% more *(class)* | Elixir |
| 🫗 Distill | 1 | 300 | After a brew the next one starts with a MEDIUM ingredient already in it *(class)* | Transmute |

### 🌿 Druid

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| 🌱 Roots | 3 | 110 | +1 XP per habit streak step on repeating tasks, per level *(class)* | — |
| 🌸 Bloom | 1 | 200 | The habit streak counts up to 15 steps instead of 10 *(class)* | Roots |
| 🍂 Seasons | 1 | 260 | Weekly and monthly habits count their streak twice *(class)* | Bloom |
| 🌳 Grove | 1 | 300 | Every other action pays +3 XP more *(class)* | Seasons |

### ⏳ Chronomancer

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| ⌛ Hourglass | 3 | 110 | +5 XP on tasks completed in the flow, per level *(class)* | — |
| 🕰️ Time Dilation | 1 | 200 | The flow lasts 45 minutes after a focus session instead of 30 *(class)* | Hourglass |
| 🔔 Echo | 1 | 260 | The flow covers 5 tasks instead of 3 *(class)* | Time Dilation |
| ⚡ Temporal Surge | 1 | 300 | +25% Chronomancer bonus when the task is also your first of the day *(class)* | Echo |

### 🤝 Warden

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| 🔦 Beacon | 3 | 110 | +2 XP per person on the list for tasks finished on a shared list, per level *(class)* | — |
| 🏰 Shield Wall | 1 | 200 | Up to 8 people on the list count instead of 5 *(class)* | Beacon |
| 🥁 Rally Cry | 1 | 260 | +25% Warden bonus on lists with 3 or more other people *(class)* | Shield Wall |
| 🏮 Vigil | 1 | 300 | +15 XP when your completion clears a shared list *(class)* | Rally Cry |

**Resetting a tree.** You can unlearn every skill of one tree (web Skills page, `POST /api/skills/respec`, or **Reset Tree** in the bot's `/class` skill view) and get **75%** of what its levels cost back, once a day. The refund is a plain balance credit (source `skill_refund`): it never counts as lifetime XP, and `xp_spent` and the spending achievements are unaffected. Freeze Cache cannot be dropped while you hold more streak freezes than the normal limit of 3.

There are 96 skills in 17 trees (Default plus the sixteen classes).

## 5. Daily reward

- **Cooldown:** 24 hours from your last claim.
- **Streak:**
  - The streak counts **your calendar days** (your time zone): claiming on the day after your last claim continues it. Claiming at least 24 hours after the last claim is still required.
  - With Streak Shield (or as a Paladin), one missed day is forgiven (a claim up to 2 days after the last one continues the streak). Paladin with Sanctuary: two missed days (3 days).
  - With Unstoppable, the streak always continues.
  - Otherwise the streak resets to 1.
- **XP** = class and skill modifiers applied to 100 (Momentum uses your streak before this claim), plus min((streak − 1) × 5, 50), plus Early Bird (10 per level), plus Daily Surprise (15% chance of +50).
- **Streak chests:** the claim that takes your streak to **7, 14 or 30** days also pays a flat **+100, +250 or +600 XP** (source `streak_chest`). A chest pays once per streak run: if the streak breaks and you climb to 7 again, you earn it again, but the same run never pays a milestone twice. The claim's result reports the Daily Surprise (`surpriseBonus`) and the chest (`chest: {streak, xp}`).

### Leaderboard boards

The leaderboard defaults to **lifetime XP** (the never-reset total, so buying a class or skill never lowers your rank and prestiging doesn't either). Other boards: **earned this week** (XP from creating lists and tasks, completing tasks, daily rewards, free-game wins, quests, the bonus sources, focus sessions and the weekly review since Monday 00:00 UTC; bets and refunds don't count. This board is global, so its week is the UTC week for everyone, not yours), **daily streak** (a streak whose claim window has passed shows as 0 instead of lingering until your next claim), and **current balance**. Any board can be filtered by class, and your own rank respects that filter.

### Streak freeze

A **streak freeze** costs 150 XP (hold at most 3). With Freeze Cache the price is 120 XP and you can hold 5. It is used automatically when you claim your daily reward after a gap that would otherwise reset a streak of 2 or more days. **One freeze covers one missed day**: every calendar day past your streak window (1 day, 2 with protection, 3 with Sanctuary) costs one freeze, so a long absence needs several and a months-old streak cannot be saved. Momentum and the streak leaderboard count a streak that has lapsed (and not yet been claimed over) as 0. Order of protection: Unstoppable (free, always) first, then the longer window (Streak Shield, Paladin, Sanctuary), then a freeze. A freeze never gets spent while your streak is alive or when the streak is 1.

## 5b. Quests

Daily, weekly and monthly quests, with periods in **your** time zone (daily: your day; weekly: Monday 00:00 to Monday 00:00 your time; monthly: the 1st to the 1st). The rotating weekly quest is picked by your local ISO week. Progress comes from what you actually did in the period, and each quest can be claimed once per period for a flat XP reward (no class or skill modifiers). A quest or the weekly review pays once per real period: a claim made earlier in the current period blocks another one even if a time zone change gave the period a different start date.

| Quest | Period | Goal | Reward |
|---|---|---|---|
| ⚒️ Daily Grind | Daily | Complete 3 tasks | 30 XP |
| 🏋️ Heavy Lifter | Daily | Complete a high-priority task (the task's own priority, else its list's) | 25 XP |
| 🗒️ Planner | Daily | Add 3 tasks | 15 XP |
| 🛡️ Weekly Warrior | Weekly | Complete 15 tasks | 120 XP |
| 📆 Regular | Weekly | Claim the daily reward on 5 days | 80 XP |
| 🐉 Monthly Boss | Monthly | Complete 50 tasks this month | 400 XP |

**Rotating weekly quest.** Besides the fixed weekly quests, exactly one quest from a pool of four is live each ISO week (the ISO week number mod 4 picks it, so the pool cycles every four weeks). The other three are neither listed nor claimable that week.

| Quest | Goal | Reward |
|---|---|---|
| 🌅 Early Riser | Finish 5 tasks before their due date | 60 XP |
| 🧹 Tidy Up | Clear 2 lists (a list of 3+ tasks whose last task you finish; each list counts once) | 60 XP |
| 🪣 Spring Cleaning | Complete 10 overdue tasks | 80 XP |
| 🗓️ Planner Pro | Add 10 tasks with due dates | 50 XP |

**Shared lists.** On a list shared with you, quests count **you**: a task you complete counts for your completion quests, and a task you add counts for yours, whoever owns the list. Clearing a list pays and counts the person who finished its last task. The owner gets nothing for a member's work, and a member gets nothing for the owner's.

What counts: a task counts toward the completion quests once, at the moment it is first completed (the same moment its completion XP is paid), so un-checking and re-checking never moves it into a new period. *Heavy Lifter* uses the task's priority at that moment, so raising it afterwards does not qualify. Imported tasks and the next copy a repeating task creates never count towards any quest (adds or completions). *Early Riser* and *Spring Cleaning* use whether the task was early or overdue **at its first completion**, so editing the due date afterwards changes nothing. A progress reset clears your claims.

## 5c. Bonus XP sources

Every source below is **flat XP** (no class or skill modifiers, except the prestige multiplier on class-modified XP), is paid in its own `xp_transactions` source, counts for the weekly board, and has a cap. Task bonuses are paid only on a task's **first, paid completion** (so un-checking and re-checking pays nothing, and neither does a completion that hit the 50-a-day cap) and never for imported tasks or auto-created repeat copies. They are listed in the completion result as `bonuses: [{key, label, xp}]`.

**Overdue and early effects need an aged due date.** A due date counts as early or overdue (for `early_finish`, `overdue_clear`, the Ranger and Necromancer bonuses, and the *Early Riser* and *Spring Cleaning* quest facts) only if it was set at least 24 hours before the completion. A task created or re-dated within the last day completes normally, with no overdue or early extras, so a made-up past or far-future date cannot be farmed on the same day. Because a standing routine can still create dated tasks every day, the Ranger and Necromancer also count only your first 8 early or overdue completions of a day (`LIMITS.CLASS_DEADLINE_PER_DAY`); after that the date counts as none for the class. Editing a due date to a different day restarts the clock; a repeating copy is stamped when it spawns.

| Source (`xp_transactions.source`) | Amount | Cap |
|---|---|---|
| `first_of_day` | +10 for the first task you complete each day (yours) | Once per day |
| `list_cleared` | +25 when your completion leaves a list of 3+ top-level tasks all done | Once per list, ever (re-opening a cleared list by adding or un-checking tasks does not reset it; the Artisan's project bonus follows the same rule), 5 lists a day |
| `early_finish` | +5 per day early (max +20 per task) for a task with a due date | Shares 100 XP a day with `overdue_clear` |
| `overdue_clear` | +10 for completing an overdue task | Shares 100 XP a day with `early_finish` |
| `subtasks_done` | +10 when you finish the last open subtask of a parent | Once per parent, 10 XP a day |
| `streak_chest` | +100 / +250 / +600 at a 7 / 14 / 30 day streak ([daily reward](#5-daily-reward)) | Once per streak run |
| `achievement_reward` | +25 for each newly unlocked achievement | Each achievement unlocks once |
| `habit_bonus` | +2 per step of a repeating task's habit streak, from a streak of 2 (max +20 per completion) | 60 XP a day |
| `perfect_day` | +30 when every top-level task due today on your own lists is done (at least 3 of them) | Once a day |
| `inbox_zero` | +40 when your completion clears the last overdue task, after at least 3 overdue tasks cleared that week | Once a week |
| `boss_defeated` | +30 when you finish the last open subtask of a task that has at least 4 subtasks | Once per task, 60 XP a day |
| `comeback` | +25 for the first completion after 3 idle days (the previous paid completion is 3 or more days old) | Once a week |
| `party_assist` | +3 for every completion while you are in a party of two or more | 15 XP a day |
| `estimate_accuracy` | +10 when a task you gave an estimate is finished within 10 minutes after a focus session whose real minutes are within 25% of the estimate | 30 XP a day |
| `reflection` | +10 for a one-line note about your day ([reflection](#5e-reflection-and-weekly-goal)) | Once a day |
| `weekly_goal` | +10 + 2 per task of your goal, at most 80, when you reach the goal you set ([weekly goal](#5e-reflection-and-weekly-goal)) | Once a week |
| `focus_session` | floor(minutes × 0.6) per [focus session](#5d-focus-sessions) | 100 XP and 8 sessions a day |
| `weekly_review` | +40 ([weekly review](#5e-weekly-review)) | Once per week |

**The weekly modifier.** Every UTC ISO week (the same week for everybody, like the weekly board) doubles one flat bonus source; the week number mod 4 picks it, so the four rotate: **Early-bird week** (`early_finish`), **Cleanup week** (`overdue_clear`), **Habit week** (`habit_bonus`) and **Tidy week** (`list_cleared`). The doubled amount still counts against the source's daily cap. Operators can turn the modifier off with `XP_WEEKLY_MODIFIER=off`.

**Achievement rewards** are paid in the transaction that unlocks the achievement. The XP can itself unlock an XP or level achievement, which pays in turn; the check repeats until nothing new unlocks (it always ends, because every achievement unlocks once). With XP off, achievements still unlock but pay nothing.

**Habit streaks.** A repeating task carries a `habit_streak`: finishing it on or before its due date adds one to the next copy, finishing it late resets it to 0. Finishing a copy a whole recurrence period early (daily: a day early, weekly: 7 days, monthly: 28) neither adds nor resets, and pays nothing, so ticking copies off the moment they appear cannot grow a streak.

## 5d. Focus sessions

A server-timed work timer. `POST /api/focus/start {minutes}` (10 to 90) starts a session and `POST /api/focus/finish {sessionId}` ends it. The server credits **min(planned, elapsed) real minutes** and only when at least 10 minutes passed; the payout is `floor(minutes × 0.6)` XP. Finishing sooner than 10 minutes cancels the session with no XP, and a session left running for more than 3 hours expires with none. Each session settles once, starting a new session cancels the unfinished one, and a day pays at most **100 XP across 8 sessions** (the ninth start is refused).

## 5e. Weekly review

Once per week of yours (Monday to Monday in your time zone) you can claim **+40 XP** after finishing at least one task that week (first completions only; imported and auto-created copies don't count). `GET /api/review` shows the week's finished tasks, the XP earned and whether the review is claimable; `POST /api/review/claim` pays it.

## 5e. Reflection and weekly goal

Two small, player-driven sources (flat XP, no class or skill modifiers):

- **Reflection.** One short note a day (1 to 200 characters, your day and time zone) pays **+10 XP** once. `POST /api/reflection {note}`. The note is saved even when XP is off.
- **Weekly goal.** Pick how many tasks you will finish this week, **3 to 60**. Finish them (the same count as the [weekly review](#5e-weekly-review)) and claim **10 + 2 XP per task of the goal, at most 80**, once a week. The goal must be above what you have already finished this week, so it cannot be set after the fact; it can be changed while it is open. `PUT /api/goal {target}`, `POST /api/goal/claim`.

## 5f. Prestige

At **level 30** you can prestige (`POST /api/user/prestige` with `{"confirm":"PRESTIGE"}`, at most 10 times). It **resets** your balance, level (back to 1), class (back to Default), class ownership, skills, class counters and streak freezes. It **keeps** your achievements, quest claims, tasks, daily streak and spending history. Each prestige adds a permanent **+2% XP multiplier** (up to +20%) to class-modified XP, **+1 flat XP on every task completion** (up to +10) and gives you a title:

| Prestiges | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Title | Veteran | Seasoned | Champion | Elite | Master | Grandmaster | Legend | Mythic | Ascendant | Eternal |

Level comes from `lifetime_xp`, so prestige resets it; the never-reset `lifetime_xp_total` feeds the XP achievements and the lifetime leaderboard, so neither moves. The multiplier is added to your other multipliers, so on small amounts the extra XP rounds down (10 base XP stays 10 until about +5%); the flat +1 per prestige is why a prestige is felt on a plain task too.

## 5g. Cosmetics (the shop)

Titles, avatar frames and profile accents are an XP sink with **no gameplay effect**: they never change how much XP you earn. Buy them in the web app's **Shop** page or with `/shop` in Discord. Each is bought once with XP (source `cosmetic_purchase`, which counts as spending for `xp_spent` and the spending achievements) and is yours until a progress reset. A few also need something earned first: a level, a prestige or an achievement. The server checks the requirement, your balance and ownership in one locked transaction, so a double click or two devices cannot charge twice.

- A **title** shows next to your name in the sidebar, on your profile, on the leaderboard and in `/profile`.
- A **frame** is a coloured ring around your avatar on the web app.
- An **accent** colours your name and a bar on your own web profile. Every accent is held to a 4.5:1 text contrast on the card surfaces in both themes.

You can equip one of each kind (or none). **Prestige keeps** everything you own and have equipped; a **progress reset** (`/api/user/reset`) removes owned cosmetics and clears what is equipped. With XP turned off nothing can be bought, but equipped items still show.

**Titles**

| Name | Cost | Needs |
|---|---|---|
| the Diligent | 300 XP | - |
| Taskbreaker | 600 XP | Unlock the First Victory achievement |
| Night Owl | 400 XP | - |
| Early Bird | 400 XP | - |
| the Organiser | 500 XP | Unlock the Organization Pro achievement |
| the Relentless | 1200 XP | Reach level 20 |
| Completionist | 1500 XP | Unlock the Completionist achievement |
| the Reborn | 2000 XP | Prestige once |

**Frames**

| Name | Cost | Needs |
|---|---|---|
| Bronze ring | 250 XP | - |
| Silver ring | 400 XP | - |
| Gold ring | 600 XP | Reach level 10 |
| Aurora ring | 750 XP | Reach level 15 |
| Ember ring | 800 XP | Unlock the Achiever achievement |
| Ascendant ring | 1000 XP | Prestige once |

**Accents**

| Name | Cost | Needs |
|---|---|---|
| Ocean | 200 XP | - |
| Forest | 200 XP | - |
| Plum | 300 XP | - |
| Ember | 300 XP | - |
| Rose | 400 XP | Reach level 5 |
| Slate | 500 XP | Reach level 10 |

## 5h. Parties

A party is a group of up to **6** people (the owner included) with one shared **weekly quest**. You can be in one party at a time; the owner invites people (`/party invite` with a mention, the web Party page by exact Discord username with a confirmation), they accept, and the owner can disband it. Members see each other's **display names and this week's counts** and nothing else (no XP, levels, lists or progress elsewhere).

| | |
|---|---|
| Window | One global ISO week, **Monday 00:00 UTC to the next Monday**, the same for every member (members live in different time zones, so no personal week could be shared) |
| Goal | **12 tasks for each member who finished at least 6 tasks themselves this week** (at least one member's worth): a party of 3 where all three took part needs 36; a seat that did nothing, or only a task or two, does not raise it and does not count toward the progress |
| Progress | The sum of each member's *first completions* in the window **since they joined this party** (the same tasks that count for quests: imported tasks and auto-created repeats never count, un-checking and re-checking changes nothing), at most 12 per member, so nobody can carry the party alone. A task counts for the person who completed it, also on a shared list; a progress reset starts everything from zero, tasks finished earlier on other people's lists included. |
| Reward | **+60 XP** (flat, no class or skill modifiers) for **every member who finished at least 6 tasks themselves** (half of 12) since joining, claimed by each of them once the goal is reached (`/party status` → Claim, or the web Party page) |
| Once a week | One party reward per person per week, whichever party it came from, so leaving and joining another party cannot pay twice (the claim is a `quest_claims` row with key `PARTY_<partyId>`) |

**The board and the focus quest.** The party also has a **board**: this week's finished tasks and focus minutes for every member, best first (ties by minutes). And a second weekly quest, **Focus together**: the members' finished [focus](#5d-focus-sessions) minutes this week (since they joined, at most **60** counted per member) must reach **60 minutes for every member who focused at all**; each member who focused at least **20 minutes** themselves claims **+40 XP** (flat) once a week (a `quest_claims` row with the key `PARTYFOCUS_<partyId>`, so the task quest above and this one are separate claims). `/party status` shows both, with a second Claim button; the web Party page has a "Focus together" card and the board.

The target uses the members who have finished at least 6 tasks at the time you look or claim, so the goal grows when someone starts taking part and shrinks when someone leaves or is removed. The owner can remove a member (`/party kick`, the web Party page). A person with XP turned off sees the quest but cannot claim.

## 6. Achievements

There are 33 achievements. They unlock in the same transaction as the action that earned them.

| Category | Keys and thresholds |
|---|---|
| Lists (lists ever created) | `FIRST_LIST` 1 · `FIVE_LISTS` 5 · `TEN_LISTS` 10 |
| Productivity (tasks ever added) | `FIRST_ITEM` 1 · `TEN_ITEMS` 10 · `FIFTY_ITEMS` 50 · `HUNDRED_ITEMS` 100 |
| Completions (tasks ever completed) | `FIRST_COMPLETE` 1 · `TEN_COMPLETE` 10 · `FIFTY_COMPLETE` 50 · `HUNDRED_COMPLETE` 100 |
| XP (lifetime) | `XP_100` · `XP_500` · `XP_1000` · `XP_5000` · `XP_10000` |
| Levels | `LEVEL_5` · `LEVEL_10` · `LEVEL_25` · `LEVEL_50` |
| Streaks (daily) | `STREAK_3` · `STREAK_7` · `STREAK_14` · `STREAK_30` |
| Classes | `FIRST_CLASS` (any purchased class) · `ALL_CLASSES` (own every class; achievements are never revoked, so adding classes does not take it away from anyone who had it) |
| Games | `FIRST_GAME` (1 finished game) · `GAME_WIN_10` (10 wins) · `BLACKJACK` (a natural) · `HIGH_ROLLER` (500+ net XP in one game) |
| Economy (XP spent on classes, skills and streak freezes) | `SPEND_1000` · `SPEND_5000` · `SPEND_10000` |

Counters never decrease, so deleting lists or tasks doesn't undo achievements.

## 7. Games

### Blackjack

- One 52-card deck per hand, shuffled with Fisher–Yates and a CSPRNG. The dealer stands on all 17s.
- **Bet:** 10 to min(⌊25% of balance⌋, 1000). This means you need at least 40 XP to bet the minimum.
- The bet is deducted when the cards are dealt (escrow). Double down deducts the bet again and draws exactly one card.

| Outcome | Returned to you |
|---|---|
| Natural blackjack (player only) | bet + ⌊1.5 × bet⌋ |
| Win | bet + bet |
| Push (incl. both naturals) | bet |
| Loss / bust / dealer natural | nothing |

- Hands left unfinished for 30 minutes expire. Every expired hand is settled as if you had stood: the dealer plays out and it pays normally, whether or not you had acted. There are no refunds, so looking at the deal and walking away from a bad hand costs the bet.
- Class and skill bonuses never apply to blackjack: paying more than 1:1 would make the game a positive-expectation XP farm.

### Rock Paper Scissors

The server picks uniformly at random. A win pays 10 base XP (with bonuses). Ties and losses pay nothing and cost nothing.

### Hangman

You get a random 5–6 letter word and 6 lives. A wrong letter costs a life. Winning pays max(10, 10 × lives left) base XP. Losing costs nothing.

### Arcade (web only)

| Game | Points | XP per point | Max XP per run | Max plausible points / second |
|---|---|---|---|---|
| 🐍 Snake | pellets eaten | 2 | 100 | 2 |
| 🦖 Dino Runner | obstacles passed | 1 | 100 | 2 |
| 👾 Space Invaders | aliens destroyed | 3 | 150 | 3 |

A run must be started on the server before playing; the server issues a random seed and the game is a deterministic simulation from that seed. Your browser records every input with the step it was given on and sends that timeline with the score when the run ends. **The server replays the timeline and pays on the score it derives itself**, so a score cannot simply be edited or made up. A run is rejected (and cancelled) if it does not replay to the claimed score, lasts longer than about 10 minutes, has inputs faster than a person can press them, or does not fit the real time elapsed since it started. A score above `seconds × rate + 1` is also rejected, and each run can be submitted once. If the game page was open before an update, the server asks you to refresh it. Starting a run uses the same 3-second cooldown as RPS and Hangman, and a run that scores 0 is recorded as a loss, not a win.

The simulations use a fixed time step (Snake 10 steps a second, Dino Runner and Space Invaders 60). Space Invaders' fire rate is therefore counted in steps (one shot per 15 steps, about 4 a second), and the seed shifts its alien formation. Each bullet destroys at most one alien.

## 8. Limits and anti-farming

### Your day

Every "per day" below, the quests, the weekly review and the Stats page use **your** time zone (`/timezone` or web Settings; UTC until you set one): a day starts at 00:00 local time, a week on Monday 00:00 and a month on the 1st. A daylight-saving day is 23 or 25 hours long. Two players can therefore reset at different moments, and the daily reward follows your calendar days for the streak (claim on consecutive days; a missed day needs protection) while its 24-hour cooldown is still a rolling clock. Nothing is rewritten when you move: past XP keeps its instant, and from the change on the new zone decides what "today" is, so a change can move the start of today's window (and re-open or close a cap for a few hours). To stop zone-hopping from resetting caps, **a zone change is allowed once every 24 hours** (the first change, and saving the same zone, are always allowed). The one exception is the weekly leaderboard, which is global and always starts its week Monday 00:00 UTC.

| Limit | Value |
|---|---|
| Rewarded list creations per day | 10 |
| Rewarded task additions per day | 50 |
| Rewarded task completions per day | 50 (and once per task, ever) |
| HIGH priority completions that count as HIGH per day | 3 (Vow, Rally, Sniper and Crusade; the Heavy Lifter quest only needs one) |
| Streak freezes held | 3 (5 with Freeze Cache) |
| Quest claims | Once per quest per period (daily, weekly or monthly) |
| First-of-day bonus | Once per day |
| List-cleared bonus | Once per list, 5 a day |
| Early-finish + overdue-clear bonuses | 100 XP a day together |
| Subtasks-done bonus | Once per parent, 10 XP a day |
| Habit bonus | 20 XP per completion, 60 XP a day |
| Focus sessions | 10 to 90 minutes each, 100 XP and 8 sessions a day, one active session |
| Weekly review | Once per week |
| Reflection | Once a day, 1 to 200 characters |
| Weekly goal | A target of 3 to 60 tasks, claimed once a week; the reward is at most 80 XP |
| Party quest | 12 first completions for each member who finished at least 6 in the UTC week (at most 12 counted per member, only since joining); +60 XP once per person per week, and only after 6 tasks of their own |
| List members | 10 people besides the owner (members and pending invitations); 30 invitations a day per person; an invitation lives 7 days |
| Party members | 6 including the owner, one party per user |
| Streak chests | Once per streak run (7, 14, 30 days) |
| Achievement rewards | 25 XP, once per achievement |
| Prestige | Level 30, at most 10 times |
| Import / export | Imports never grant XP, counters or achievements |
| Free-game XP (RPS + Hangman + arcade) per day | 500 |
| Time zone changes | Once every 24 hours |
| Cooldown between RPS and Hangman rounds | 3 seconds |
| Abandoned game session timeout | 30 minutes |
| Web API rate limit | 900 requests / 15 min; games 90 / min |
