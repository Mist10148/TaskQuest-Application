# Known issues and roadmap

This page lists defects found while documenting the 3.8.3 codebase. Nothing here has been fixed yet. Each item gives the location, the effect, and a suggested fix. Items are ordered by impact within each severity.

Severity:

- **High:** a feature fails, a security boundary is missing, or player progress or data is wrong.
- **Medium:** a feature works but misleads, or a rule is inconsistent.
- **Low:** cosmetic, documentation, or maintenance.

## High

### 1. Achievement checks are called incorrectly and read wrong fields

- **Where:** `utils/gameLogic.js:296` defines `async checkAchievements(db, userId)`. Callers in `commands/list.js:475,541,586` and `commands/gamification.js:195,759` call it synchronously as `checkAchievements(user, keys)` and iterate the result.
- **Effect:** The function returns a Promise, so the callers' loops do not see any unlocks. Achievements may never be recorded from these paths. The function also reads `user.lists_created`, `user.items_created`, `user.items_completed` and `user.daily_streak`. The user record has `total_lists_created`, `total_items_added`, `total_items_completed` and `streak_count`, so those achievements cannot unlock.
- **Fix:** Pick one signature. Either load the user inside the function, or pass the full user record and map the correct field names. Await the call wherever it is used. Test each achievement.

### 2. Skill rendering calls a function that does not exist

- **Where:** `utils/ui.js:605`, `:639` and `:939` call `skill.effect(level)`. The `SKILL_TREES` entries in `utils/gameLogic.js` define no `effect` property.
- **Effect:** Rendering a skill tree or skill information may throw. If it does not, the effect text is missing. Either way, players cannot read what a skill does.
- **Fix:** Add an `effect(level)` function or a description string to each skill, and use it in `ui.js`.

### 3. Most purchasable skills do nothing

- **Where:** `getSkillBonuses` in `utils/gameLogic.js` implements 9 of the 27 skills. Two more set flags that nothing reads (`streakProtect`, `luckBonus`). The other 16 have no effect code.
- **Effect:** Players spend XP on skills that do not change anything.
- **Fix:** Implement the effects, or stop selling the skills until they are implemented. Keep one list of effects. See [GAMEPLAY.md](GAMEPLAY.md#4-skills).

### 4. Blackjack fails on a fresh install

- **Where:** `utils/games/sessionManager.js` queries `blackjack_hands` and `game_sessions.started_at`. The auto-creation code in `database/db.js` creates neither.
- **Effect:** Starting or resuming Blackjack fails until someone applies `database/schema.sql` by hand.
- **Fix:** Add `blackjack_hands` and the `started_at` column to auto-creation, using `CREATE TABLE IF NOT EXISTS` and the same names as `schema.sql`.

### 5. Item operations do not check list ownership

- **Where:** In `commands/list.js`, list-level buttons check that `list.discord_id` matches the clicker. These handlers do not: `item_*`, `sel_edit_`, `sel_del_`, `sel_done_`, `sel_desc_`, `sel_swap*`, `m_additem_`, `m_edititem_`, `m_desc_`, `m_editlist_`, `rename_` and `search_`.
- **Effect:** A user who has a list or item ID can change another user's data through these paths. The IDs appear in channel messages, so they are not secret.
- **Fix:** Load the item's list and compare its `discord_id` with the clicker before every mutation.

### 6. Bot token was committed to a local commit

- **Where:** A local commit briefly contained `.env`. GitHub's secret scanning blocked the push, so the token did not reach the remote.
- **Effect:** The token is still in local git objects and the reflog. Treat it as exposed.
- **Fix:** Reset the Discord bot token in the Developer Portal and update `.env`. If you want the objects removed locally, expire the reflog and run `git gc --prune=now`.

## Medium

### 7. Level is not updated when XP is spent

- **Where:** Class purchases and skill unlocks in `commands/gamification.js` change `player_xp` but not `player_level`.
- **Effect:** The stored level can disagree with the level derived from XP. Level-based achievements may use the wrong value.
- **Fix:** Derive level from XP wherever it is read, or recalculate and store it on every XP change.

### 8. Daily reward bypasses the transaction path and the gamification setting

- **Where:** `/daily` in `commands/gamification.js` writes XP with `db.updateUser` and no row lock. It applies the streak and skill bonuses even when `gamification_enabled` is off. It does not use `processXPTransaction`.
- **Effect:** Concurrent actions can overwrite each other's XP. Users with gamification turned off still receive daily XP.
- **Fix:** Route the daily award through `processXPTransaction`. Gate all bonuses on the setting, or document the intended behaviour.

### 9. XP can be farmed by toggling items

- **Where:** `toggleItemComplete` in `database/db.js` increments `total_items_completed` each time an item becomes complete and never decrements it. `commands/list.js` awards 8 XP on each completion.
- **Effect:** Completing and un-completing the same item earns XP every time. Completion achievements count the inflated total.
- **Fix:** Award XP once per item, for example by recording a completion row. Decrement the counter when an item is un-completed, or add a cooldown.

### 10. Gambler documentation does not match the code

- **Where:** The README and the in-game description describe Gambler as a random 0.5x to 2x multiplier. The code (`calculateClassXP` in `utils/gameLogic.js`) adds a random bonus up to base + 100, and 20% of the time reduces the reward by up to the base amount.
- **Effect:** Players cannot predict their rewards, and the description is wrong.
- **Fix:** Decide the intended design, then change either the code or the text.

### 11. Other class descriptions do not match the code

- **Where:** HERO's in-game description says "+20% XP on all tasks". The code adds 25 flat. The README's Tank and Archer descriptions leave out their caps and rules.
- **Fix:** Generate the descriptions from the same constants the code uses.

### 12. Rock-Paper-Scissors reward text is wrong

- **Where:** The RPS embed in `commands/game.js` promises "+15 XP". The code pays 10 base XP.
- **Fix:** Use one constant for both.

### 13. Hangman cannot offer Z until another letter is guessed

- **Where:** `commands/game.js` builds the letter select with `slice(0, 25)`. Discord caps select menus at 25 options, so 26 letters do not fit.
- **Effect:** Z is missing from the menu at the start of a game.
- **Fix:** Split the letters across two select menus, or use buttons.

### 14. Hangman and UI state is lost on restart

- **Where:** `hangmanGames`, `pageState`, `classViewState` and `swapState` are in-memory maps.
- **Effect:** A restart ends a Hangman game and resets pagination and browser state. Old messages then show "Button expired or unknown".
- **Fix:** Persist Hangman sessions the way Blackjack sessions are stored. Keep the others in memory, but make the messages recover cleanly.

### 15. Game sessions can be duplicated

- **Where:** `sessionManager.createSession` checks for an active session with a SELECT, then inserts. There is no unique constraint.
- **Effect:** Two concurrent `/game` calls can create two active sessions for the same user and game.
- **Fix:** Add a unique constraint on active sessions, or use a transaction with a lock.

### 16. Expired Blackjack sessions do not refund the bet

- **Where:** `sessionManager.expireOldSessions` sets `state = 'expired'`. The bet taken at the start is not returned.
- **Effect:** A player who leaves a hand for 30 minutes loses the bet.
- **Fix:** Refund the bet, or settle the hand deliberately and say so in the text. Document the rule either way.

### 17. Blackjack bet maximum is defined but not enforced server-side

- **Where:** `xpService.getMaxBet` in `utils/games/xpTransaction.js` defines the maximum. I did not find a server-side check of it in the reviewed code. The bet buttons are filtered to the maximum in the UI.
- **Effect:** A typed bet through `bj_bet_modal` may exceed the maximum.
- **Fix:** Check the limit in the bet handler, not only in the buttons.

### 18. Search queries a column that does not exist

- **Where:** `database/db.js:349` `searchLists` queries `notes`. Neither schema defines that column.
- **Effect:** Searching lists fails.
- **Fix:** Remove the `notes` term, or add the column to both schemas if it is wanted.

### 19. Old-list cleanup is expensive and cannot be turned off

- **Where:** `index.js` `cleanupOldLists` and `db.cleanupOldLists`. Several queries run per list, and no command changes `auto_delete_old_lists`.
- **Effect:** The job slows down with more data, and users cannot opt out.
- **Fix:** Rewrite the cleanup as set-based SQL, and add an option to control it.

### 20. Shutdown is not graceful on the target platform

- **Where:** `index.js` handles `SIGINT` only.
- **Effect:** Render sends `SIGTERM` on redeploy. The database pool and Discord client are not closed cleanly.
- **Fix:** Handle `SIGTERM` with the same steps as `SIGINT`.

### 21. Migrations fail silently on MySQL 8

- **Where:** `database/db.js` uses `ADD COLUMN IF NOT EXISTS` for `users.auto_delete_old_lists` and `items.updated_at`.
- **Effect:** On MySQL 8 those columns are not added, and the error is swallowed.
- **Fix:** Check `information_schema` before adding each column, and log failures.

## Low

### 22. Duplicate gamification module

- **Where:** `utils/gamification.js` is nearly identical to `commands/gamification.js`. `index.js` imports only the command file.
- **Fix:** Delete `utils/gamification.js`, or move the shared logic into one module that both use.

### 23. Version strings disagree

- **Where:** `package.json` says 3.8.3. The HTTP status payload and the `index.js` banner say 3.8.0. The help footer says v3.8. The `gameLogic.js` header says v3.9. `schema.sql` says v3.5. `deploy-commands.js` says v3.2.
- **Fix:** Read the version from `package.json` in one place.

### 24. Deploy script argument form

- **Where:** `deploy-commands.js` parses `--guild=<id>`. Its header comment shows `--guild YOUR_GUILD_ID` with a space, which the script does not handle.
- **Fix:** Accept both forms, or correct the comment.

### 25. Unused configuration

- **Where:** `DB_POOL_SIZE`, `DB_TIMEZONE` and `LOG_LEVEL` are in `.env.example`. The pool size is fixed in `db.js`, and nothing reads the other two.
- **Fix:** Read them, or remove them from `.env.example` and the docs.

### 26. `.env.example` has a leading space

- **Where:** `.env.example` line 62. `WEB_APP_URL=` is preceded by a space.
- **Fix:** Remove the space.

### 27. Comments that describe behaviour the code does not have

- **Where:** The `/daily` header says the cooldown resets at 4AM. The code uses 24 hours. The `deck.js` comment says the shuffle is "cryptographically fair". It uses `Math.random()`.
- **Fix:** Correct the comments. Use a cryptographic random source if fairness matters.

### 28. Unused fields and functions

- **Where:** `skill_points` and `addSkillPoints` are not used by the purchase flow. `gameLogic.updateStreak` has no caller in the reviewed code. `/daily` does not write `last_active_day`.
- **Fix:** Remove the unused code, or connect it to the feature it was meant for.

### 29. N+1 query patterns

- **Where:** `getLeaderboard` calls `getUserStats` for each row, and each row also triggers a name lookup. The profile and list views make several separate queries that could be combined.
- **Effect:** The leaderboard is slow and unknown users show as "Unknown User" when the lookup fails.
- **Fix:** Use joins or batch queries, and cache names.

## Roadmap

Ordered by how much each item unblocks. Security fixes come first.

1. **Close the ownership gaps (issue 5).**
2. **Fix the achievement check (issue 1).** This restores progression feedback for players.
3. **Make skill text and effects match (issues 2 and 3).** Either implement the skills or stop selling them.
4. **Make Blackjack work on a fresh install (issue 4).**
5. **Make XP changes transactional (issues 7 and 8).** Route all XP through `processXPTransaction`.
6. **Stop XP farming (issue 9).**
7. **Handle `SIGTERM` (issue 20).**
8. **Item-level due dates and priorities**, from the PRD backlog (L-12).
9. **Per-server leaderboard and a reminder time setting** (R-3).
10. **Remove duplicate code and version strings (issues 22 and 23).**
