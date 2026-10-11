# Discord commands

Register commands with `npm run deploy:commands`. Add `-- --guild=<id>` for instant registration in one server, or `-- --guild <id> --clear-global` to also remove global commands.

All commands work in servers and DMs. Responses that show XP, achievements, games or profiles are **ephemeral** (only you see them).

| Command | Options | Visibility | Description |
|---|---|---|---|
| `/list` | `name` (autocomplete, optional) | Public overview / view | Your lists. With `name`, opens that list directly. |
| `/game` | — | Ephemeral | Game centre (Blackjack, Rock Paper Scissors, Hangman). Resumes an unfinished hand. |
| `/daily` | — | Ephemeral | Claim the daily reward (24h cooldown, streaks). A streak freeze is used automatically if a missed day would break the streak. |
| `/freeze` | — | Ephemeral | 🧊 Buy a streak freeze (150 XP, max 3 held) |
| `/quests` | — | Ephemeral | 📜 Daily and weekly quests with progress bars and Claim buttons |
| `/profile` | `user` (optional) | Ephemeral | Level, balance and lifetime XP, focus rate, streak, skills, games, badges. Viewing someone who never used TaskQuest shows "No profile yet". |
| `/achievements` | — | Ephemeral | Paginated achievement list |
| `/class` | — | Ephemeral | Class browser: buy, equip, view and unlock skills |
| `/leaderboard` | `by` (lifetime XP / earned this week / daily streak / current balance) | Public | Top 10. Defaults to lifetime XP, so spending XP doesn't lower your rank. |
| `/toggle` | — | Ephemeral | Turn the XP system on or off |
| `/automation` | — | Ephemeral | Turn deadline reminder DMs on or off |
| `/timezone` | `zone` (autocomplete, IANA name), `hour` (0–23, default 9) | Ephemeral | 🕒 When "today" starts for you and when in the day reminders and the weekly digest arrive. With no options it shows the current settings. |
| `/weekly` | — | Ephemeral | 📅 Turn the Monday weekly summary DM on or off |
| `/quick` | `text` (required, ≤ 300), `list` (autocomplete, required) | Ephemeral | ⚡ Add a task from one line: dates (`today`, `tomorrow`, `fri`, `in 3 days`, `2030-05-04`, `jan 5`), `!high`/`!med`/`!low`, `#tags` (max 5) and repeats (`daily`, `every week`, `monthly`) are read from the text and the rest is the name. |
| `/help` | — | Public | Command overview |
| `/app` | — | Ephemeral | Link to the web app (`WEB_APP_URL`). It says "not configured" when unset. |
| `/ping` | — | Ephemeral | Bot and API latency |
| `/summary` | `mode` (briefing / recap / one quest), `quest` (autocomplete), `range` (today / week) | Ephemeral | ✨ AI summary of your quests. Needs AI enabled. |
| `/prioritize` | `limit` (1–10, default 5) | Ephemeral | 🎯 AI ranking of what to do next, with reasons |
| `/ask` | `question` (required, ≤ 2000 characters) | Ephemeral | 💬 Ask the AI assistant about your quests or how TaskQuest works. It can also create or complete quests after you approve. |
| `/forget` | none | Ephemeral | 🧹 Make the AI forget your conversation with it in this channel |
| `/ai-format` | `format` (plain messages / embeds) | Ephemeral | 🎨 How the AI replies when you mention it |

## `/list` flow

```
Overview ──select list──▶ View (read-only) ──Edit──▶ Edit (all changes)
   │                         │ sort A→Z / Z→A / incomplete first
   │ sort: name/date/priority│ search · refresh
   │ filter: all/current/expired/completed/category
   └ ➕ Create (modal: name, description, deadline) → pick category & priority
```

**Edit mode actions:**

| Button | Action |
|---|---|
| Add | Modal: task name (≤200), description (≤1000) |
| Edit | Pick a task, then a modal to rename it |
| Description | Pick a task, then a modal to edit its description |
| Done | Pick a task to toggle completion. XP is granted only the first time a task is completed. |
| Reorder | Pick two tasks to swap their positions |
| Delete task | Pick a task |
| List info | Category and priority menus, plus a modal for name, description and deadline (`YYYY-MM-DD`, must be a real date) |
| Delete list | Confirmation, then deletes the list and all its tasks |

**Rules:**

- List names are unique per user (1–100 characters).
- Every button and menu acts only on lists owned by **the person clicking**. Because `/list` overviews are public, anyone but the person who ran `/list` who clicks its buttons or menus gets an ephemeral "This isn't your list view" and the shared message is left untouched.
- Select menus hold at most 25 options. With more lists or tasks, the first and last option become **◀ Previous** / **▶ More** entries and the placeholder shows the range (for example `(1-24 of 60)`); on the overview, paging resets any sort or filter. Search results (which are not paged) show `(showing 25 of N)`; narrow the search to reach the rest.

## `/game`

| Game | How to play | Reward |
|---|---|---|
| 🃏 Blackjack | Choose a bet (quick buttons, Custom, or MAX), then Hit / Stand / Double Down | Win 1:1, blackjack 3:2, push returns the bet. No class or skill bonuses. |
| ✊ Rock Paper Scissors | Pick rock, paper or scissors | +10 base XP per win. Losing costs nothing. |
| 📝 Hangman | Pick letters from two menus (A–M, N–Z). Quit at any time. | max(10, 10 × lives left) base XP |

- Bets range from 10 to min(25% of balance, 1000).
- RPS and Hangman have a 3-second cooldown and share a 500 XP per day cap with the web arcade games.
- Unfinished Blackjack hands expire after 30 minutes: untouched hands are refunded, hands you already acted on are settled with you standing.
- Game state lives in the database, so restarts don't lose games, and a hand started in Discord can be finished on the web.

## `/class`

The class browser shows each class's description, cost and skill tree:

- **◀ / ▶** browse classes.
- **Buy** spends XP and equips the class.
- **Equip** switches to a class you own (this resets class counters).
- **Skills** opens the tree: select a skill, then **Unlock** or **Upgrade**.

You can learn skills from the Default tree and from trees of classes you own. Every level costs the skill's listed price. Rules are in [GAMEPLAY.md](GAMEPLAY.md).

## AI commands

`/summary`, `/prioritize` and `/ask` appear in every deployment but only work when the AI service is running and `AI_ENABLED=true` is set for the bot (see [DEPLOYMENT.md](DEPLOYMENT.md#ai-service-appsai-optional)). Otherwise they answer "AI is off". Users who turned AI off in the web app's Settings get "AI is off for you", and nothing is sent to the AI service.

- **`/summary`**: `mode` defaults to *Today's briefing*, or to *One quest* when you pick a `quest`. *Recap* summarises what you finished today or this week.
- **`/prioritize`**: when the model is unavailable or your daily AI quota is used, the ranking falls back to deadlines and priority, and the reply says so.
- **`/ask`**: each use starts a new conversation (continue it on the web Chat page). When the assistant wants to change something, the reply shows the change with **Approve** and **Cancel**. Nothing changes until you approve, and XP and achievements are awarded exactly as if you had done it yourself.
- All three share the per-user daily AI quota (`AI_DAILY_REQUEST_LIMIT`) with the web app. Replies are marked as AI-generated.

### Talking to the bot (@mention, reply or DM)

With AI enabled, the bot also chats like a person. **@mention it**, **reply to one of its messages**, or **DM it**. Its voice is calm, witty and kind. It teases back, gets snappy if you are rude, never uses emojis, and writes its own actions in *italics*.

- It remembers the conversation **per user, per channel**, and `/forget` wipes its memory of you in that channel. Nobody else's messages share your memory.
- **In a server channel the reply is public, so it never touches your quests there.** The bot is given no quest tools and no quest search in a guild: ask about your quests and it says lookups work in a **DM with the bot** or through `/ask` (private reply). General questions and TaskQuest how-tos work everywhere.
- In a DM it can look up your quests, but it **cannot change** anything from a mention. Ask it to complete or add something and it points you to `/ask`, which asks you to approve.
- Attach an image and it looks at it. Attach a `.txt` file and it reads the file as your message.
- Long answers are split into several messages or sent as `response.txt`. `/ai-format` switches to embeds.
- It ignores other bots, answers each user at most once every 3 seconds, and its replies never ping anyone.
- It uses the same daily AI quota and the same opt-out as the other AI features.
- A reply with the ping turned off only reaches the bot if the host enabled the Message Content intent (`AI_CHAT_MESSAGE_CONTENT=true`, see [DEPLOYMENT.md](DEPLOYMENT.md#ai-service-appsai-optional)).

## Background behaviour

- **Deadline DMs:** checked hourly. You get one DM per list on its deadline day, at your reminder hour in your time zone (`/timezone`; UTC and 09:00 until you set them), if `/automation` is on. If tasks are still open the day after the deadline you get one overdue notice. Every reminder has **Snooze 1 day** and **Stop reminders** buttons. If the bot was offline that day, the reminder is sent late (up to 3 days), and temporary Discord errors are retried on the next run.
- **Old-list clean-up:** daily. It deletes lists whose tasks have all been completed for 5+ days, if auto-delete is on (web Settings). Unfinished lists are never deleted, even when overdue.
- **Abandoned games:** expired every 5 minutes, with Blackjack bets refunded.
- **Weekly digest:** checked hourly; users who opted in with `/weekly` get one DM on Monday at their reminder hour (tasks finished, XP earned, streak, open and overdue lists, plus the AI recap when AI is on and they have not opted out).

## Interaction IDs (for developers)

| Prefix | Handler |
|---|---|
| `quest_claim_<KEY>` | `commands/quests.js` buttons |
| `remind_snooze_<listId>`, `remind_off` | `utils/reminders.js` buttons (on the reminder DM) |
| `sort_`, `filter_`, `search_`, `refresh_`, `view_`, `edit_`, `item_`, `list_`, `rename_`, `yes_`, `no_`, `metadone_`, `create`, `back` | `commands/list.js` buttons |
| `sel_list`, `sel_edit_`, `sel_del_`, `sel_done_`, `sel_desc_`, `sel_swap1_`, `sel_swap2_`, `cat_`, `pri_`, `filter_category` | `commands/list.js` menus |
| `m_newlist`, `m_editlist_`, `m_additem_`, `m_edititem_`, `m_desc_`, `m_search` | `commands/list.js` modals |
| `bj_`, `rps_`, `hm_`, `game_`, `game_select`, `hm_letter_select_a/n`, `bj_bet_modal` | `commands/game.js` |
| `class_*`, `cbuy_`, `ceq_`, `skill_unlock_`, `skill_back`, `class_select`, `skill_select`, `ach_*` | `commands/gamification.js` |
| `ai_ok:<thread id>`, `ai_no:<thread id>` | `commands/ai.js` (approve / cancel a paused `/ask` action) |
