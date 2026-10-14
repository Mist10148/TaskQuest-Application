# Player FAQ

Short answers for people using TaskQuest. The exact rules are in [GAMEPLAY.md](GAMEPLAY.md), every XP source is in [XP_GUIDE.md](XP_GUIDE.md), commands are in [COMMANDS.md](COMMANDS.md).

## Contents

- [Streaks and freezes](#streaks-and-freezes)
- [Turning XP off](#turning-xp-off)
- [Reminders](#reminders)
- [Time zones and "your day"](#time-zones-and-your-day)
- [Prestige](#prestige)
- [Sharing lists and parties](#sharing-lists-and-parties)
- [Import and export](#import-and-export)
- [Push notifications](#push-notifications)
- [Blackjack and the other games](#blackjack-and-the-other-games)

## Streaks and freezes

**How does the daily streak work?** Claim your daily reward (`/daily` or the dashboard) at least once every 24 hours and at most 48 hours after the last claim to keep the streak going. Claim sooner than 24 hours and you are told how long to wait. Each streak day adds 5 XP to the reward (up to +50), and the claims that reach 7, 14 and 30 days also pay a chest of +100, +250 and +600 XP, once per streak run.

**I missed a day. Is my streak gone?** Probably, unless something protects it. In order: the Tank's *Unstoppable* skill (free, always), a longer window (the *Streak Shield* skill or the Paladin class: 72 hours; Paladin with Sanctuary: 96), then a **streak freeze**. A freeze costs 150 XP (120 with *Freeze Cache*, which also lets you hold 5 instead of 3) and is used automatically at your next claim, only when a streak of 2 or more days would otherwise break. One freeze covers one missed day, so a longer gap needs one freeze per day. Buy one with `/freeze` or on your profile before you need it.

**Is the streak tied to midnight?** No. The 24-hour cooldown and the 48-hour window are rolling clocks from your last claim, not calendar days.

**Does the Monk's Rhythm or the Assassin's streak work the same way?** No, they are class counters: Rhythm counts consecutive days of yours on which you finished a rewarded action, and the Assassin's streak resets after 36 hours (48 with Night Owl) without one.

## Turning XP off

`/toggle` or Settings turns XP off. Your tasks, lists and reminders keep working, but nothing pays XP, and games, purchases, the daily reward, quests and the shop are unavailable (achievements still unlock but pay nothing). Turning it back on resumes where you left off; actions done while it was off earn nothing retroactively, and a task completed then cannot pay its first-completion XP later.

## Reminders

**What gets a DM?** A list on its deadline day, one more notice the day after if tasks are still open, and every task with its own due date on that day. All arrive at your reminder hour (default 09:00) in your time zone, with **Snooze 1 day** and **Stop reminders** buttons. A task due on the same day as its list's deadline is covered by the list reminder only. If the bot was offline, a reminder is sent late (up to 3 days).

**How do I turn them off?** `/automation` or Settings turns off every reminder DM; "Stop reminders" on a DM does the same. If your DMs from the server are closed, Discord blocks the message and the bot skips it.

**Why one "N more reminders" message?** At most 20 reminder DMs are sent to you per hour; the rest are folded into one message so a huge shared list cannot flood you.

**Do shared lists remind everyone?** Yes: the owner and every member who has reminders on each get one, in their own time zone and hour, and each person's snooze is their own.

## Time zones and "your day"

Set your zone with `/timezone` or in Settings (UTC until you do). Your zone decides when your day starts (daily caps, the first-task-of-the-day bonus, Monk Rhythm, due-today checks, daily quests), when your week starts (Monday 00:00; weekly quests, the weekly review) and your month (the monthly boss), and when reminders arrive. The daily reward ignores calendar days, and the weekly leaderboard and a party's week always run Monday to Monday in UTC for everyone.

**Why can't I change my zone again?** A zone change is allowed once every 24 hours (the first change, and saving the zone you already have, always work). Otherwise hopping between zones would reset your daily caps again and again. Changing zone is not retroactive: XP you already earned keeps its moment, and the change can shift when today's caps reset.

## Prestige

At **level 30** you can prestige (profile, or `/prestige`), up to 10 times. You are asked to confirm because it **resets** your balance, level, classes, skills and streak freezes, and it **keeps** your achievements, quest claims, tasks, daily streak and everything you own in the shop. Each prestige gives a permanent +2% XP (up to +20%) and a title (Veteran, Seasoned, Champion, and on to Eternal). Your lifetime XP leaderboard score and XP achievements are unaffected, because they use a total that is never reset. Small rewards may not show the extra 2% at once: it adds to your other percentage bonuses and the result rounds down.

## Sharing lists and parties

**How do I share a list?** On the web, open the list's members dialog and type the person's exact Discord username (not their display name); you confirm the name you found before anything is sent. On Discord, use `/share` with their mention. They get an invitation (7 days) to accept or decline in `/invites` or the web banner. They must have signed in on the web or used a command since the sharing update (that is when their username is stored), and bots and yourself cannot be invited.

**What can each role do?** Viewers read. Editors add, edit, reorder and complete tasks and delete tasks they added themselves. Managers also edit the list's details and invite and remove people (only the owner makes or removes managers). Only the owner deletes the list. You can leave any list you do not own with `/leave` or on the web.

**Whose XP is it?** Yours, always: the person who finishes a task gets its XP, quest progress and statistics, whoever owns the list. The owner gets nothing for a member's work, and nobody sees another person's XP or Discord ID, only display names.

**Why didn't my invitation say who was found or not found?** On purpose. The answer is the same whether the person exists, turned invitations off, declined you recently (you cannot invite them again for 7 days) or you invited them already, so nobody can use it to look up who uses TaskQuest. People can switch invitations off in Settings.

**What is a party?** Up to six people with one shared weekly quest (Monday to Monday in UTC): 12 tasks for each member who finished at least one task themselves. Each member who finished 6 tasks themselves since joining gets +60 XP when it is reached, once per week. See [GAMEPLAY §5h](GAMEPLAY.md#5h-parties). You can be in one party at a time; the owner invites, removes members and disbands.

## Import and export

**Export:** Settings downloads everything you own as JSON, or your tasks as a CSV spreadsheet, or gives you a private calendar address (`.ics`) to subscribe to; rotate or turn off that address in Settings if it leaks.

**Import:** a TaskQuest JSON export, or a CSV file whose first row names its columns (`list`, `task`, `due`, `priority`, `tags`, `repeat`, `done`, and more). The web app previews the file and names the first rows that have problems; nothing is imported unless the whole file is valid. Imports **never give XP**, counters or achievements, completed tasks arrive already paid so they cannot be re-earned, and imported tasks do not count for quests. There is a limit of 200 lists and 5,000 tasks per account. Shared lists are not part of an export.

## Push notifications

Push sends your reminders to your browser as well as to Discord, and only exists if the server's operator enabled it ([DEPLOYMENT.md](DEPLOYMENT.md#web-push-optional)). If **Settings → Push notifications** is shown: turn it on in each browser you want to use and allow notifications when your browser asks. The site must use HTTPS. You can switch it off in Settings at any time (your browsers stay registered but stop receiving). A push never replaces the Discord DM, and a browser that unsubscribes at the browser level is removed automatically.

## Blackjack and the other games

**Why does Blackjack ignore my class and skills?** Because a bonus on winnings would make it a free XP machine: a Hero betting 10 earned +35 per win with no limit, so Blackjack now pays a flat 1:1 (3:2 for a natural) and nothing else. Your class and skills still apply to Rock Paper Scissors, Hangman and the arcade.

**I closed the game in the middle of a hand.** An unfinished hand is settled after 30 minutes as if you had stood, and pays or loses normally; there are no refunds, because otherwise you could look at the deal and walk away from a bad hand. Come back to `/game` or the Games page to finish it sooner.

**Why did a game pay nothing?** Free games (RPS, Hangman, arcade) share 500 XP a day and have a 3-second cooldown between rounds; the Games page shows how much allowance is left. A zero-score arcade run is a loss, and a run the server cannot reproduce from its recorded inputs is rejected (refresh the page after an update).
