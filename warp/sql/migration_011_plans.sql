-- Introduce the plan table. Plans own the floor-map image and all seats;
-- zones become pure access-control (no image, no seats of their own).
--
-- Consolidated plans migration: it takes a v10 database straight to the final
-- plans schema. Earlier development revisions of this branch split the work
-- across three migrations (add plan.default_zid, restore zone.zone_group, then
-- drop plan.default_zid). None of those intermediate states ever shipped, so
-- they are folded into this single, churn-free step.

-- 1. New plan table. The floor-map image (iid) moves here from zone.
CREATE TABLE plan (
    id SERIAL PRIMARY KEY,
    name text NOT NULL,
    iid integer REFERENCES blobs(id) ON DELETE SET NULL
);

-- Temporary column: remembers which zone each plan was derived from so seats can
-- be matched to their new plan below. Dropped before the migration finishes.
ALTER TABLE plan ADD COLUMN src_zid integer;

-- 2. Add pid to seat (nullable until back-filled below).
ALTER TABLE seat ADD COLUMN pid integer REFERENCES plan(id) ON DELETE CASCADE;

-- 3. One plan per existing zone (same name, same image).
INSERT INTO plan (name, iid, src_zid)
    SELECT name, iid, id FROM zone;

-- 4. Point each seat at the plan derived from its zone.
UPDATE seat s SET pid = p.id
    FROM plan p WHERE p.src_zid = s.zid;

ALTER TABLE seat ALTER COLUMN pid SET NOT NULL;
ALTER TABLE plan DROP COLUMN src_zid;

CREATE INDEX seat_pid ON seat(pid);

-- 5. Zones no longer own the floor-map image; it now lives on the plan.
--    zone_group already exists (migration 010) and is kept as-is.
ALTER TABLE zone DROP COLUMN iid;

-- 6. Re-create the double-booking trigger. The seat double-booking scope is the
--    zone (or its zone_group when set), no longer the old per-image grouping.
CREATE OR REPLACE FUNCTION book_overlap_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
DECLARE
    booking_zid INTEGER;
    zone_grp    TEXT;
BEGIN
    IF NEW.fromTS >= NEW.toTS THEN
        RAISE EXCEPTION 'Incorrect time';
    END IF;

    -- Always prevent double-booking the same seat
    IF EXISTS (
        SELECT 1 FROM book b
        WHERE b.sid = NEW.sid
          AND b.fromTS < NEW.toTS AND b.toTS > NEW.fromTS
    ) THEN
        RAISE 'Overlapping time for this seat or users' USING ERRCODE = 'exclusion_violation';
    END IF;

    SELECT s.zid, z.zone_group INTO booking_zid, zone_grp
    FROM seat s JOIN zone z ON z.id = s.zid WHERE s.id = NEW.sid;

    IF zone_grp IS NOT NULL THEN
        -- Zone-group mode: user cannot hold two seats in any zone of the same group simultaneously
        IF EXISTS (
            SELECT 1 FROM book b
            JOIN seat s ON s.id = b.sid
            JOIN zone z ON z.id = s.zid
            WHERE b.login = NEW.login
              AND z.zone_group = zone_grp
              AND b.fromTS < NEW.toTS AND b.toTS > NEW.fromTS
        ) THEN
            RAISE 'Overlapping time for this seat or users' USING ERRCODE = 'exclusion_violation';
        END IF;
    ELSE
        -- Per-zone mode: user cannot hold two seats in the same zone simultaneously
        IF EXISTS (
            SELECT 1 FROM book b
            JOIN seat s ON s.id = b.sid
            WHERE b.login = NEW.login
              AND s.zid = booking_zid
              AND b.fromTS < NEW.toTS AND b.toTS > NEW.fromTS
        ) THEN
            RAISE 'Overlapping time for this seat or users' USING ERRCODE = 'exclusion_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

UPDATE db_initialized SET version = 11;
