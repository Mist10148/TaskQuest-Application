-- ═══════════════════════════════════════════════════════════════════════════════
--  FIX: XP OVERFLOW - Upgrade INT to BIGINT
--
--  Problem: INT max value is 2,147,483,647
--  Solution: BIGINT max value is 9,223,372,036,854,775,807
--
--  Run this to fix XP capping issue without losing data!
-- ═══════════════════════════════════════════════════════════════════════════════

USE test;

-- Upgrade users table XP columns
ALTER TABLE users MODIFY COLUMN player_xp BIGINT DEFAULT 0;
ALTER TABLE users MODIFY COLUMN player_level BIGINT DEFAULT 1;

-- Upgrade xp_transactions table
ALTER TABLE xp_transactions MODIFY COLUMN amount BIGINT NOT NULL;
ALTER TABLE xp_transactions MODIFY COLUMN balance_before BIGINT DEFAULT 0;
ALTER TABLE xp_transactions MODIFY COLUMN balance_after BIGINT DEFAULT 0;

-- Verify changes
DESCRIBE users;
DESCRIBE xp_transactions;

SELECT 'XP columns upgraded successfully! You can now earn unlimited XP!' AS status;
