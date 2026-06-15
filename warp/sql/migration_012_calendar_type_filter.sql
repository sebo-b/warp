-- Migration 12: rework calendar_cache for per-type iCal URL filtering.
-- The old schema keyed the cache by login alone; the new one keys by (login, type).
-- calendar_cache is a regenerable UNLOGGED cache (created in migration 007), so we
-- drop and recreate it rather than migrating rows — the feed repopulates on demand.

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
