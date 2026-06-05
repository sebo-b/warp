DO $$
BEGIN
    IF (SELECT version FROM db_initialized LIMIT 1) = 2 THEN
        ALTER TABLE seat_assign DROP CONSTRAINT IF EXISTS seat_assign_pkey;
        ALTER TABLE seat_assign ALTER COLUMN login DROP NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS seat_assign_uq          ON seat_assign(sid, login) WHERE login IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS seat_assign_everyone_uq ON seat_assign(sid)         WHERE login IS NULL;
        UPDATE db_initialized SET version = 3;
    END IF;
END $$;
