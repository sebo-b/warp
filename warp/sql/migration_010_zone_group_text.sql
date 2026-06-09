-- Convert zone_group from integer to text. The legacy implicit-default group
-- (integer value 1) is marked via NULL during the conversion, then folded
-- into the sentinel in the USING expression of the type change. All other
-- integer values become "Group N".

ALTER TABLE zone ALTER COLUMN zone_group DROP NOT NULL;

UPDATE zone SET zone_group = NULL WHERE zone_group = 1;

-- One ALTER TABLE: convert type (NULLs become sentinel via COALESCE in the
-- USING expression), pin the sentinel as DEFAULT, restore NOT NULL.
ALTER TABLE zone
    ALTER COLUMN zone_group TYPE text
        USING COALESCE('Group ' || zone_group::text, '__default__:7f2b3c50-e8d1-4a9f-b6c3-2d8e7f1a4b09'),
    ALTER COLUMN zone_group SET DEFAULT '__default__:7f2b3c50-e8d1-4a9f-b6c3-2d8e7f1a4b09',
    ALTER COLUMN zone_group SET NOT NULL;
