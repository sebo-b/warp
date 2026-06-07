CREATE TABLE IF NOT EXISTS user_prefs (
    login text PRIMARY KEY,
    default_zone integer,
    default_day text NOT NULL DEFAULT 'same',
    default_time_from integer NOT NULL DEFAULT 32400,
    default_time_to integer NOT NULL DEFAULT 61200,
    FOREIGN KEY (login) REFERENCES users(login) ON DELETE CASCADE,
    FOREIGN KEY (default_zone) REFERENCES zone(id) ON DELETE SET NULL
);
