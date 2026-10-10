# Design: arcade anti-cheat

| | |
|---|---|
| **Status** | Proposal, not built |
| **Why a design and not code** | Every option has a real cost in complexity or fairness, and the current exposure is small and bounded. This note makes the trade-off explicit so it can be decided on purpose. |
| **Related** | [KNOWN_ISSUES #1](../KNOWN_ISSUES.md), `packages/shared/src/games/arcade.js`, `packages/shared/src/db/games.js` (`startArcade`, `finishArcade`) |

## Where we are

Snake, Dino Runner and Space Invaders run **in the browser**. The server cannot see the game, so it only:

1. issues a run (`startArcade`, which cancels any previous active run of that game),
2. measures how long the run lasted (server clock),
3. rejects a score above `floor(seconds × maxPointsPerSecond) + 1` (a rejected score now cancels the run for good),
4. caps XP per run (`maxXP`: 100 / 100 / 150) and, across all free games, at 500 XP per UTC day.

**Worst case today:** a script that waits long enough and submits the highest plausible score earns the daily 500 XP cap. It cannot mint more, cannot affect other players' balances, and cannot do it faster than real time. The maximum damage is therefore **500 XP per account per day**, which is about the same as playing honestly for a while.

## Threat model

| Attacker | Goal | Today |
|---|---|---|
| Casual cheater editing the score in dev tools | Max XP per run | Works up to the plausibility bound and run cap |
| Bot playing the real game faster than a human | Reach the cap with less effort | Works; bounded by the cap |
| Many accounts running scripts | Farm XP for spending or the leaderboard | Each capped at 500 XP/day; the weekly leaderboard counts game XP, so it can skew |
| Replay of a recorded run | Same as above | Possible (each run needs a fresh server-issued id, but the score is just a number) |

The realistic harm is **leaderboard distortion** (weekly and balance boards) and a faster path to XP purchases, not an economy break.

## Options

### A. Do nothing more (status quo)
Document the bound (done) and rely on the cap. Cheapest; acceptable while the cap stays at 500 XP/day and the games are a side feature.

### B. Tighten the bound (small, safe)
- Calibrate `maxPointsPerSecond` from real play data instead of the current generous values.
- Add a **minimum** duration per point (humans cannot eat a pellet every tick forever).
- Remove arcade XP from the **weekly leaderboard** sources (`WEEKLY_XP_SOURCES` includes `game_reward`), so cheating cannot affect the visible competition.
- Per-account cooldown between runs of the same game.

Effort: a few days, low risk. This is the recommended next step.

### C. Signed checkpoints (medium)
The client reports progress at intervals (for example every 5 seconds: score, tick count). The server signs a chain: `checkpoint[n] = HMAC(secret, run_id || n || score || checkpoint[n-1])`, returns it, and the client must present the last checkpoint with the final score. This stops editing the final score in isolation and enforces a monotonic, time-consistent score curve, but a script can still produce a plausible curve.

### D. Input replay validation (large)
The client sends the **inputs** (key events with tick numbers) and the server re-simulates the game deterministically to recompute the score. This is the only option that truly verifies play.

Requirements and costs:
- The three games must be rewritten as deterministic simulations (seeded RNG supplied by the server at run start, fixed timestep: `startFixedLoop` is a first step), shared between the browser and the Node server (a pure module in `packages/shared/src/games/`).
- The server needs a headless simulation per game and a CPU budget (a 2-minute run at 60 ticks/s is about 7,200 steps; cheap, but it must be rate-limited).
- A bot that *plays well* still passes (it generates legitimate inputs); only impossible or edited runs fail.

Effort: weeks. Worth it only if arcade XP becomes valuable (for example if the cap is raised or prizes are attached).

## Recommendation

1. **Now:** option B (calibrate bounds, drop arcade XP from the weekly board, add a cooldown). Keep the 500 XP/day cap as the hard ceiling.
2. **If cheating is observed or the cap rises:** option D for the one game that is abused, starting with Snake (simplest rules, smallest state).
3. Skip C: it adds protocol complexity without closing the real gap.

## Metrics to watch

- Share of finished runs that hit the plausibility bound exactly (a spike means scripted submissions).
- Accounts reaching the 500 XP cap with arcade games only, per day.
- Rejected-score rate per account.
