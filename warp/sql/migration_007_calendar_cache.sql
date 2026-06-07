CREATE UNLOGGED TABLE IF NOT EXISTS calendar_cache (
    login text PRIMARY KEY,
    ics text NOT NULL,
    day integer NOT NULL,
    generated_at integer NOT NULL,
    FOREIGN KEY (login) REFERENCES users(login) ON DELETE CASCADE
);
