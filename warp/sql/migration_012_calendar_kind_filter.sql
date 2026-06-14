-- Migration 12: support kind-filtered iCal URLs (bookings only / reminders only / all)
-- The calendar_cache now keys on (login, kind) so we can cache variants of the feed.

ALTER TABLE calendar_cache ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'all';

-- Drop the legacy single-column PK (if present) so we can establish a composite PK.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'calendar_cache'
          AND constraint_type = 'PRIMARY KEY'
          AND table_schema = current_schema()
    ) THEN
        ALTER TABLE calendar_cache DROP CONSTRAINT calendar_cache_pkey;
    END IF;
END $$;

ALTER TABLE calendar_cache ADD PRIMARY KEY (login, kind);

-- Existing cached rows (from before this migration) receive kind='all' via the DEFAULT
-- and remain usable for the unfiltered ("all") URL. Requests for kind=bookings or
-- kind=reminders will populate their own rows on first use / cache miss.
