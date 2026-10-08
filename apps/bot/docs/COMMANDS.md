# Command and interaction reference

Every slash command, option, visibility rule, and component `customId` the bot handles. Visibility means whether the response is public (anyone in the channel sees it) or ephemeral (only the user sees it).

There are 12 slash commands. Interactions are routed as described in [ARCHITECTURE.md](ARCHITECTURE.md#4-interaction-routing).

## Slash commands

| Command | Options | Visibility | Summary |
|---|---|---|---|
| `/list` | `name` (optional, autocomplete) | Public (overview, view and edit). Ephemeral for "List not found". | Opens the lists overview. With `name`, opens that list in VIEW mode. |
| `/game` | none | Ephemeral | Game centre. Resumes an active Blackjack hand if one exists. |
| `/ping` | none | Ephemeral | Shows bot latency and API latency. |
| `/daily` | none | Ephemeral | Claims the daily XP reward. |
| `/automation` | none | Ephemeral | Toggles deadline reminder DMs. |
| `/profile` | `user` (optional, user) | Public | Profile dashboard for you or the chosen user. |
| `/achievements` | none | Ephemeral | Paginated achievement list, 8 per page. |
| `/class` | none | Ephemeral | Class browser and shop. |
| `/leaderboard` | none | Public | Top 10 players by XP. |
| `/toggle` | none | Ephemeral | Turns the XP system on or off for you. |
| `/help` | none | Public | Command reference embed. |
| `/app` | none | Ephemeral | Button linking to the web dashboard at `WEB_APP_URL`. |

### `/list`

- **Autocomplete.** The `name` option suggests your list names, up to 25, matched case-insensitively.
- **Not found.** Returns an ephemeral "List not found" when the name does not match.
- **Overview.** Shows an embed, a list select menu, and the overview buttons. You can filter, sort and search from there.
- **Ownership.** Lists are looked up by your user ID, so you only see your own lists.

### `/game`

- Ephemeral throughout. Defers the reply before doing database work.
- If a Blackjack session is active, it reopens that hand instead of showing the menu.
- Otherwise shows the Game Center embed, your XP balance, and a select menu with Blackjack, Rock-Paper-Scissors and Hangman.

### `/daily`

- Ephemeral. Shows the XP breakdown: base, class bonus, streak bonus, and skill bonus.
- Shows a streak-lost message when a streak above 1 resets.
- At 7 and 30 day streaks, shows a milestone field.
- Cooldown is 24 hours from your last claim.

### `/automation`

- Toggles reminder DMs. When enabled, the reply says the bot will DM you when a list is due today.
- Reminders are sent by the hourly job in `index.js`, not by this command.

### `/profile`

Shows:

- Class and level, with a progress bar for XP inside the current level, and XP needed for the next level.
- Focus rate, which is completed items divided by total items, with a bar.
- Tasks completed out of total, and the number of lists.
- Current streak and the number of skills unlocked.
- Games played, wins and losses, and win rate. Win rate is wins ÷ (wins + losses), so draws are excluded.
- A footer showing whether XP is active or disabled.

The embed colour comes from your class.

### `/achievements`

- Ephemeral. Eight achievements per page.
- Buttons: first, previous, a page counter (disabled), next, last.
- Page is kept in memory per user. Restarting the bot returns you to page 1.

### `/class`

- Ephemeral browser. Previous and next move through the seven classes in order.
- Action buttons depend on state: equip an owned class, buy a class not yet owned, or open the skill tree.
- A "Return to Default" button equips the free DEFAULT class.
- Class purchases and skill purchases are described in [GAMEPLAY.md](GAMEPLAY.md#3-classes).

### `/leaderboard`

- Public. The top 10 users with gamification enabled, ordered by XP.
- Medals for the top three. Each row shows the class emoji, XP, level, and, when above zero, games played and streak.
- Shows names fetched from the server member list where possible, then from Discord's user lookup, then "Unknown User".
- The leaderboard is global, not limited to the server where it is run.

### `/toggle`

- Ephemeral. Flips your gamification setting. When off, XP is not awarded for list actions, and you are excluded from the leaderboard.
- Lists and items still work with the setting off.

### `/help`

- Public. Shows the help embed.

### `/app`

- Ephemeral. Shows an embed with a Link button to `WEB_APP_URL`, or `https://taskquest.app` if that is not set.

### `/ping`

- Ephemeral. Reports the time taken to defer the reply and the Discord WebSocket ping. Does not touch the database.

## Lists: buttons, menus and modals

These controls appear on `/list` screens. Where a `<listId>` is shown, it is the numeric ID of the list.

### Overview screen

| `customId` | Action |
|---|---|
| `sort_az` | Sort lists by name A-Z |
| `sort_date` | Sort lists by creation date, newest first |
| `sort_pri` | Sort lists by priority, highest first |
| `filter_all` | Show all lists |
| `filter_current` | Show lists whose deadline is not in the past |
| `filter_expired` | Show lists whose deadline is in the past |
| `filter_completed` | Show lists with at least one item where every item is complete |
| `filter_cat` | Show the category filter select above the list select |
| `filter_category` (select) | Filter by `ALL`, `NONE` (uncategorised), or a category name |
| `sel_list` (select) | Open the chosen list in VIEW mode |
| `create` | Open the new-list modal `m_newlist` |
| `back` | Return to the overview |

### VIEW mode (read-only)

| `customId` | Action |
|---|---|
| `sort_az_<listId>` | Sort items A-Z |
| `sort_za_<listId>` | Sort items Z-A |
| `sort_pri_<listId>` | Show incomplete items first. Despite the name, this sorts by completion, not priority. |
| `search_<listId>` | Open the search modal `m_search` |
| `refresh_<listId>` | Reload the list from the database |
| `edit_<listId>` | Switch to EDIT mode |

### EDIT mode

| `customId` | Action |
|---|---|
| `view_<listId>` | Return to VIEW mode |
| `item_add_<listId>` | Open the add-item modal `m_additem_<listId>` |
| `item_edit_<listId>` | Show item select `sel_edit_<listId>`. Choosing an item opens `m_edititem_<itemId>` to rename it. |
| `item_del_<listId>` | Show item select `sel_del_<listId>`. Choosing an item deletes it immediately, with no confirmation. |
| `item_done_<listId>` | Show item select `sel_done_<listId>`. Choosing an item toggles its completion. Completing it awards XP. |
| `item_swap_<listId>` | Two-step reorder. Needs at least two items. Select the first item (`sel_swap1_<listId>`), then the second (`sel_swap2_<listId>`). The first pick is stored in memory. |
| `item_desc_<listId>` | Show item select `sel_desc_<listId>`. Choosing an item opens `m_desc_<itemId>` to edit its description. |
| `list_meta_<listId>` | Show the category select `cat_<listId>`, the priority select `pri_<listId>`, and a Rename button. |
| `rename_<listId>` | Open `m_editlist_<listId>` to change name, description and deadline. |
| `list_del_<listId>` | Ask for confirmation. `yes_<listId>` deletes the list and all its items. `no_<listId>` cancels. |
| `metadone_<listId>` | Return to EDIT mode after changing category or priority. |

Category and priority selects check ownership and update the list. Each keeps the "Edit List Info" panel open with a Done button.

### Modals

| Modal `customId` | Fields | Notes |
|---|---|---|
| `m_newlist` | `name`, `desc`, `deadline` | Duplicate names are rejected. A deadline that is not `YYYY-MM-DD` is dropped. After creation, shows category and priority selects. Awards list-creation XP. |
| `m_editlist_<listId>` | `name`, `desc`, `deadline` | Changing the deadline resets the reminder flag. Does not re-check for duplicate names. |
| `m_additem_<listId>` | `name`, `desc` | Adds an item. Awards item XP. |
| `m_edititem_<itemId>` | `name` | Renames the item. |
| `m_desc_<itemId>` | `desc` | Sets the item description. An empty value clears it. |
| `m_search` | `q` | Searches list names. Shows matching lists publicly. |

### Ownership checks

- **Checked:** list-level buttons (`edit_`, `view_`, `rename_`, `list_del_`, and similar), and the category and priority selects. A non-owner gets "Access Denied".
- **Not checked:** item-level buttons and selects (`item_*`, `sel_*` for items, `m_additem_`, `m_edititem_`, `m_desc_`), and the list rename and search paths. These trust the `customId`.

This is a known issue. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## Games: buttons, menus and modals

| `customId` | Where | Action |
|---|---|---|
| `game_select` | `/game` menu | Values `blackjack`, `rps`, `hangman` |
| `bj_bet_10`, `bj_bet_25`, `bj_bet_50`, `bj_bet_100`, `bj_bet_250` | Blackjack bet screen | Start a hand with that bet. Only bets at or below your maximum appear. |
| `bj_bet_max` | Blackjack bet screen | Bet the maximum allowed |
| `bj_bet_custom` | Blackjack bet screen | Open `bj_bet_modal` |
| `bj_bet_modal` | Modal, field `bet_amount` | Start a hand with a typed bet. Limited to 10 characters. |
| `bj_hit` | Blackjack table | Draw a card |
| `bj_stand` | Blackjack table | Dealer plays out, then the hand is settled |
| `bj_double` | Blackjack table | Double the bet, draw one card, then settle. Only with two cards, and only if you can cover the extra bet. |
| `bj_playagain` | Blackjack result | Return to the bet screen |
| `rps_rock`, `rps_paper`, `rps_scissors` | RPS screen | Play a round |
| `hm_letter_select` (select) | Hangman | Guess a letter, values `letter_A` to `letter_Z` |
| `hm_quit` | Hangman | End the game |
| `hm_playagain` | Hangman result | Start a new word |
| `hm_show_<letter>_<timestamp>` | Hangman | Disabled display buttons for the last 10 guesses |
| `game_back` | Any game screen | Return to the Game Center |

Game rules and payouts are in [GAMEPLAY.md](GAMEPLAY.md#5-mini-games).

## Class and skill interactions

| `customId` | Action |
|---|---|
| `class_prev`, `class_next` | Move through the class browser |
| `class_browse` | Return to the class browser |
| `class_return_default` | Equip DEFAULT |
| `cbuy_<CLASS>` | Buy a class with XP |
| `ceq_<CLASS>` | Equip an owned class. Equipping resets that class's counters. |
| `ceq_DEFAULT` | Equip DEFAULT |
| `class_skills` | Open the skill tree for the current class |
| `class_select` (select) | Legacy. Returns to the browser. |
| `skill_select` (select) | Show a skill's details and action buttons. Does not unlock the skill. |
| `skill_unlock_<skillId>` | Unlock the skill, or upgrade it if already owned |
| `skill_back` | Return from the skill tree to the browser |

## Achievement interactions

| `customId` | Action |
|---|---|
| `ach_first`, `ach_prev`, `ach_next`, `ach_last` | Page through achievements |

## Unknown interactions

A button or menu that the router does not recognise replies "Button expired or unknown". This is what users see after a restart if they click an old message whose handler state was in memory.
