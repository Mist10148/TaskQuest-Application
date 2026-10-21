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

## Working together on a quest (October 2026)

- **Assign tasks.** On a shared quest, give a task to its owner or a member from the task's details; your row shows who has it, and tasks assigned to you show on your Today page.
- **Comments and history.** Each task's details have a Comments tab for notes to each other and an Activity tab listing every change (who finished it, who moved the due date, and so on).
- **Move tasks between quests.** From a task's details, or select several and pick **Move to…**. Subtasks go along.
- **Filter and group.** Show only open, overdue, high-priority, tagged or "assigned to me" tasks, and group the list by priority, due date or tag.
- **Drag on the board** to change a task's priority, and **bulk edit tags** on many tasks at once.
- **Your streak on the dashboard,** the same seven-day strip as on the Today page.

## Smaller things (October 2026 review)

- **Install it.** Add TaskQuest to your phone's home screen from the browser menu; it opens like an app.
- **Keyboard:** inside a quest, `j` and `k` move through the tasks, `x` completes, `i` opens the details, `e` edits, `d` deletes (press `?` for the list).
- **Task details.** The info button on a task opens a drawer with everything about it, including subtasks.
- **Bulk edit.** Select several tasks, then change their priority or due date in one go.
- **Search from anywhere.** Ctrl+K now also finds your tasks.
- **Streak strip.** The Today page shows your last seven days of streak as flames.
- **Easier to read.** Settings has a high-contrast switch and a text size (normal, large, larger).
- **Fewer surprises.** Finishing several tasks at once gives one message, the quest you have open stays open after a refresh (and Back returns to your quests), and the welcome tour picks up where you left it.
- **Safer on a phone:** dialogs scroll, the bulk bar no longer hides behind the bottom bar, and buttons are easier to hit.
- **Clearer problems:** an "offline" banner, a Reload card instead of a blank page after an update, and a time zone you now confirm with Save (it locks for 24 hours).

## Easier days (late October 2026)

- **Due dates read like you say them:** "Today", "Tomorrow", "in 3 days", "2 days ago"; hover for the date. They follow your time zone, and the web saves your browser's zone the first time if you never set one, so the app and the server agree on what "today" is.
- **Coming up this week** on the Today page lists what is due in the next seven days.
- **Snooze to tomorrow** on any open task. On a phone the task actions sit in one **More actions** menu, so long names stay readable.
- **The command palette** (Ctrl+K, ⌘K on a Mac) can claim your daily reward, start a 25-minute focus session and jump to what is overdue.
- **The quest log remembers** its tab, filters and sort, and a game has its own link (`/games?play=snake`), so Back returns to the games menu.
- **A late-evening daily claim keeps your streak.** A claim within 48 hours of the last one continues it (72 with protection, 96 with Sanctuary), even when it lands just after the following midnight.
- **Perfect day needs a plan:** only tasks whose due date was set at least a day ahead count towards the three.
- Every page has its own tab title, and screen readers hear calendar days, login errors and quick-add previews.

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

See the [ROADMAP](ROADMAP.md) and the [known issues](KNOWN_ISSUES.md).
