# Glossary

The words TaskQuest uses, in one place. Each entry links to the document that has the full rules.

| Term | Meaning |
|---|---|
| **Quest** | What the web app calls a list of tasks. The bot's `/list`, `/share` and `/quick` still say *list* (its AI commands say quest), and the code, the database and the API call it a *list* (`lists`, `/api/lists`), so the two words mean the same thing. |
| **Task** | One item on a quest (`items`). It can have a due date, a priority, tags, a repeat, an estimate, an assignee and one level of subtasks. |
| **Subtask** | A task under another task (`parent_id`). Only one level deep: a subtask cannot have subtasks of its own. |
| **Repeating task** | A task with a repeat (daily, weekly or monthly). Completing it creates its *next copy*, a new task due on the next date. Undoing the completion removes that copy while nobody has touched it. See [GAMEPLAY](GAMEPLAY.md#1-xp-and-levels). |
| **Habit streak** | How many times in a row a repeating task was finished on time. It pays the `habit_bonus` from a streak of 2. See [GAMEPLAY](GAMEPLAY.md#5c-bonus-xp-sources). |
| **Balance** | The XP you can spend (`users.player_xp`) on classes, skills, streak freezes, cosmetics and bets. |
| **Lifetime XP** | Everything you have ever earned. Spending never lowers it, and refunds and returned bets never add to it. Your **level** is ⌊lifetime XP / 100⌋ + 1 and never goes down. See [GAMEPLAY](GAMEPLAY.md#1-xp-and-levels). |
| **Modified XP** | A base amount that your class, skills and prestige reshape. Only creating quests, adding and completing tasks, the daily reward and the free games pay modified XP. See the [XP guide](XP_GUIDE.md#two-kinds-of-xp). |
| **Flat XP** | XP paid exactly as listed, whatever your class or skills: bonuses, chests, quests, focus, the review and achievement rewards. |
| **Daily cap** | The most a source pays in one day. Days are yours: they start at midnight in your time zone (UTC until you set one). See [GAMEPLAY](GAMEPLAY.md#8-limits-and-anti-farming). |
| **Class** | One of seventeen ways your actions pay (Hero, Wizard, Monk and so on). You buy and equip one at a time. See the [class guide](CLASS_GUIDE.md). |
| **Skill** | A purchase in one of the skill trees that sharpens your rewards. A tree can be reset once a day for a 75% refund. See [GAMEPLAY](GAMEPLAY.md#4-skills). |
| **Streak** | How many days in a row you claimed the daily reward. Chests pay at 7, 14 and 30 days. See [GAMEPLAY](GAMEPLAY.md#5-daily-reward). |
| **Streak freeze** | A bought item that covers one missed day of your daily streak, used automatically. See [GAMEPLAY](GAMEPLAY.md#streak-freeze). |
| **Quest (reward)** | A daily, weekly or monthly goal ("finish 5 tasks today") that pays flat XP once you claim it. The monthly one is the **Monthly Boss**. These are not your task quests: they are counted from them. See [GAMEPLAY](GAMEPLAY.md#5b-quests). |
| **Boss** | Two different things: the *Monthly Boss* quest (50 tasks in a month), and the `boss_defeated` bonus for finishing the last open subtask of a task with at least 4 subtasks. |
| **Weekly modifier (season)** | One flat bonus source that pays double for a UTC week, the same week for everybody, in rotation. The Today page shows it as the week's season. See the [XP guide](XP_GUIDE.md#every-source). |
| **Weekly review** | A once-a-week look back that pays a bonus after at least one finished task. See [GAMEPLAY](GAMEPLAY.md#5e-weekly-review). |
| **Weekly goal** | A number of tasks you set for yourself this week; reaching it pays a flat bonus. See [GAMEPLAY](GAMEPLAY.md#5f-reflection-and-weekly-goal). |
| **Focus session** | A timed work block of 10 to 90 minutes that pays flat XP. See [GAMEPLAY](GAMEPLAY.md#5d-focus-sessions). |
| **Prestige** | Starting over from level 30 for a permanent XP bonus and a title. See [GAMEPLAY](GAMEPLAY.md#5g-prestige). |
| **Cosmetics** | Titles, frames and accent colours bought in the shop. They change how you look, never what you earn. See [GAMEPLAY](GAMEPLAY.md#5h-cosmetics-the-shop). |
| **Party** | A group of up to 6 players with a shared weekly task quest and focus quest, counted over one UTC week. See [GAMEPLAY](GAMEPLAY.md#5i-parties). |
| **Shared quest** | A quest its owner has invited other people to. Each member has a **role**: *viewer* reads, *editor* adds and completes tasks, *manager* also edits the quest. Only the owner deletes it. See [the sharing design](design/shared-lists.md). |
| **Member key** | How the API names a person on a shared quest without exposing their Discord ID: `"owner"` for the owner, otherwise the member's public key. Assignees use it. See [API](API.md). |
| **Template** | A saved copy of a quest's tasks (names, notes, priorities, tags, repeats) to start new quests from. Due dates and the subtask hierarchy are not kept. |
| **XP off** | A per-player switch that keeps every task feature but pays no XP; games, purchases and the daily reward are unavailable while it is off. |
| **Internal API** | The `/internal/*` routes the bot and the AI service call with a shared token, acting on behalf of a Discord user. Not for browsers. See [API](API.md). |
