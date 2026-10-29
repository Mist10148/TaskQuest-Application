# @taskquest/bot

The TaskQuest Discord bot (discord.js 14, CommonJS). It is a thin Discord view over
[`@taskquest/shared`](../../packages/shared), so all rules, XP and data access live there.

```bash
# configure the shared root .env (cp ../../.env.example ../../.env)
npm run deploy -- --guild=ID    # register slash commands (omit --guild for global)
npm run dev                     # run with auto-reload
npm test                        # node:test (from the repo root: npm test -w @taskquest/bot); DB flows need TEST_DB_NAME
```

| Path | Purpose |
|---|---|
| `index.js` | Client setup, interaction routing, background jobs, health endpoint |
| `deploy-commands.js` | Slash command registration |
| `commands/list.js` | `/list`: lists and tasks |
| `commands/game.js` | `/game`: Blackjack, RPS, Hangman |
| `commands/gamification.js` | `/daily /freeze /profile /achievements /class /leaderboard /toggle /automation /help /app /ping` |
| `commands/quests.js`, `commands/review.js`, `commands/prestige.js` | `/quests`, `/review` (weekly bonus), `/prestige` (two-step reset) |
| `commands/shop.js` | `/shop`: titles, frames and accents bought with XP |
| `commands/sharing.js`, `commands/party.js` | `/share /invites /members /leave` (shared lists) and `/party` (parties and the weekly party quest) |
| `commands/timezone.js`, `commands/weekly.js`, `commands/quick.js` | `/timezone`, `/weekly` (digest DM) and `/quick` (add a task from one line) |
| `commands/ai.js` | `/summary /prioritize /ask /forget /ai-format` (AI service) |
| `chat.js` | Replies to @mentions, replies and DMs through the AI service's `/v1/converse` |
| `utils/reminders.js`, `utils/digest.js`, `utils/streakWarning.js` | Deadline and task reminder DMs (and web push), the weekly digest and the streak-at-risk warning |
| `utils/aiSync.js` | Re-indexes quests in the AI service after edits made in Discord |
| `utils/aiFormat.js` | Embeds and buttons for `/summary`, `/prioritize` and `/ask` (pure functions of the AI service's answers) |
| `utils/job.js` | Background-job wrapper: logs failures and never starts a run while the previous one is still going |
| `utils/profile.js` | Keeps the cached Discord profile fresh for anyone who uses a command, so bot-only players can be invited by username |
| `utils/ui.js` | Embeds, buttons, menus and modals |
| `utils/respond.js` | Error and reward responses |
| `utils/listChoice.js` | List autocomplete and lookup for `/quick`, `/list`, `/share`, `/leave` and `/summary`: a name two of your lists share (ignoring case), or one that looks like `#12`, is offered as `#<id>` |

See [docs/COMMANDS.md](../../docs/COMMANDS.md) for every command and [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md) for hosting.
