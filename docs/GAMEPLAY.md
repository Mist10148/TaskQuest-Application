# Gameplay reference

Every number on this page comes from [`packages/shared/src/constants.js`](../packages/shared/src/constants.js) and [`xp.js`](../packages/shared/src/xp.js). The bot and the web app use the same code, so the rules are identical on both. Randomness uses Node's CSPRNG.

## Contents

1. [XP and levels](#1-xp-and-levels)
2. [How XP is calculated](#2-how-xp-is-calculated)
3. [Classes](#3-classes)
4. [Skills](#4-skills)
5. [Daily reward](#5-daily-reward)
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
| Create a list | 10 | Only the first 10 list creations per UTC day are rewarded |
| Add a task | 5 | Only the first 50 per UTC day are rewarded |
| Complete a task | 10 | **Once per task, ever.** Un-completing and re-completing pays nothing. |
| Daily reward | 100 | Plus streak and skill bonuses (see §5) |
| RPS win | 10 | Free game |
| Hangman win | max(10, 10 × lives left) | Free game |
| Arcade run | points × rate, capped | Free game (web) |
| Blackjack win | your winnings | Bonuses apply to the winnings, not the returned bet |

## 2. How XP is calculated

For every reward:

```
1. classXP   = class mechanic(base XP)                         (§3)
2. multiplier = 1 + Σ percentage skills (+ conditional skills)   (§4)
3. final     = ⌊classXP × multiplier⌋ + Σ flat skill bonuses
4. Hero Champion: ×2 if your level is a multiple of 5
5. Crit (Assassin Critical Hit): +50 % (or +100 % with Shadow Step)
6. Double Down skill: chance to ×2
7. Jackpot skill: 1 % chance to ×10
```

Each toast or embed shows a breakdown like `Base: 10 | 🎯 Hit x4 +10 💥+32 | 📚 Skill +10`.

## 3. Classes

The Default class is free. Buying a class also equips it. Switching class resets every class counter.

| Class | Cost | Mechanic (per rewarded action) |
|---|---|---|
| ⚪ **Default** | 0 | No modifier. |
| ⚔️ **Hero** | 500 | +25 flat XP. |
| 🎲 **Gambler** | 300 | Rolls a bonus of 0 to (base + 99). 20% of the time it is *bad luck* instead: the reward shrinks by min(bonus, base − 1), and never drops below 1 XP. |
| 🗡️ **Assassin** | 400 | Each action raises the streak by 1. From streak 3, each action also adds a stack (max 10). Bonus is +5% per stack. |
| 🔮 **Wizard** | 700 | Wisdom = level × 5. The 3rd action in a cycle adds +Wisdom (Combo). The 5th adds +2 × Wisdom (Burst). Then the cycle restarts. |
| 🏹 **Archer** | 600 | Hit chance is min(97%, 80% + 0.5% × level). A **hit** raises the streak by 1 (max 15) and adds ⌊base × streak × 8%⌋ + 3 + streak. On a hit, a *headshot* triggers if the roll is under min(30, hit% × 0.2) and adds 2 × base + 3 × streak. A 5% *perfect shot* adds 4 × base + 10 × streak. A **miss** lowers the streak by 2. |
| 🛡️ **Tank** | 500 | +1 shield stack per action, capped at max(3, 20 − level). Bonus is ⌊base × stacks × 4%⌋ + ⌊stacks / 2⌋. |

## 4. Skills

- You can learn skills from the **Default** tree and from the trees of classes you **own**. The class doesn't need to be equipped for generic bonuses.
- Each level costs the listed price.
- A skill's prerequisite must be unlocked (at any level) first.
- Effects marked *(class)* only matter while that class is equipped.

### ⚪ Default

| Skill | Max | Cost/level | Effect per level | Requires |
|---|---|---|---|---|
| 📚 Quick Learner | 3 | 50 | +5% XP | — |
| 🌅 Early Bird | 2 | 75 | +10 daily-reward XP | Quick Learner |
| 🛡️ Streak Shield | 1 | 100 | The daily streak survives a missed day (72h window instead of 48h) | Early Bird |

### ⚔️ Hero

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| ⚔️ Valor | 3 | 100 | +10 flat XP | — |
| ✨ Inspire | 2 | 150 | +8% XP | Valor |
| 👑 Champion | 1 | 200 | ×2 XP while your level is a multiple of 5 | Inspire |
| 🏆 Legendary | 1 | 300 | +25% XP | Champion |

### 🎲 Gambler

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| 🍀 Lucky Streak | 3 | 80 | Bad-luck chance −5% (20% → 5%) *(class)* | — |
| 🎰 Double Down | 2 | 120 | 10% chance to double an action's XP | Lucky Streak |
| 🪢 Safety Net | 2 | 150 | Bad-luck losses 25% smaller *(class)* | Double Down |
| 💎 Jackpot | 1 | 250 | 1% chance for ×10 XP | Safety Net |

### 🗡️ Assassin

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| 💨 Swift Strike | 3 | 90 | Streak builds +1 faster *(class)* | — |
| 🎯 Critical Hit | 2 | 130 | +10% chance to crit for +50% XP | Swift Strike |
| 🌑 Shadow Step | 1 | 180 | Crits grant +100% instead of +50% | Critical Hit |
| ☠️ Execute | 1 | 280 | +100% XP at 10/10 stacks *(class)* | Shadow Step |

### 🔮 Wizard

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| 📖 Arcane Study | 3 | 100 | +3 flat XP | — |
| 🔥 Spell Combo | 2 | 150 | Combo bonus +50% *(class)* | Arcane Study |
| 🧘 Focus | 2 | 200 | +10% XP | Spell Combo |
| 🌟 Arcane Mastery | 1 | 350 | Burst = 3 × Wisdom instead of 2 × *(class)* | Focus |

### 🏹 Archer

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| 🎯 Steady Aim | 3 | 85 | +3% XP | — |
| 🏹 Multishot | 2 | 140 | +5 XP on task completions | Steady Aim |
| 💫 Piercing Shot | 1 | 190 | Misses don't reduce the streak *(class)* | Multishot |
| 🦅 Sniper | 1 | 300 | Completing a task in a HIGH-priority list is always a hit and headshot *(class)* | Piercing Shot |

### 🛡️ Tank

| Skill | Max | Cost | Effect | Requires |
|---|---|---|---|---|
| 🧱 Fortify | 3 | 95 | +5 flat XP | — |
| 💪 Absorb | 2 | 145 | +2 max shield stacks *(class)* | Fortify |
| ⚡ Revenge | 2 | 200 | +10% XP while at max stacks *(class)* | Absorb |
| 🚀 Unstoppable | 1 | 320 | The daily streak never resets. A missed day just continues it. | Revenge |

## 5. Daily reward

- **Cooldown:** 24 hours from your last claim.
- **Streak:**
  - Claiming within 48 hours of the last claim continues the streak.
  - With Streak Shield, the window is 72 hours.
  - With Unstoppable, the streak always continues.
  - Otherwise the streak resets to 1.
- **XP** = class and skill modifiers applied to 100, plus min((streak − 1) × 5, 50), plus Early Bird (10 per level).

## 6. Achievements

There are 30 achievements. They unlock in the same transaction as the action that earned them.

| Category | Keys and thresholds |
|---|---|
| Lists (lists ever created) | `FIRST_LIST` 1 · `FIVE_LISTS` 5 · `TEN_LISTS` 10 |
| Productivity (tasks ever added) | `FIRST_ITEM` 1 · `TEN_ITEMS` 10 · `FIFTY_ITEMS` 50 · `HUNDRED_ITEMS` 100 |
| Completions (tasks ever completed) | `FIRST_COMPLETE` 1 · `TEN_COMPLETE` 10 · `FIFTY_COMPLETE` 50 · `HUNDRED_COMPLETE` 100 |
| XP (lifetime) | `XP_100` · `XP_500` · `XP_1000` · `XP_5000` · `XP_10000` |
| Levels | `LEVEL_5` · `LEVEL_10` · `LEVEL_25` · `LEVEL_50` |
| Streaks (daily) | `STREAK_3` · `STREAK_7` · `STREAK_14` · `STREAK_30` |
| Classes | `FIRST_CLASS` (any purchased class) · `ALL_CLASSES` (all six) |
| Games | `FIRST_GAME` (1 finished game) · `GAME_WIN_10` (10 wins) · `BLACKJACK` (a natural) · `HIGH_ROLLER` (500+ net XP in one game) |

Counters never decrease, so deleting lists or tasks doesn't undo achievements.

## 7. Games

### Blackjack

- One 52-card deck per hand, shuffled with Fisher–Yates and a CSPRNG. The dealer stands on all 17s.
- **Bet:** 10 to min(⌊25% of balance⌋, 1000). This means you need at least 40 XP to bet the minimum.
- The bet is deducted when the cards are dealt (escrow). Double down deducts the bet again and draws exactly one card.

| Outcome | Returned to you |
|---|---|
| Natural blackjack (player only) | bet + ⌊1.5 × bet × bonuses⌋ |
| Win | bet + bet with class and skill bonuses |
| Push (incl. both naturals) | bet |
| Loss / bust / dealer natural | nothing |

- Hands left unfinished for 30 minutes are expired and the bet is refunded.

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

A run must be started on the server before playing. A score above `seconds × rate + 1` is rejected, and each run can be submitted once.

## 8. Limits and anti-farming

| Limit | Value |
|---|---|
| Rewarded list creations per UTC day | 10 |
| Rewarded task additions per UTC day | 50 |
| Completion XP | Once per task |
| Free-game XP (RPS + Hangman + arcade) per UTC day | 500 |
| Cooldown between RPS and Hangman rounds | 3 seconds |
| Abandoned game session timeout | 30 minutes |
| Web API rate limit | 900 requests / 15 min; games 90 / min |
