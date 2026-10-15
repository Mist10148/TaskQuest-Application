# Legacy SQL (historical, do not run)

These are MySQL-era scripts, kept for reference only. TaskQuest now runs on
PostgreSQL, and the schema is owned by the versioned migrations in `packages/shared/src/db/migrations/` and applied with:

```bash
npm run db:migrate
```

| File | Origin | Notes |
|------|--------|-------|
| `UPDATED_DATABASE_SCHEMA.sql` | Deployment folder | **Destructive**: drops every table. Hard-codes `USE test`. INT XP columns. |
| `FIX_XP_OVERFLOW.sql` | Deployment folder | One-off INT → BIGINT upgrade. Superseded by the MySQL-era migration `002_upgrade_legacy`. |
| `bot-v3.5-schema.sql` | `taskquest-bot/database/schema.sql` | Old bot schema with `blackjack_hands` and `started_at`. |

The MySQL-era migration `002_upgrade_legacy` upgraded databases that were created
by any of these scripts, by the bot's old runtime `CREATE TABLE` statements, or by
the web server's old runtime `ALTER`s. It was removed when the migrations were
squashed into the PostgreSQL baseline (`001_baseline`) and remains in git history;
the current release cannot open a database made by these scripts. See
[docs/MIGRATION_POSTGRES.md](../../docs/MIGRATION_POSTGRES.md).
