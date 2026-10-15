# What's new

A player's view of what changed since the separate Discord bot (3.x) and web app (1.x) became one project in 4.0, and of the balance pass that followed. For the exact rules read [GAMEPLAY](GAMEPLAY.md); for every detail and the upgrade steps read the [CHANGELOG](../CHANGELOG.md).

## One game, two places

- **The bot and the web app share everything.** Same XP, same classes, same achievements, same database. A Blackjack hand started in Discord can be finished on the web.
- **Levels are lifetime XP.** Spending XP on classes, skills or cosmetics never lowers your level (100 XP per level).
- **Every skill works.** Eighteen skills used to do nothing; all of them now have an effect, and the Classes and Skills pages show what a purchase would earn you before you pay.

## More ways to play

- **Seventeen classes:** Default, Hero, Gambler, Assassin, Wizard, Archer, Tank, Monk, Artisan, Ranger, Necromancer, Paladin, Bard, Alchemist, Druid, Chronomancer and Warden. [Which one suits you?](CLASS_GUIDE.md)
- **Today page, weekly review, focus sessions, reflection and weekly goal.** A page for what is due now, a once-a-week bonus for reviewing your week, timed focus sessions that pay XP, and small daily and weekly habits.
- **Shared lists and parties.** Invite people to a quest as viewer, editor or manager, and join a party with a shared weekly goal. Parties need 6 tasks of your own to claim the reward.
- **Board and calendar views, templates, estimates, import and export, a calendar feed, web push reminders.**
- **Cosmetics, prestige and the shop.** Titles, frames and accent colours for XP; prestige at level 30 for a permanent bonus.
- **An optional AI assistant** that can summarise, rank and (after you confirm) change your quests.

## The balance pass (October 2026)

The rules were checked with a simulator against every class, and a few numbers were wrong.

| What changed | Why |
|---|---|
| Valor, Fortify, Arcane Study and Multishot only work with their own class | They added the same flat XP to any class, so a plain player with borrowed skills out-earned most full class trees |
| The Wizard's Wisdom stops at 50 (level 25) | It grew without limit: a level-100 Wizard earned about 45 times the base XP |
| Hero's Champion +50% → +35%, Monk's Steady Breath 0.5 → 0.4, Tank's Revenge +10% → +15% per level | The Hero and Monk led the table; the Tank's late skills barely did anything |
| The generic skill percentages share a +75% limit | A guard against stacking every percentage skill on a strong class |
| Blackjack winnings no longer count as lifetime XP | Repeated hands could raise your level without earning any XP |
| Only the first 8 early or overdue completions of a day count for the Necromancer and Ranger | A daily routine of back-dated tasks farmed them |
| A quest or the weekly review pays once per real period, even if you change time zone | A zone change could pay it twice |
| The party target ignores members with fewer than 6 tasks | One stray task from a spare account used to block the whole party |

If you bought one of the four skills above for a class you do not play, it stays owned and you can reset that tree on the Skills page for a 75% refund.

## Still to come

See the roadmap in the [PRD](PRD.md#11-roadmap) and the [known issues](KNOWN_ISSUES.md).
