DO $$
BEGIN
    IF (SELECT version FROM db_initialized LIMIT 1) = 0 THEN
        ALTER TABLE seat_assign ADD COLUMN IF NOT EXISTS days_in_advance integer;
        UPDATE db_initialized SET version = 1;
    END IF;
END $$;
