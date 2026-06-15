-- Migration 12: rework calendar_cache for per-type iCal URL filtering.
-- Drops and recreates the table — it only exists on this local branch, no data to migrate.

DROP TABLE IF EXISTS calendar_cache;

CREATE UNLOGGED TABLE calendar_cache (
    login text NOT NULL,
    type text NOT NULL CHECK (type IN ('bookings', 'reminders')),
    ics text NOT NULL,
    day integer NOT NULL,
    generated_at integer NOT NULL,
    FOREIGN KEY (login) REFERENCES users(login) ON DELETE CASCADE,
    PRIMARY KEY (login, type)
);
