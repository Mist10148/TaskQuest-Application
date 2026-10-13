# Design: shared and team lists

| | |
|---|---|
| **Status** | **Implemented** (shared lists, then minimal parties). See [Decisions and what was built](#decisions-and-what-was-built) |
| **Why it was a design note first** | It changes the ownership model that every query in the system relies on. |
| **Related** | [ARCHITECTURE §2](../ARCHITECTURE.md#2-the-shared-package), [SECURITY](../SECURITY.md), [PRD roadmap](../PRD.md#11-roadmap) |

## Problem

Lists belong to exactly one person. Households, study groups and small teams ask to work on the same list. Today the only option is to share one Discord account, which also shares XP, streaks and the leaderboard.

## What must not break

TaskQuest's safety comes from one rule: **every statement filters by the acting user's Discord ID** (`WHERE l.discord_id = ?`), inside the shared package, so the bot, the API and the AI service cannot forget it. Sharing must keep that property: no code path may read or write another user's list *unless* a membership row says it may.

Two more things are easy to get wrong:

- **XP is personal.** If a shared task is completed by Alice, the XP goes to Alice (the person who acted), not to the list owner and not to everyone. Anti-farming (50 completions a day) must still count the actor.
- **Privacy.** The AI service must not embed or summarise a shared list into a member's vectors in a way that leaks it to a person who later leaves, and `/list` overviews are public messages in Discord (see [KNOWN_ISSUES #5](../KNOWN_ISSUES.md)).

## Proposed model

```
lists            (unchanged: owner stays discord_id, the person who created it)
list_members     list_id, discord_id, role ENUM('viewer','editor','manager'), added_by, created_at
                 PRIMARY KEY (list_id, discord_id)
list_invites     token (random, 128 bit, hashed in the DB), list_id, role, expires_at, max_uses, uses, created_by
```

The owner is implicitly a `manager` (no row needed). Roles:

| Role | Can |
|---|---|
| viewer | read the list and its tasks |
| editor | viewer + add, edit, reorder and complete tasks, and delete the tasks they added (a manager or the owner deletes any) |
| manager | editor + edit list fields, invite and remove members, delete the list |

(Only the owner can transfer ownership or delete a list that has other managers.)

### One access function

Replace "WHERE owner = ?" with a single reusable predicate so there is exactly one place to get it right:

```sql
-- lists the user can see (owner, or any membership)
SELECT l.* FROM lists l
LEFT JOIN list_members m ON m.list_id = l.id AND m.discord_id = :me
WHERE l.discord_id = :me OR m.discord_id IS NOT NULL
```

In code: `access.forList(conn, discordId, listId, minRole)` returns the list or throws `NOT_FOUND` (never `FORBIDDEN`, so existence still does not leak) and is the only way `tasks.js` loads a list or item. Every existing service function is rewritten to call it; the ownership integration tests then become the regression suite (they must still pass unchanged for single-user lists).

### Rewards

- `rewardAction` keeps taking the **actor's** locked user row. Creating a shared list or task rewards the creator; completing rewards the person who completed.
- **Lock order** is user row, then the list row, then item rows, everywhere. `access.forItem(..., { lock: true })` finds the item's list without a lock, locks the list first and then the item; `swapItemPositions` locks its two items in ascending id order. A concurrency test (several editors swapping, moving, reordering and editing one shared list at once) fails if any path takes the locks the other way round.
- `items.completed_by` records who completed a task, so the weekly digest and quests count the right person.
- Quests and `total_items_completed` count the actor's completions only.

### Discord

- `/list` shows lists you own **and** lists shared with you, with a 👥 marker.
- `/share list:<name> user:<@member> role:<role>` for managers; the invited member gets an ephemeral accept button. No public invite links in the first version.
- Reminders go to each member who has automation on, once per member, not once per list.

### Web

- A "Members" panel on the list (add by exact Discord username of someone who has logged in before, after confirming who it is, change role, remove, leave).
- Presence is out of scope: changes appear on refresh or the next query invalidation. Optimistic concurrency for edits uses `updated_at`.

### AI service

Opt-in per list. Shared lists are excluded from a member's embeddings by default (`ai_embeddings.discord_id` stays the owner's), and the chat tools take the same access function through the internal API.

## Migration and rollout

1. Migration `010_list_members` adds the two tables and `items.completed_by` (nullable, back-filled from `lists.discord_id` for completed items).
2. Ship the access function behind no flag but with **no UI**, running the whole test suite; no behaviour changes yet.
3. Add the web Members panel and `/share`, then reminders and the digest.
4. Announce it as a beta and watch `list_members` growth and any `NOT_FOUND` spike.

## Risks

| Risk | Mitigation |
|---|---|
| A missed query leaks a list to non-members | One access function; a test that enumerates every exported `tasks.*` function and calls it as a stranger; code review checklist item |
| XP farming through two cooperating accounts on a shared list | XP and caps are per actor; completion caps already bound it to 50 a day each |
| Members see each other's names | Show only the stored display name, as the leaderboard does; never a Discord ID |
| Removing a member while they have the list open | Every request re-checks access; the next call returns 404 |
| Orphaned lists when the owner leaves | The owner cannot leave: they delete the list (ownership transfer is out of scope, [KNOWN_ISSUES #34](../KNOWN_ISSUES.md)) |

## Open questions for the product owner

1. Should members be able to see each other's XP or progress? (Recommendation: no.)
2. Should a shared list's completion count towards the owner's quests? (Recommendation: no, actor only.)
3. Do we need public invite links, or are named invites enough for a first release?
4. How many members per list (recommendation: start with 10)?

## Decisions and what was built

The open questions above were settled like this (the product owner was not available; these follow the recommendations, and are the first things to revisit):

1. **Members cannot see each other's XP or progress.** They see display names and roles only (and, in a party, this week's task count).
2. **A shared-list completion counts for the actor only**: their XP, their daily caps, their quests, their weekly review and stats. `items.first_completed_by`, `created_by`, `completed_by` and `lists.cleared_by` record the actor; the owner gets nothing for a member's work.
3. **Named invites only, no public links.** An invitation names one person who has used TaskQuest, found by their exact Discord username (`users.discord_handle`, unique, refreshed at every login; the display name is not unique and is never searched) and confirmed by the inviter in the web UI (a dry run shows the resolved person's name and avatar) or, for the bot, by the Discord ID Discord already gave it in a mention. The API never accepts a Discord ID. An invitation is only as good as its inviter: when a manager is removed, demoted below manager or leaves, their pending invitations are withdrawn, and accepting one also checks that the inviter is still the owner or a manager (a party invitation: still a member of the party).
4. **At most 10 people besides the owner** (members and pending invitations together, `LIMITS.MAX_LIST_MEMBERS`).

### As built, and where it differs from the proposal

| Proposal | Built |
|---|---|
| `list_invites` with a hashed token, `max_uses`, `uses` | A **named invitation** row (`invitee_discord_id`, `role`, `invited_by`, `expires_at` = 7 days, `status`). No tokens. |
| Migration `010_list_members` | `018_list_members` (010 was taken). It also adds `list_reminders` / `item_reminders` (per-member reminder state), `public_id` on members and the actor columns, with a backfill from the list owner. |
| "Managers can delete the list" | **Only the owner deletes a list**, which also settles "orphaned lists when the owner leaves": the owner cannot leave, they delete. Ownership transfer is out of scope. Only the owner makes or changes a manager and invites managers. |
| `access.forList(conn, discordId, listId, minRole)` | Built as proposed in `packages/shared/src/db/access.js`, with `forItem`, `accessSql` (queries over many lists) and `actorSql` (metrics by actor). A viewer attempting a write gets `FORBIDDEN` (they already know the list exists); a stranger always gets `NOT_FOUND`. |
| A test over every `tasks.*` function as a stranger | `db.integration.test.js` enumerates every export of `db.tasks`, `db.templates`, `db.transfer` and `db.quests`, requires each to be classified, and proves a non-member gets `NOT_FOUND` and writes nothing. Role matrix and "removed while open" tests are beside it. |
| Reminders once per member | Candidates are one row per recipient (owner or member with automation on); a member's sent/snooze state lives in `list_reminders` / `item_reminders`, the owner's stays on the list/item. A changed due date or deadline re-arms everybody's state only when the date really changes, at most 3 times a day per task or list (`rearm_count`, `rearm_day`); the bot sends a person at most 20 reminder DMs per run and one digest DM for the rest. |
| Auto-delete | Never deletes a list that has members. |
| Export / import | The export holds only lists you own; an import creates lists you own. The calendar feed includes lists you own or are a member of. |
| AI opt-in per list | **Not widened at all.** Shared lists are not embedded or summarised into a member's data, and the AI internal routes run through `db.tasks.asOwner`, which answers `404` for any list the user does not own. |
| Presence, optimistic concurrency | Out of scope (changes show on refresh / the next query). |
| Members see names | Display names only; a member's list and task rows are a column whitelist (`MEMBER_LIST_FIELDS`, `MEMBER_ITEM_FIELDS`), so the owner's reminder state and reward bookkeeping stay private; members are addressed by an opaque 12-character key, task rows expose `completed_by_name`, and lists you do not own carry no owner `discord_id`. |

Surfaces: web (Members dialog, invitation banner, read-only view for viewers), bot (`/share`, `/invites`, `/members`, `/leave`, role-aware `/list`), API ([API.md](../API.md#shared-lists-and-invitations)), schema ([DATABASE.md](../DATABASE.md#list_members)).

### Parties (minimal)

Built on the same invitation rules: `parties`, `party_members` (UNIQUE per user: one party each, up to 6), `party_invites`. The weekly **party quest** is 12 first completions per member over the global UTC ISO week, summed over the members, with +60 XP claimable once per person per week (`quest_claims` key `PARTY_<id>`, and one party reward per person per week across parties). It is not in `QUESTS` because its target depends on the member count. See [GAMEPLAY](../GAMEPLAY.md#5h-parties) and [API.md](../API.md#parties).

### Still open for a human

- ~~Opt out of invitations~~: built (`users.accept_invites`, a neutral answer to the inviter).
- Whether a manager should be able to delete the list, or ownership transfer is wanted.
- ~~Party owner removes a member~~: built (`/party kick`).
- Whether a viewer should keep seeing a shared list's task descriptions in Discord's public `/list` messages (the same caveat as any `/list` message: it is public in a channel).
