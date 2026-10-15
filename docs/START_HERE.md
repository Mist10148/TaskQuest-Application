# Start here

Two short paths. Pick yours.

## You play

1. **Claim your daily reward** on the dashboard (or `/daily`) every calendar day. The streak adds XP and pays chests at 7, 14 and 30 days.
2. **Make a quest, add tasks, finish them.** Every action pays XP; finishing pays most. Give tasks due dates and priorities and the bonuses ([XP guide](XP_GUIDE.md)) start to add up.
3. **Open Today.** It lists what is overdue, due today or HIGH priority, warns you when today is the last day to keep your streak, and has a one-line reflection (+10 XP) and a weekly goal.
4. **Spend XP.** [Classes](CLASS_GUIDE.md) change how every action pays (17 to choose from); [skills](GAMEPLAY.md#4-skills) sharpen them. The Classes and Skills pages show what a purchase would earn you before you pay, and a skill tree can be reset for a 75% refund.
5. **Go further:** focus sessions, the weekly review, a party with a shared quest, shared quests, the shop, prestige at level 30.

Questions: the [player FAQ](PLAYER_FAQ.md). Discord commands: [COMMANDS](COMMANDS.md).

## You build

1. Read the [README](../README.md) quick start and [CONTRIBUTING](../CONTRIBUTING.md) (setup, where code belongs, tests).
2. The rules live in one place, `packages/shared/src` (`constants.js`, `xp.js`). The bot, the web server and the web app all use them. [ARCHITECTURE](ARCHITECTURE.md) shows how the pieces fit.
3. Changing a number? Run `npm run balance`, update the docs table it feeds ([balance design](design/balance.md)) and the test bands in `packages/shared/test/balance.test.js`. `npm test` checks the GAMEPLAY tables against the constants.
4. Changing the database? A new migration, never an edit of one that shipped ([DATABASE](DATABASE.md)).
5. Run the database tests against a throwaway database: see "Tests" in CONTRIBUTING.

Running it for others: [DEPLOYMENT](DEPLOYMENT.md), [OPERATIONS](OPERATIONS.md), [SECURITY](../SECURITY.md).
