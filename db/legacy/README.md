# Legacy SQL (historical, do not run)

These scripts are kept for reference only. The schema is now owned by the
versioned migrations in `packages/shared/src/db/migrations/` and applied with:

```bash
npm run db:migrate
```

| File | Origin | Notes |
|------|--------|-------|
| `UPDATED_DATABASE_SCHEMA.sql` | Deployment folder | **Destructive**: drops every table. Hard-codes `USE test`. INT XP columns. |
| `FIX_XP_OVERFLOW.sql` | Deployment folder | One-off INT → BIGINT upgrade. Superseded by migration `002_upgrade_legacy`. |
| `bot-v3.5-schema.sql` | `taskquest-bot/database/schema.sql` | Old bot schema with `blackjack_hands` and `started_at`. |

Migration `002_upgrade_legacy` upgrades databases that were created by any of
these scripts, by the bot's old runtime `CREATE TABLE` statements, or by the
web server's old runtime `ALTER`s.
