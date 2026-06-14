-- Introduce the plan table. Plans own the floor-map image and all seats.
-- Zones are reduced to pure access-control (no iid, no zone_group).
-- Seats gain a pid (plan id) column; zone_group is replaced by pid for
-- the double-booking overlap check.

-- 1. New plan table
CREATE TABLE plan (
    id SERIAL PRIMARY KEY,
    name text NOT NULL,
    iid integer REFERENCES blobs(id) ON DELETE SET NULL,
    default_zid integer REFERENCES zone(id) ON DELETE SET NULL
);

-- 2. Add pid to seat (nullable during migration)
ALTER TABLE seat ADD COLUMN pid integer REFERENCES plan(id) ON DELETE CASCADE;

-- 3. Data migration: one plan per existing zone (same name, same image)
INSERT INTO plan (name, iid, default_zid)
    SELECT name, iid, id FROM zone;

-- 4. Assign each seat to its zone's corresponding plan
UPDATE seat s SET pid = p.id
    FROM plan p WHERE p.default_zid = s.zid;

ALTER TABLE seat ALTER COLUMN pid SET NOT NULL;

CREATE INDEX seat_pid ON seat(pid);

-- 5. Strip image and zone_group from zone
ALTER TABLE zone DROP COLUMN iid;
ALTER TABLE zone DROP COLUMN zone_group;

-- 6. Recreate book_overlap_insert to enforce one booking per zone (seat.zid)
CREATE OR REPLACE FUNCTION book_overlap_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.fromTS >= NEW.toTS THEN
        RAISE EXCEPTION 'Incorect time';
    END IF;

    IF
        (SELECT 1 FROM book b
         JOIN seat s ON b.sid = s.id
         WHERE s.zid = (SELECT zid FROM seat WHERE id = NEW.sid)
         AND (b.sid = NEW.sid OR b.login = NEW.login)
         AND b.fromTS < NEW.toTS
         AND b.toTS > NEW.fromTS) IS NOT NULL
    THEN
        RAISE 'Overlapping time for this seat or users' USING ERRCODE = 'exclusion_violation';
    END IF;

    RETURN NEW;
END;
$$;

UPDATE db_initialized SET version = 11;
