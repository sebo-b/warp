-- Remove default_zid from plan. Seats get their zone from the plan editor's
-- dropdown at creation time, not from a plan-level default.
ALTER TABLE plan DROP COLUMN default_zid;

UPDATE db_initialized SET version = 13;