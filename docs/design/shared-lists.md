# Design: shared and team lists

| | |
|---|---|
| **Status** | Proposal, not built |
| **Why it is a design note and not code** | It changes the ownership model that every query in the system relies on. It needs decisions from the product owner (below) before anyone writes SQL. |
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
| editor | viewer + add, edit, reorder, complete and delete tasks |
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
- `items.completed_by` records who completed a task, so the weekly digest and quests count the right person.
- Quests and `total_items_completed` count the actor's completions only.

### Discord

- `/list` shows lists you own **and** lists shared with you, with a 👥 marker.
- `/share list:<name> user:<@member> role:<role>` for managers; the invited member gets an ephemeral accept button. No public invite links in the first version.
- Reminders go to each member who has automation on, once per member, not once per list.

### Web

- A "Members" panel on the list (add by Discord username that has logged in before, change role, remove, leave).
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
| Orphaned lists when the owner leaves | The owner cannot leave without transferring or deleting |

## Open questions for the product owner

1. Should members be able to see each other's XP or progress? (Recommendation: no.)
2. Should a shared list's completion count towards the owner's quests? (Recommendation: no, actor only.)
3. Do we need public invite links, or are named invites enough for a first release?
4. How many members per list (recommendation: start with 10)?
