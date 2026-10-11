# Discord commands

Register commands with `npm run deploy:commands`. Add `-- --guild=<id>` for instant registration in one server, or `-- --guild <id> --clear-global` to also remove global commands.

All commands work in servers and DMs. Responses that show XP, achievements, games or profiles are **ephemeral** (only you see them).

| Command | Options | Visibility | Description |
|---|---|---|---|
| `/list` | `name` (autocomplete, optional) | Public overview / view | Your lists. With `name`, opens that list directly. |
| `/share` | `list` (autocomplete: lists you manage), `user` (required), `role` (viewer / editor / manager, default viewer) | Ephemeral | 👥 Invite someone to a list. They get a DM with **Accept** / **Decline** (if their DMs are closed you are told, and the invitation waits in `/invites`). The person must have used TaskQuest before; bots and yourself are refused. Only a manager invites, and only the owner invites managers. |
| `/invites` | — | Ephemeral | 📨 Invitations to shared lists waiting for you, with Accept / Decline buttons (valid 7 days). |
| `/members` | `list` (autocomplete: shared lists) | Ephemeral | 👥 Who is on a shared list, by display name and role. A manager gets a menu to remove someone (only the owner removes a manager). `/share` and `/party invite` answer "If that person can be invited, they have been sent an invitation." when nothing was sent for a reason the inviter must not learn (unknown person, invitations off, a recent decline, already in a party). Names in invitations and lists are escaped (no links, formatting or pings from someone else's list or display name), and invitation DMs never ping. |
| `/leave` | `list` (autocomplete: lists you do not own) | Ephemeral | 🚪 Leave a list that was shared with you (asks first). The owner cannot leave: delete the list instead. |
| `/party` | subcommands `status`, `create name`, `invite user`, `invites`, `kick user`, `leave`, `disband` | Ephemeral | 🎉 A small group (up to 6) with a shared weekly quest: see [GAMEPLAY](GAMEPLAY.md#5h-parties). `status` shows who contributed this week (names and counts) and a **Claim reward** button; `invite` DMs the invitee Join / Decline buttons (`invites` is the closed-DM fallback). The owner invites, removes members (`kick user`) and disbands (asks first); everyone else can leave. The Claim button appears only once you finished at least 6 tasks yourself. |
| `/game` | — | Ephemeral | Game centre (Blackjack, Rock Paper Scissors, Hangman). Resumes an unfinished hand. |
| `/daily` | — | Ephemeral | Claim the daily reward (24h cooldown, streaks). A streak freeze is used automatically if a missed day would break the streak. The reply also shows the Daily Surprise and any milestone chest. |
| `/freeze` | — | Ephemeral | 🧊 Buy a streak freeze (150 XP, max 3 held; 120 XP and 5 with the Freeze Cache skill) |
| `/quests` | — | Ephemeral | 📜 Daily and weekly quests with progress bars and Claim buttons |
| `/review` | — | Ephemeral | 📝 This week's review: tasks finished, XP earned, streak, and a Claim button for the once-a-week bonus (needs at least one finished task; same rules as the web review page). |
| `/prestige` | — | Ephemeral | ✦ Shows your prestige title, bonus and whether you can start over (level 30+). **Prestige...** opens a warning listing what is lost and kept; only **Yes, reset** on that second screen resets, **Cancel** backs out. |
| `/shop` | `section` (titles, frames or accents; default titles) | Ephemeral | 🛍️ Spend XP on cosmetics. Tabs for Titles, Frames and Accents list every item with its price and owned or locked state. Pick one from the menu to see the price and your balance after, then **Buy**, **Equip** or **Unequip**. A title you equip shows in `/profile`. |
| `/profile` | `user` (optional) | Ephemeral | Level (with your prestige title), balance and lifetime XP (all-time, across prestiges), focus rate, streak, skills, games, badges. Viewing someone who never used TaskQuest shows "No profile yet". |
| `/achievements` | — | Ephemeral | Paginated achievement list |
| `/class` | — | Ephemeral | Class browser: buy, equip, view and unlock skills |
| `/leaderboard` | `by` (lifetime XP / earned this week / daily streak / current balance) | Public | Top 10. Defaults to lifetime XP, so spending XP doesn't lower your rank. |
| `/toggle` | — | Ephemeral | Turn the XP system on or off |
| `/automation` | — | Ephemeral | Turn deadline reminder DMs on or off |
| `/timezone` | `zone` (autocomplete, IANA name), `hour` (0–23, default 9) | Ephemeral | 🕒 Your time zone: when "today" starts for you (daily limits, quests, the weekly review, Stats) and when in the day reminders and the weekly digest arrive. A zone can change once every 24 hours. With no options it shows the current settings. |
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

Lists shared with you appear next to your own with a 👥 marker, your role and the owner's name. A **viewer** opens a read-only view (no Edit button; every edit button and menu answers "view only"), an **editor** edits tasks but sees no List info or Delete list buttons, a **manager** also edits the list's info, and only the **owner** deletes it. XP for a task you complete is yours.

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
| Details | Pick a task, then a modal with its due date (`YYYY-MM-DD`), priority (low / med / high), tags (comma separated, at most 5) and repeat (none / daily / weekly / monthly). An empty field clears it; the same validation as the web app applies. |
| Done | Pick a task to toggle completion. XP is granted only the first time a task is completed. |
| Reorder | Pick two tasks to swap their positions |
| Delete task | Pick a task |
| List info | Category and priority menus, plus a modal for name, description and deadline (`YYYY-MM-DD`, must be a real date) |
| Delete list | Confirmation, then deletes the list and all its tasks |

Both views show each task's priority dot, due date (⚠️ when an open task is overdue), repeat (🔁) and tags, with subtasks indented under their parent (↳). A completed task also lists the bonuses it paid (first task of the day, finished early, and so on). When a list is too long for one embed (4096 characters) the view ends with "… and N more tasks".

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
- Unfinished Blackjack hands expire after 30 minutes and are settled with you standing (no refunds, untouched or not).
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
- **Task DMs:** a task with its own due date gets the same treatment: one DM on its due day (up to 3 days late) at your reminder hour, with **Snooze 1 day** and **Stop reminders**. Completed tasks are skipped, and a task due on the same day as its list's deadline is covered by the list reminder (no double DM). Changing a task's due date re-arms its reminder. `/automation` turns both kinds off.
- **Old-list clean-up:** daily. It deletes lists whose tasks have all been completed for 5+ days, if auto-delete is on (web Settings). Unfinished lists are never deleted, even when overdue, and a list that has members is never deleted automatically.
- **Shared lists:** the deadline and task reminders go to the owner **and** to every member with `/automation` on, once each; each person's Snooze applies to them alone, in their own time zone and at their own reminder hour.
- **Abandoned games:** expired every 5 minutes; an unfinished Blackjack hand is settled as a stand, not refunded.
- **Weekly digest:** checked hourly; users who opted in with `/weekly` get one DM on Monday at their reminder hour (tasks finished, XP earned, streak, open and overdue lists, plus the AI recap when AI is on and they have not opted out).

## Interaction IDs (for developers)

| Prefix | Handler |
|---|---|
| `quest_claim_<KEY>` | `commands/quests.js` buttons |
| `review_claim` | `commands/review.js` button |
| `prestige_ask`, `prestige_confirm`, `prestige_cancel` | `commands/prestige.js` buttons |
| `shop_tab_<kind>`, `shop_buy_<id>`, `shop_equip_<id>`, `shop_unequip_<kind>`, `shop_pick_<kind>` (menu) | `commands/shop.js` buttons and menu |
| `remind_snooze_<listId>`, `task_remind_snooze_<itemId>`, `remind_off` | `utils/reminders.js` buttons (on the reminder DM) |
| `inv_accept_<id>`, `inv_decline_<id>`, `leave_yes_<listId>`, `leave_no`, `mem_rm_<listId>` (menu; the value is the opaque member key) | `commands/sharing.js` |
| `party_claim`, `party_accept_<id>`, `party_decline_<id>`, `party_disband_yes`, `party_disband_no` | `commands/party.js` buttons |
| `sort_`, `filter_`, `search_`, `refresh_`, `view_`, `edit_`, `item_` (incl. `item_details_`), `list_`, `rename_`, `yes_`, `no_`, `metadone_`, `create`, `back` | `commands/list.js` buttons |
| `sel_list`, `sel_edit_`, `sel_del_`, `sel_done_`, `sel_desc_`, `sel_details_`, `sel_swap1_`, `sel_swap2_`, `cat_`, `pri_`, `filter_category` | `commands/list.js` menus |
| `m_newlist`, `m_editlist_`, `m_additem_`, `m_edititem_`, `m_desc_`, `m_details_`, `m_search` | `commands/list.js` modals |
| `bj_`, `rps_`, `hm_`, `game_`, `game_select`, `hm_letter_select_a/n`, `bj_bet_modal` | `commands/game.js` |
| `class_*`, `cbuy_`, `ceq_`, `skill_unlock_`, `skill_back`, `class_select`, `skill_select`, `ach_*` | `commands/gamification.js` |
| `ai_ok:<thread id>`, `ai_no:<thread id>` | `commands/ai.js` (approve / cancel a paused `/ask` action) |
