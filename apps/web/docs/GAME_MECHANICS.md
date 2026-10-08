# TaskQuest Game Mechanics

This is the reference for every number that affects XP, levels, classes, skills, achievements, rewards and mini-games in TaskQuest v1.5.

Sources: `server/gameData.js` (definitions), `server/gameLogic.js` (XP maths), `server/db.js` (ledger, daily claim, achievements), `server/index.js` (routes), and `src/pages/Games.tsx` (in-browser game rules).

Where the documented intent and the implementation differ, this document describes the **implementation** and marks the difference with ⚠️. [SECURITY.md](../SECURITY.md) and [PRD.md](PRD.md#11-known-gaps-and-roadmap) track each one.

---

## Contents

1. [XP and levels](#1-xp-and-levels)
2. [Base XP sources](#2-base-xp-sources)
3. [The XP pipeline (`calculateFinalXP`)](#3-the-xp-pipeline-calculatefinalxp)
4. [Classes](#4-classes)
5. [Skills](#5-skills)
6. [Daily reward and streaks](#6-daily-reward-and-streaks)
7. [Achievements](#7-achievements)
8. [Mini-games](#8-mini-games)
9. [Leaderboard](#9-leaderboard)
10. [Known discrepancies](#10-known-discrepancies)

---

## 1. XP and levels

XP is a **spendable balance**, not a lifetime total.

- **Level** = `floor(player_xp / 100) + 1`. Each level is 100 XP.
- Anything that spends XP lowers both `player_xp` and the derived level: buying a class, buying or upgrading a skill, and losing a bet.
- The balance is floored at zero: `balance_after = max(0, balance_before + amount)`.
- Every XP change through `addXPTransaction` writes an `xp_transactions` row. The row records the requested `amount`, not the effective change after the floor.
- ⚠️ Buying a class or a skill writes `player_xp` directly and does **not** write a ledger row or recompute `player_level`. The stored level can therefore be stale until the next XP event.
- ⚠️ The frontend hardcodes 100 XP per level (`totalXP % 100` in `Dashboard.tsx` and `Profile.tsx`). If the level curve changes, those progress bars need updating too.

Achievements that reference XP (see [section 7](#7-achievements)) use the **current balance**, so spending XP can make them harder to reach.

---

## 2. Base XP sources

These are the base amounts before class and skill modifiers.

| Action | Route | Base XP | Notes |
|---|---|---|---|
| Create a list | `POST /api/lists` | **10** | Only when `gamification_enabled` is on. |
| Add an item | `POST /api/lists/:listId/items` | **5** | Only when gamification is on. |
| Complete an item | `PATCH /api/items/:id/toggle` | **10** | Awarded on the transition to complete. |
| Daily claim | `POST /api/user/daily` | **100** (`DAILY_XP`) | See [section 6](#6-daily-reward-and-streaks). |
| Free arcade game win | `POST /api/games/result` | Equals the reported score | See [section 8](#8-mini-games). |
| Betting game win | `POST /api/games/result` | Net winnings | See [section 8](#8-mini-games). |

⚠️ Toggling an item off and on again awards the 10 XP each time, and increments `total_items_completed` each time. Creating and deleting lists and items is similarly farmable. See [SECURITY.md](../SECURITY.md#xp-farming).

---

## 3. The XP pipeline (`calculateFinalXP`)

Every XP-granting action that runs through gamification goes through `calculateFinalXP(user, userSkills, baseXP)` in `server/gameLogic.js`. The steps, in order:

1. **Class step.** `calculateClassXP` applies the equipped class rule (section 4). This returns `classXP`, a `bonusInfo` breakdown and any counter updates to persist.
2. **Skill multiplier and flat bonus.**
   ```
   finalXP = floor(classXP × xpMultiplier) + flatXPBonus
   ```
   `xpMultiplier` starts at `1.0` and is increased by skills (section 5). `flatXPBonus` is the sum of skill flat bonuses.
3. **Crit roll.** If `critChance > 0` and `random × 100 < critChance`, then `critBonus = floor(finalXP × 0.5)` is added. That makes a crit **1.5×**, not the 2× that the skill text implies (see [section 10](#10-known-discrepancies)).
4. **Breakdown string.** The toast shows `Base: N | <class detail> | 📚 Skill +N | 💥 Crit +N`. The breakdown only appears when at least one bonus is non-zero.

The result is `{finalXP, bonusInfo, userUpdates}`. The caller adds `finalXP` to the ledger with source `list_create`, `item_create`, `task_complete`, `daily` or `game_reward`, and persists `userUpdates`.

When gamification is **off**, the base amount is awarded unchanged and class and skill modifiers are skipped.

---

## 4. Classes

There are seven classes. `DEFAULT` is free and owned by everyone. The other six are bought with XP. Buying a class also equips it. Equipping (or buying) resets that class's counters to 0.

| Class | Cost (XP) | Rule | Persistent state |
|---|---|---|---|
| DEFAULT | 0 | No modifier. | none |
| HERO | 500 | **+25 flat XP** on every action. | none |
| GAMBLER | 300 | Random. See below. | none |
| ASSASSIN | 400 | Streak bonus that grows with every action. See below. | `assassin_streak`, `assassin_stacks` |
| WIZARD | 700 | Combo and burst cycle. See below. | `wizard_counter` |
| ARCHER | 600 | Hit, headshot and perfect-shot rolls. See below. | `archer_streak` |
| TANK | 500 | Stacking shield bonus. See below. | `tank_stacks` |

### GAMBLER
- `bonus = floor(random × (base + 100))`.
- With probability **20%** the action is a loss: `lost = min(bonus, base − 1)` and `finalXP = max(1, base − lost)`.
- Otherwise `finalXP = base + bonus`.

### ASSASSIN
- Every action increments `assassin_streak`. There is no decay, reset-on-miss or cap on the streak itself.
- At streak **3 or more**, `assassin_stacks` increases by 1 per action, capped at **10**.
- Bonus = `floor(base × 5 × stacks / 100)`, so +5% per stack, up to +50%.
- Below streak 3 there is no bonus.

### WIZARD
- `wizard_counter` increments per action and wraps to 0 after reaching 5.
- `wisdom = player_level × 5`.
- Counter **5** → **BURST**: `+2 × wisdom`.
- Counter **3** → **COMBO**: `+1 × wisdom`.
- Counters **1, 2 and 4** → no bonus.

### ARCHER
- `hitChance = min(97, 80 + level × 0.5)`. A roll `< hitChance` is a hit.
- **Hit:** `archer_streak = min(15, streak + 1)`, and bonus = `floor(base × streak × 8 / 100) + 3 + streak`.
  - **Headshot:** if `roll < min(30, hitChance × 0.2)` (about 16 to 19.4), add `2 × base + 3 × streak`.
  - **Perfect shot:** a separate 5% roll adds `4 × base + 10 × streak`.
- **Miss:** `archer_streak = max(0, streak − 2)`. No bonus.

### TANK
- `tank_stacks` increments per action, capped at `max(3, 20 − level)`.
- Bonus = `floor(base × stacks × 4 / 100) + floor(stacks / 2)`.
- Stacks do not decay during play. They reset on equip or progress reset.

### Notes
- Class counters are stored as columns on `users` and are reset to 0 on every class equip and on progress reset.
- Class ownership is stored as `owns_hero`, `owns_gambler`, and so on. `DEFAULT` needs no ownership row.
- Equipping requires ownership, but buying an owned class is rejected with `Already owned`.
- ⚠️ Assassin never decays. After three actions the bonus is permanently on until a reset, and it reaches its maximum after ten more.

---

## 5. Skills

Skills are bought and upgraded with XP. A skill belongs to one class tree. The class must be **owned**, not necessarily equipped. Skill bonuses are applied on every XP event regardless of which class is equipped, so skills from all owned trees stack.

### Rules
- **Cost** is flat per level. A level-2 unlock costs the same as a level-1 unlock, and the cost is not multiplied by level.
- **Prerequisite** must be owned at **level 1 or higher**, not at max level.
- A skill can be bought once per level up to `maxLevel`.
- `skill_points` is read by the API but is never granted, so skills are effectively XP-only.

### Skill tree

Costs are XP. "Effect" describes what `getSkillBonuses` does. ✅ means the effect is implemented, and ❌ means the skill can be bought but has no effect.

**DEFAULT** (no class cost)

| Skill | Cost | Max | Requires | Effect |
|---|---|---|---|---|
| Quick Learner (`default_xp_boost`) | 50 | 3 | — | ✅ +5% XP multiplier per level |
| Early Bird (`default_daily_boost`) | 75 | 2 | Quick Learner | ✅ +10 daily XP per level |
| Streak Shield (`default_streak_shield`) | 100 | 1 | Early Bird | ❌ Sets a flag that nothing reads |

**HERO** (requires the Hero class)

| Skill | Cost | Max | Requires | Effect |
|---|---|---|---|---|
| Valor (`hero_valor`) | 100 | 3 | — | ✅ +10 flat XP per level |
| Inspire (`hero_inspire`) | 150 | 2 | Valor | ✅ +8% XP multiplier per level |
| Champion (`hero_champion`) | 200 | 1 | Inspire | ❌ |
| Legendary (`hero_legend`) | 300 | 1 | Champion | ✅ +25% XP multiplier |

**GAMBLER** (requires the Gambler class)

| Skill | Cost | Max | Requires | Effect |
|---|---|---|---|---|
| Lucky Streak (`gambler_lucky`) | 80 | 3 | — | ❌ Computes a luck value nothing reads |
| Double Down (`gambler_double`) | 120 | 2 | Lucky Streak | ❌ |
| Safety Net (`gambler_safety`) | 150 | 2 | Double Down | ❌ |
| Jackpot (`gambler_jackpot`) | 250 | 1 | Safety Net | ❌ |

**ASSASSIN** (requires the Assassin class)

| Skill | Cost | Max | Requires | Effect |
|---|---|---|---|---|
| Swift Strike (`assassin_swift`) | 90 | 3 | — | ❌ |
| Critical Hit (`assassin_critical`) | 130 | 2 | Swift Strike | ✅ +10% crit chance per level |
| Shadow Step (`assassin_shadow`) | 180 | 1 | Critical Hit | ❌ |
| Execute (`assassin_execute`) | 280 | 1 | Shadow Step | ❌ |

**WIZARD** (requires the Wizard class)

| Skill | Cost | Max | Requires | Effect |
|---|---|---|---|---|
| Arcane Study (`wizard_study`) | 100 | 3 | — | ✅ +3 flat XP per level |
| Spell Combo (`wizard_combo`) | 150 | 2 | Arcane Study | ❌ |
| Focus (`wizard_focus`) | 200 | 2 | Spell Combo | ❌ |
| Arcane Mastery (`wizard_mastery`) | 350 | 1 | Focus | ❌ |

**ARCHER** (requires the Archer class)

| Skill | Cost | Max | Requires | Effect |
|---|---|---|---|---|
| Steady Aim (`archer_aim`) | 85 | 3 | — | ✅ +3% XP multiplier per level |
| Multishot (`archer_multishot`) | 140 | 2 | Steady Aim | ❌ |
| Piercing Shot (`archer_piercing`) | 190 | 1 | Multishot | ❌ |
| Sniper (`archer_sniper`) | 300 | 1 | Piercing Shot | ❌ |

**TANK** (requires the Tank class)

| Skill | Cost | Max | Requires | Effect |
|---|---|---|---|---|
| Fortify (`tank_fortify`) | 95 | 3 | — | ✅ +5 flat XP per level |
| Absorb (`tank_absorb`) | 145 | 2 | Fortify | ❌ |
| Revenge (`tank_revenge`) | 200 | 2 | Absorb | ❌ |
| Unstoppable (`tank_unstoppable`) | 320 | 1 | Revenge | ❌ |

**Summary:** 27 skills, of which **11 are implemented** and **16 do nothing**.

⚠️ Several implemented skills do not match their in-game description. Steady Aim is described as "increased base accuracy", but its effect is a +3% XP multiplier per level. Arcane Study is described as "XP scales with level", but its effect is +3 flat XP per level. Treat the in-game descriptions as aspirational until they are corrected.

---

## 6. Daily reward and streaks

`POST /api/user/daily` is the daily claim.

### Cooldown and streak window
- **Cooldown:** 24 hours from the last claim (a rolling window, not a calendar day).
- **Streak window:** 48 hours. If the time since the last claim is **at most 48 hours**, the streak increments. Otherwise the streak resets to 1.
- `streakBroken` is `true` when a reset happens after a streak above 1.

### Reward formula

```
streakBonus = min((newStreak − 1) × 5, 50)
classBonus  = calculateFinalXP(100).finalXP − 100       (only when gamification is on)
skillBonus  = Early Bird level × 10                       (Quick Learner multiplier is already in classBonus)
total       = 100 + classBonus + streakBonus + skillBonus
```

- The streak bonus reaches its cap of **+50 at streak 11**.
- Because the daily base (100) goes through `calculateFinalXP`, Hero's +25 and Gambler's variance also apply to the daily claim, and class counters advance.
- Already-claimed responses return HTTP 200 with `success: false`, `error: "Already claimed"`, and `remaining` in milliseconds.

⚠️ Two concurrent claims can both pass the cooldown check because there is no lock. See [SECURITY.md](../SECURITY.md#race-conditions).

---

## 7. Achievements

There are **24 achievements** across seven groups. (Some earlier documentation said 25. The data file defines 24.)

Achievements are checked after most XP-affecting actions and unlocked with `INSERT IGNORE`, so each is awarded once. They are **not** checked after a skill purchase or a progress reset. No achievement awards XP.

| Group | Key | Name | Condition |
|---|---|---|---|
| Lists | `FIRST_LIST` | Getting Started | Create 1 list |
| Lists | `FIVE_LISTS` | List Master | Create 5 lists |
| Lists | `TEN_LISTS` | Organization Pro | Create 10 lists |
| Productivity | `FIRST_ITEM` | Task Beginner | Add 1 item |
| Productivity | `TEN_ITEMS` | Busy Bee | Add 10 items |
| Productivity | `FIFTY_ITEMS` | Productivity Machine | Add 50 items |
| Productivity | `HUNDRED_ITEMS` | Task Centurion | Add 100 items |
| Completion | `FIRST_COMPLETE` | First Victory | Complete 1 item |
| Completion | `TEN_COMPLETE` | Getting Things Done | Complete 10 items |
| Completion | `FIFTY_COMPLETE` | Achievement Hunter | Complete 50 items |
| Completion | `HUNDRED_COMPLETE` | Completion Master | Complete 100 items |
| Streaks | `STREAK_3` | Consistent | 3-day streak |
| Streaks | `STREAK_7` | Week Warrior | 7-day streak |
| Streaks | `STREAK_14` | Fortnight Fighter | 14-day streak |
| Streaks | `STREAK_30` | Monthly Dedication | 30-day streak |
| Levels | `LEVEL_5` | Rising Star | Reach level 5 |
| Levels | `LEVEL_10` | Veteran | Reach level 10 |
| Levels | `LEVEL_25` | Elite | Reach level 25 |
| Levels | `LEVEL_50` | Legend | Reach level 50 |
| XP | `XP_1000` | XP Hunter | Current XP balance ≥ 1,000 |
| XP | `XP_5000` | XP Master | Current XP balance ≥ 5,000 |
| XP | `XP_10000` | XP Legend | Current XP balance ≥ 10,000 |
| Classes | `BUY_CLASS` | Class Act | Own any non-default class |
| Classes | `ALL_CLASSES` | Collector | Own all six non-default classes |

⚠️ The XP achievement descriptions say "Earn 1,000 total XP". They check the **current balance**, so spending XP can make them harder to reach. The completion and item achievements use monotonic counters (`total_items_completed`, `total_items_added`), so they cannot be lost, but they can be farmed (see [section 2](#2-base-xp-sources)).

The frontend's Achievements page only displays the groups `lists`, `productivity`, `completion`, `streaks`, `levels` and `classes`. Any achievement in another category is hidden.

---

## 8. Mini-games

Games are played in the browser and the result is reported to `POST /api/games/result` with `{gameType, result, bet, payout}`. The server records a `game_sessions` row for every result, then applies XP.

⚠️ **The server does not verify the result.** It trusts the reported `result`, `bet` and `payout`, does not check that the bet is positive or affordable, and does not cap payouts. A client can report any payout for a free game. Fixing this is the top item in [SECURITY.md](../SECURITY.md#client-trusted-game-results).

### Betting games

Betting games cost a bet. The browser enforces the limits below, and the server should too.

- **Minimum bet:** 10 XP.
- **Maximum bet:** `min(floor(balance × 25%), 1000)`.
- The bet is taken from the balance only when the result is reported, so the reported net change is what matters.

#### Blackjack (`gameType` is any value not in the arcade or RPS lists)
- Standard 52-card deck. Ace is 11, or 1 when needed. Face cards are 10.
- The player and dealer each receive two cards. The dealer's second card is hidden until the player stands.
- Hit draws a card. Over 21 is a bust (loss). Stand makes the dealer draw until 17 or more.
- A natural 21 on the deal ends the round immediately as **blackjack**.
- **Payouts:** blackjack pays `1.5 × bet` profit. A win pays 1 × bet. A push returns the bet. A loss forfeits the bet.
- Results are recorded as `blackjack`, `won`, `lost` or `push`.
- Not implemented: split, double down, insurance and the dealer natural check.
- ⚠️ The deck is shuffled with `sort(() => Math.random() - 0.5)`, which gives a biased shuffle.

#### Rock-Paper-Scissors (`gameType: rps`)
- The player picks rock, paper or scissors. The CPU picks uniformly at random.
- A win pays 1 × bet profit (`payout = 2 × bet`).
- A tie returns the bet and is recorded as `push`.
- A loss costs nothing. The game is labelled **risk-free**.

#### Hangman (`gameType: hangman`)
- The word is drawn from a list of 13 tech terms in the frontend (`JAVASCRIPT`, `TYPESCRIPT`, `REACT`, `NODEJS`, `EXPRESS`, `MONGODB`, `PYTHON`, `DISCORD`, `DATABASE`, `FUNCTION`, `VARIABLE`, `COMPONENT`, `INTERFACE`).
- The entry fee is the bet. There are 6 lives.
- **Win:** pays `bet + 10 × lives remaining`. The net gain is that payout minus the bet.
- **Loss:** the bet is lost, with no bonus.
- Input is on-screen only. There is no "Play again" button, so the player returns to the menu.
- ⚠️ The server-side `HANGMAN_WORDS` list (35 five- and six-letter words in `server/gameData.js`) is not used by the server. It appears to be an unused copy.

### Free arcade games

These cost nothing. The result is the XP earned.

#### Snake (`gameType: snake`)
- 20×20 grid, one tick every 100 ms. Arrow keys or WASD, plus swipe on touch.
- The snake cannot reverse direction into itself.
- Wall or self collision ends the game.
- **XP:** `pellets × 2`, reported as `result: won` with `payout` set to the XP.
- ⚠️ Food can spawn on the snake's body.

#### Dino Runner (`gameType: dino`)
- 600×200 canvas. Jump with Space, ArrowUp, tap or click. Gravity 0.9, jump force −16.
- Cacti are 30–55 px tall. Birds appear at a 25% chance per obstacle.
- Speed rises as `6 + floor(score / 10) × 0.5`.
- Each obstacle passed scores 1. **XP = score.**
- ⚠️ The bird is drawn at `GROUND_Y − 45` but its hitbox is at `GROUND_Y − 50`, so the hitbox does not line up with the sprite.
- ⚠️ The fixed 600 px width overflows narrow phones.

#### Space Invaders (`gameType: invaders`)
- 500×400 canvas, 4 rows of 8 aliens (32 total).
- Move with arrow keys or A/D, and fire with Space (250 ms cooldown). On touch, tap the left or right half of the screen to move and shoot.
- Aliens bounce at the edges, drop 20 px at each bounce, and speed up by 0.2 per bounce, to a cap of 4.
- **Win:** kill all aliens. **Lose:** an alien reaches y > 320.
- Aliens never fire, so the player cannot be shot.
- **XP:** `kills × 3`, always reported as `won`.
- ⚠️ Bullet removal uses `splice` inside `forEach`, which can skip a bullet.
- ⚠️ The fixed 500 px width overflows narrow phones.

### How arcade XP is awarded
If the result is `won` and `payout ≥ 0`, the server treats `payout` as the base XP. With gamification on and a positive base, it goes through `calculateFinalXP`, so class and skill modifiers apply. Otherwise it is awarded raw.

---

## 9. Leaderboard

`GET /api/leaderboard` is public.

- Top **10** users, ordered by `player_xp` descending.
- Only users with `gamification_enabled = TRUE` are included.
- Each entry includes rank, Discord ID, username, avatar, XP, level, class, streak, games played and tasks completed.
- There is no tie-breaker, so equal XP is ordered arbitrarily.
- Because XP is spendable, a player's rank can drop after buying a class or skill.
- ⚠️ The endpoint makes several queries per user and is not cached.

---

## 10. Known discrepancies

Summary of where the in-game text or intended design differs from the code. Each item is fixable in data or logic, and none is a security issue on its own. The security-relevant ones are in [SECURITY.md](../SECURITY.md).

| Area | Documented | Implemented |
|---|---|---|
| Skill count | 27 skills, all active | 11 active, 16 inert |
| Crit | Described as 2× | 1.5× (`floor(finalXP × 0.5)` added) |
| Hero class | "+20% XP on all tasks" (`ClassBadge.tsx`), "+25 XP on every action" (`gameData.js`) | +25 flat XP |
| Wizard | "Every 3rd task grants 2x XP" (`gameData.js` playstyle) | Combo at counter 3 (+1× wisdom), burst at counter 5 (+2× wisdom) |
| Assassin | "+5% per stack, max 10" | Correct, but stacks never decay and the streak never resets on a miss |
| Streak Shield | Protects streak on a miss | Not implemented (no miss mechanic exists) |
| Achievements | "Earn N total XP" | Uses current balance |
| Achievement count | 25 in some docs | 24 in `gameData.js` |
| Level curve | Not documented in-game | 100 XP per level, hardcoded in the frontend |
| Blackjack limits | `MIN_BET`, `MAX_BET_PERCENT`, `HARD_CAP` | Defined in `BLACKJACK_CONFIG` but not enforced on the server |
