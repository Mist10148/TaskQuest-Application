# Design: arcade anti-cheat

| | |
|---|---|
| **Status** | **Option D implemented** (input replay validation). Option B is **partly built** (weekly board, minimum paying run, calibration report); option C was not built. See [Implementation](#implementation-option-d) and [Option B: what shipped](#option-b-what-shipped). |
| **Why a design** | Every option has a real cost in complexity or fairness. This note made the trade-off explicit; the sections up to "Metrics to watch" describe the state and options before option D was built. |
| **Related** | [KNOWN_ISSUES #1](../KNOWN_ISSUES.md), `packages/shared/src/games/arcade.js`, `packages/shared/src/db/games.js` (`startArcade`, `finishArcade`) |

## Where we are

Snake, Dino Runner and Space Invaders run **in the browser**. The server cannot see the game, so it only:

1. issues a run (`startArcade`, which cancels any previous active run of that game),
2. measures how long the run lasted (server clock),
3. rejects a score above `floor(seconds × maxPointsPerSecond) + 1` (a rejected score now cancels the run for good),
4. caps XP per run (`maxXP`: 100 / 100 / 150) and, across all free games, at 500 XP per day (the user's own day since the per-user days change).

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

Effort: a few days, low risk. Option D shipped first; B was then built in part, see [Option B: what shipped](#option-b-what-shipped) and [KNOWN_ISSUES #39](../KNOWN_ISSUES.md).

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

## Implementation (option D)

Built for all three games at once, since the simulators share their structure. Where this note left a choice open, this is what was chosen (the simplest robust option).

**Protocol**

- `startArcade` draws a seed (unsigned 32-bit, CSPRNG) and stores it in `game_sessions.game_data` (`{type, seed}`; no new column or migration). It returns `{sessionId, seed}`.
- The browser plays the simulator from the seed and records every input as `step, code` in a flat array. At game over it sends `{sessionId, score, ticks, inputs}`.
- `finishArcade` replays the inputs (`verifyRun` in `packages/shared/src/games/arcade.js`) and pays on the **replayed** score. The claimed score is only checked for equality with it (tolerance 0: the simulation is deterministic, so any difference is tampering or a client bug). `game_data` keeps the seed, replayed score and tick count of finished runs.
- Every rejection cancels the run for good (as before) and answers `400 VALIDATION`. A submission without `ticks`/`inputs` (an old client, or a run started before the update) gets "This version of the game is out of date. Please refresh the page and try again."

**Simulators**

- Pure code in `packages/shared/src/games/{snake,dino,invaders,rng}.js`: fixed time step (Snake 100 ms, Dino and Invaders 1000/60 ms), a mulberry32 PRNG seeded per run, no wall-clock reads. `step(state, inputs)` advances one step.
- The web app cannot import the CommonJS package, so `apps/web/src/lib/arcade/` holds a TypeScript mirror. `packages/shared/test/fixtures/arcade-timelines.json` stores recorded timelines (played by the bots in `test/helpers`) with their scores; the node tests replay them through the JS simulators and `arcade.parity.test.ts` through the TS ones, so a rule changed on one side only fails a test. Regenerate the fixtures only for a deliberate rule change (`node packages/shared/test/helpers/generateArcadeFixtures.js`).
- Rule changes made to make the games deterministic: Invaders' fire cooldown counts steps (15) instead of wall time; each bullet destroys at most one alien (the old loop could remove several and skip bullets while splicing); the seed offsets the Invaders formation and picks its first direction (otherwise one recorded run would replay against any new run); Snake food and Dino obstacles come from the seeded generator. Inputs the simulation ignores (a reversal, a jump in the air) may still be recorded.

**Checks in `verifyRun`** (limits live in `TELEMETRY_LIMITS` and `TIME_TOLERANCE` in `arcade.js`, not in `ARCADE_CONFIG`, which is sent to browsers)

| Check | Snake | Dino | Invaders |
|---|---|---|---|
| Max steps per run (about 10 minutes) | 6,000 | 36,000 | 36,000 |
| Max inputs per rolling second of simulated time | 15 | 8 | 20 |
| Max inputs per run | 3,000 | 3,000 | 6,000 |

- The timeline must be well formed: ascending steps, each below `ticks`, known input codes.
- The run must end by game over on exactly step `ticks` (a truncated or extended claim fails).
- Wall time: the simulated duration (`ticks` times the step length) may not exceed the server-measured time by more than 5 % plus 2 s (nothing plays faster than real time), and the measured time may not exceed it by more than 10 minutes (a hidden tab pauses the loop, so some idle time is legitimate; this only stops stockpiled, long-delayed submissions).
- The old plausibility bound (`seconds x maxPointsPerSecond + 1`) and the XP caps (per run and 500 a day) still apply, on the replayed score.
- The arcade routes accept bodies up to 128 KB (other routes 16 KB); a maximal legitimate timeline is far smaller.

**What is still trusted**

- A bot that *plays* the game (reads the simulator state and sends legitimate inputs in real time at human input rates) earns what a human of that skill would; the per-run caps and the 500 XP a day bound it. Only edited, fabricated, replayed (wrong seed), accelerated or impossible runs are stopped.
- A script that runs the simulator itself still needs the real time the run would take: it cannot finish faster than playing.
- Option B was not part of this change; it followed, see below.

## Option B: what shipped

Built after replay verification, as far as it could be done without real play data. The rule was to never make an honest player pay for a guess: a bound that is too tight cancels their run.

| Idea from option B | Result |
|---|---|
| Drop arcade XP from the weekly leaderboard | **Done.** `WEEKLY_BOARD_XP_SOURCES` (constants.js) is `WEEKLY_XP_SOURCES` without `game_reward`, and only the public weekly board uses it. Your own weekly review, the Stats page and the Monday digest still count free-game XP. A scripted solver can still earn the daily cap, but it can no longer outrank people who did the work. |
| A minimum per-run duration | **Done, as "pays nothing", not "rejected".** A valid run with less than `TELEMETRY_LIMITS[game].minPayingRunMs` (5 seconds of simulated play) is accepted and priced at 0 (`tooShort` in the result; the page says so). It stops farming the "+1 point" the plausibility bound allows on a run of a few steps, and an honest quick game over cancels nothing. Every recorded bot fixture that scores is longer than 5 s. |
| Calibrate `maxPointsPerSecond` from real play | **Tooling only.** `npm run arcade-report [-- --days 90]` (`scripts/arcade-report.js`, `arcade.summarizeRuns`) prints, per game, the points per second at the median, p95, p99 and maximum, the current bound, the headroom (bound / p99) and how many runs scored at least 90% of what the bound allows. The numbers stay at 2 / 2 / 3 until the report shows a large headroom: lowering a bound on a guess would reject honest players. |
| A per-account cooldown between runs of the same game | **Not built, on purpose.** The shared 3 second cooldown between free games and the 500 XP daily cap already bound a spammer; a per-game cooldown would only turn an honest quick retry into an error toast and an unrecorded run. |

Option C (signed checkpoints) stays unbuilt for the reason given above: it adds protocol complexity without closing the real gap (a script can still produce a plausible curve).
