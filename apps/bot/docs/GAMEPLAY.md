# Gameplay and progression

This guide describes how XP, levels, classes, skills, achievements and mini-games work. The formulas come from the code in `utils/gameLogic.js`, `commands/gamification.js` and `commands/game.js`.

Where in-game text or other docs disagree with the code, the code is what is described here, and the disagreement is noted. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md) for the full list.

## 1. XP and levels

XP is the only currency. There are no coins, shops for items, pets or quests.

| Constant | Value |
|---|---|
| XP per level | 100 |
| Level | `floor(XP / 100) + 1` |

Level is computed from XP when displayed. Spending XP on classes or skills lowers the balance, and the stored `player_level` is not recalculated, so the two can disagree. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

### XP sources

| Action | Base XP | Notes |
|---|---|---|
| Create a list | 10 | Only when gamification is on |
| Add an item | 5 | Only when gamification is on |
| Complete an item | 8 | Only when gamification is on. Un-completing awards nothing. Completing again awards again. |
| Daily reward | 100 | Plus bonuses. See section 2. |
| Win a Blackjack hand | Varies | Bet payout. See section 5. |
| Win Rock-Paper-Scissors | 10 | Modified by class and skill bonuses |
| Win Hangman | `max(10, lives_left × 10)` | Modified by class and skill bonuses |

Class and skill modifiers apply to these base amounts through `calculateFinalXP`. The modifiers are described in section 3.

## 2. Daily reward

`/daily` can be claimed once every 24 hours, measured from your last claim.

| Part | Value |
|---|---|
| Base | 100 XP |
| Class bonus | Applied to the base through `calculateFinalXP`, only when gamification is on |
| Streak bonus | `min((streak - 1) × 5, 50)` |
| Skill bonus | `10 × level` of `default_daily_boost`, if owned |

**Streak.** A claim within 48 hours of the previous claim continues the streak. Otherwise the streak resets to 1 and you see a "streak lost" message if it was above 1.

**Milestones.** Streaks of exactly 7 and 30 show a special field in the embed.

**Gating.** The class bonus is gated by the gamification setting. The streak and skill bonuses are not, so they apply even when gamification is off. This is inconsistent and is listed in [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

The header comment in the code says the cooldown "resets at 4AM". The code uses a true 24-hour interval instead.

## 3. Classes

Seven classes. You start with DEFAULT. Other classes are bought with XP once, and you can then switch between owned classes at any time.

| Class | Cost | Purchase | Modifier |
|---|---|---|---|
| DEFAULT | Free | Always owned | None |
| HERO | 500 XP | `cbuy_HERO` | +25 flat per XP action |
| GAMBLER | 300 XP | `cbuy_GAMBLER` | Random swing; see below |
| ASSASSIN | 400 XP | `cbuy_ASSASSIN` | Streak stacks |
| WIZARD | 700 XP | `cbuy_WIZARD` | Periodic bonuses |
| ARCHER | 600 XP | `cbuy_ARCHER` | Hit-or-miss with streak |
| TANK | 500 XP | `cbuy_TANK` | Stack-based percentage plus flat |

Buying a class requires enough XP for its cost. It deducts the cost, marks the class as owned, equips it, and resets the class's internal counters.

Equipping an owned class also resets its counters. Counters are: `assassin_streak`, `assassin_stacks`, `wizard_counter`, `archer_streak`, `tank_stacks`.

### 3.1 Class formulas

These describe what the code does for a base XP amount of `base`.

**HERO.** `base + 25`.

**GAMBLER.** The bonus is a random number in `[0, base + 100)`.
- With 20% probability the result is a loss: `max(1, base - min(bonus, base - 1))`.
- Otherwise the result is `base + bonus`.

Note that the in-game description and the README say "0.5x to 2x". The code does not work that way. The bonus can be large, and losses are capped at the base amount. This is listed in [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

**ASSASSIN.** Each XP action increments `assassin_streak`. From 3 onwards, `assassin_stacks` rises by 1 per action, up to 10. The bonus is `base × 5% × stacks`. Nothing resets the streak except changing class.

**WIZARD.** Each action increments `wizard_counter`. Wisdom is `level × 5`.
- On every 5th action the counter gives `2 × wisdom` and resets.
- On every 3rd action (other than the 5th) it gives `wisdom`.

**ARCHER.** Each action rolls for a hit. Hit chance is `min(97, 80 + 0.5 × level)`.
- On a hit, `archer_streak` rises (capped at 15) and the bonus is `floor(base × streak × 8 / 100) + 3 + streak`.
- A headshot adds `2 × base + 3 × streak`.
- A 5% perfect shot adds `4 × base + 10 × streak`.
- On a miss, the streak drops by 2 (minimum 0) and no bonus is given.

**TANK.** Each action raises `tank_stacks` by 1, up to `max(3, 20 - level)`. The bonus is `floor(base × stacks × 4 / 100) + floor(stacks / 2)`.

The in-game class description for HERO says "+20% XP on all tasks", but the code uses +25 flat. The code is the reference here.

## 4. Skills

Skills belong to a class tree. The DEFAULT tree is available to everyone. Other trees require owning the class.

- A skill costs its listed XP, and each level costs the same amount again. Costs do not scale with level in the code.
- A skill with a `requires` entry needs that skill first.
- Max level varies by skill.
- Purchases use XP, not skill points. `skill_points` exists in the database but is not used.

There are **27 skills**: 3 in DEFAULT and 4 in each other class.

### 4.1 Skills with an implemented effect

| Skill | Class | Effect per level |
|---|---|---|
| `default_xp_boost` | DEFAULT | +5% XP (max level 3) |
| `default_daily_boost` | DEFAULT | +10 daily XP |
| `hero_valor` | HERO | +10 flat XP |
| `hero_inspire` | HERO | +8% XP |
| `hero_legend` | HERO | +25% XP |
| `assassin_critical` | ASSASSIN | +10% critical chance (critical adds +50% of the final XP) |
| `archer_aim` | ARCHER | +3% hit chance |
| `tank_fortify` | TANK | +5 flat XP |
| `wizard_study` | WIZARD | +3 flat XP |

### 4.2 Skills without an implemented effect

These skills can be bought but have no effect in the code. They are listed in [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

- DEFAULT: `default_streak_shield` (sets a flag that nothing reads).
- HERO: `hero_champion`.
- GAMBLER: double, safety and jackpot skills. `gambler_lucky` sets a luck value that nothing reads.
- ASSASSIN: swift, shadow and execute skills.
- WIZARD: combo, focus and mastery skills.
- ARCHER: multishot, piercing and sniper skills.
- TANK: absorb, revenge and unstoppable skills.


## 5. Mini-games

Games use XP as currency. Bets and payouts go through `processXPTransaction`, which uses a locked transaction and writes an audit row.

### 5.1 Blackjack

| Rule | Value |
|---|---|
| Minimum bet | 10 XP |
| Maximum bet | 25% of balance, capped at 1000 XP (defined; not enforced in the current code path) |
| Deck | Standard 52-card deck, shuffled for each hand |
| Ace | 1 or 11, whichever is better |
| Dealer | Stands on all 17s, including soft 17 |
| Blackjack | Natural 21 on the first two cards |

**Flow.**
1. You choose a bet. The bet is taken from your XP at the start.
2. Natural blackjacks resolve immediately.
3. You can hit, stand, or double down. Double down is allowed only with two cards, and only if your balance after the bet covers the extra stake. It draws exactly one card, then the dealer plays.
4. The dealer draws to 17 and stands.
5. The hand is settled.

**Payouts.**

| Outcome | Returned to you |
|---|---|
| Blackjack | Bet plus 1.5 × bet, rounded down |
| Win | 2 × bet |
| Push | Bet |
| Loss | 0 |

Doubling doubles the bet used for the payout. Class and skill bonuses apply to net winnings only, never to the returned bet. A push returns the bet with no bonus.

**Sessions.** An active hand is saved as a session. `/game` resumes it. Sessions expire after 30 minutes without activity, and the sweep runs every 15 minutes. The current code does not refund the bet of an expired session. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

**Requirements.** Blackjack needs the `blackjack_hands` table and the `game_sessions.started_at` column, which only `database/schema.sql` creates. See [DATABASE.md](DATABASE.md#auto-created-versus-schemasql).

### 5.2 Rock-Paper-Scissors

- The bot picks rock, paper or scissors at random.
- A win pays 10 XP base, modified by class and skill bonuses. Ties and losses cost nothing and pay nothing.
- The in-game text promises "+15 XP". The code pays 10 base. This is listed in [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

### 5.3 Hangman

- Word is picked at random from a built-in list of 35 five- and six-letter words.
- You have 6 lives. Each wrong guess costs one life.
- Reward on a win is `max(10, lives_left × 10)`, modified by class and skill bonuses.
- A loss pays nothing and costs nothing beyond the lives.
- The letter menu shows at most 25 options, so Z is unavailable until another letter has been guessed. Listed in [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
- Game state is in memory. A restart ends the game.

## 6. Achievements

There are **29** achievements. Each is unlocked once and stored per user. They are checked after `/daily`, list actions, and class purchases.

| Group | Keys |
|---|---|
| Lists | `FIRST_LIST`, `FIVE_LISTS`, `TEN_LISTS` |
| Items added | `FIRST_ITEM`, `TEN_ITEMS`, `FIFTY_ITEMS`, `HUNDRED_ITEMS` |
| Items completed | `FIRST_COMPLETE`, `TEN_COMPLETE`, `FIFTY_COMPLETE`, `HUNDRED_COMPLETE` |
| XP | `XP_100`, `XP_500`, `XP_1000`, `XP_5000`, `XP_10000` |
| Level | `LEVEL_5`, `LEVEL_10`, `LEVEL_25`, `LEVEL_50` |
| Streak | `STREAK_3`, `STREAK_7`, `STREAK_30` |
| Classes | `FIRST_CLASS`, `ALL_CLASSES` |
| Games | `FIRST_GAME`, `GAME_WIN_10`, `BLACKJACK`, `HIGH_ROLLER` |

**Known issues with achievements.**
- The check function is async but is called without `await`, and its arguments do not match. Unlocks may not be recorded. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
- It reads field names that do not exist on the user record.
- The four game achievements are not checked by the achievement function.

## 7. Leaderboard

The leaderboard ranks users with gamification enabled by XP, showing the top 10. It is global across all servers.

## 8. Anti-abuse

- Toggling an item between complete and incomplete awards XP each time it becomes complete. The completion counter is also incremented each time and never decreases.
- There is no per-action cooldown for list actions.
- `/daily` has a 24-hour cooldown.
- The bot does not verify that gains are the result of real work.

These are open issues. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
