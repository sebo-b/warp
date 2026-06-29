-- Migration 018: per-plan IANA timezone
--
-- Adds plan.timezone (text NOT NULL), the book_utc view (derives real UTC
-- instants from wall-clock storage + plan TZ), and rewrites
-- book_overlap_insert to compare real instants in cross-plan/zone-group
-- branches.  Storage (book.fromts/tots) is UNCHANGED — no backfill.
--
-- OPERATOR CAVEAT: existing plan rows are seeded from current_setting('TIMEZONE')
-- (the Postgres server TZ).  This is correct when the app and PG ran in the
-- same zone.  If they differed, SET TIME ZONE '<zone>' for the migration session
-- or edit plan.timezone after migration, before any new bookings.

BEGIN;

ALTER TABLE plan ADD COLUMN timezone text;

UPDATE plan SET timezone = current_setting('TIMEZONE') WHERE timezone IS NULL;

-- current_setting() writes the server TZ string raw, bypassing the app's
-- python∩postgres validation. Canonicalize UTC aliases and clamp anything
-- Postgres itself can't name-resolve to 'UTC', so no plan row can carry a value
-- that later throws. (Python-side resolvability — a zone Postgres knows but a
-- stripped zoneinfo doesn't — is re-checked and repaired at startup; see
-- _loadValidTimezones.)
UPDATE plan SET timezone = 'UTC'
 WHERE timezone IN ('Etc/UTC', 'GMT', 'Etc/GMT', 'Universal', 'Zulu')
    OR timezone NOT IN (SELECT name FROM pg_timezone_names);

-- iCal feeds cached before this migration used the old global-TIMEZONE logic and
-- carry no per-plan VTIMEZONE; the (login, type) cache would serve them until the
-- day rolls over. The table is UNLOGGED and regenerates lazily on next fetch.
DELETE FROM calendar_cache;

ALTER TABLE plan ALTER COLUMN timezone SET NOT NULL;
ALTER TABLE plan ALTER COLUMN timezone SET DEFAULT 'UTC';

CREATE VIEW book_utc AS
SELECT b.id AS bid, b.login, b.sid, s.zid, z.zone_group, p.timezone,
       b.fromts, b.tots,
       (to_timestamp(b.fromts) AT TIME ZONE 'UTC' AT TIME ZONE p.timezone) AS from_utc,
       (to_timestamp(b.tots)   AT TIME ZONE 'UTC' AT TIME ZONE p.timezone) AS to_utc
FROM book b
JOIN seat s ON s.id = b.sid
JOIN zone z ON z.id = s.zid
JOIN plan p ON p.id = s.pid;

CREATE OR REPLACE FUNCTION book_overlap_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
DECLARE
    booking_zid  INTEGER;
    zone_grp     TEXT;
    new_tz       TEXT;
    new_from_utc timestamptz;
    new_to_utc   timestamptz;
BEGIN
    IF NEW.fromTS >= NEW.toTS THEN
        RAISE EXCEPTION 'Incorrect time';
    END IF;

    -- Same seat: same plan => same TZ => raw integer overlap is correct and index-friendly
    IF EXISTS (
        SELECT 1 FROM book b
        WHERE b.sid = NEW.sid
          AND b.fromTS < NEW.toTS AND b.toTS > NEW.fromTS
    ) THEN
        RAISE 'Overlapping time for this seat or users' USING ERRCODE = 'exclusion_violation';
    END IF;

    SELECT s.zid, z.zone_group, p.timezone
      INTO booking_zid, zone_grp, new_tz
    FROM seat s JOIN zone z ON z.id = s.zid JOIN plan p ON p.id = s.pid
    WHERE s.id = NEW.sid;

    new_from_utc := to_timestamp(NEW.fromTS) AT TIME ZONE 'UTC' AT TIME ZONE new_tz;
    new_to_utc   := to_timestamp(NEW.toTS)   AT TIME ZONE 'UTC' AT TIME ZONE new_tz;

    IF zone_grp IS NOT NULL THEN
        -- Zone-group may span plans/TZs: compare real instants via book_utc
        IF EXISTS (
            SELECT 1 FROM book_utc bu
            WHERE bu.login = NEW.login
              AND bu.zone_group = zone_grp
              AND bu.from_utc < new_to_utc AND bu.to_utc > new_from_utc
        ) THEN
            RAISE 'Overlapping time for this seat or users' USING ERRCODE = 'exclusion_violation';
        END IF;
    ELSE
        -- Ungrouped: same zone (a zone may also span plans) -> real instants
        IF EXISTS (
            SELECT 1 FROM book_utc bu
            WHERE bu.login = NEW.login
              AND bu.zid = booking_zid
              AND bu.from_utc < new_to_utc AND bu.to_utc > new_from_utc
        ) THEN
            RAISE 'Overlapping time for this seat or users' USING ERRCODE = 'exclusion_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

UPDATE db_initialized SET version = 18;

COMMIT;
