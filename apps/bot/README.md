# @taskquest/bot

The TaskQuest Discord bot (discord.js 14, CommonJS). It is a thin Discord view over
[`@taskquest/shared`](../../packages/shared), so all rules, XP and data access live there.

```bash
# configure the shared root .env (cp ../../.env.example ../../.env)
npm run deploy -- --guild=ID    # register slash commands (omit --guild for global)
npm run dev                     # run with auto-reload
```

| Path | Purpose |
|---|---|
| `index.js` | Client setup, interaction routing, background jobs, health endpoint |
| `deploy-commands.js` | Slash command registration |
| `commands/list.js` | `/list`: lists and tasks |
| `commands/game.js` | `/game`: Blackjack, RPS, Hangman |
| `commands/gamification.js` | `/daily /profile /achievements /class /leaderboard /toggle /automation /help /app /ping` |
| `utils/ui.js` | Embeds, buttons, menus and modals |
| `utils/respond.js` | Error and reward responses |

See [docs/COMMANDS.md](../../docs/COMMANDS.md) for every command and [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md) for hosting.
