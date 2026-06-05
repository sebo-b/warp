DO $$
BEGIN
    IF (SELECT version FROM db_initialized LIMIT 1) = 3 THEN
        CREATE TABLE IF NOT EXISTS user_prefs (
            login text PRIMARY KEY,
            default_zone integer,
            default_day text NOT NULL DEFAULT 'same',
            default_time_from integer NOT NULL DEFAULT 32400,
            default_time_to integer NOT NULL DEFAULT 61200,
            FOREIGN KEY (login) REFERENCES users(login) ON DELETE CASCADE,
            FOREIGN KEY (default_zone) REFERENCES zone(id) ON DELETE SET NULL
        );
        UPDATE db_initialized SET version = 4;
    END IF;
END $$;
