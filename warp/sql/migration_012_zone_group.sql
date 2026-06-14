-- Restore zone_group as an optional (nullable) text column on zone.
-- NULL means per-zone constraint (one seat per zone).
-- Non-NULL means zone-group constraint (one seat across all zones sharing the same group name).
-- No sentinel value is used; the absence of a group is expressed as NULL.

ALTER TABLE zone ADD COLUMN zone_group text DEFAULT NULL;

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

UPDATE db_initialized SET version = 12;
