DO $$
BEGIN
    IF (SELECT version FROM db_initialized LIMIT 1) = 1 THEN
        ALTER TABLE zone ADD COLUMN IF NOT EXISTS zone_type integer NOT NULL DEFAULT 20;
        UPDATE db_initialized SET version = 2;
    END IF;
END $$;
