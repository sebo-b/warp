-- Rename default_zone → default_plan; FK now references plan(id)
ALTER TABLE user_prefs RENAME COLUMN default_zone TO default_plan;

-- Drop old FK
ALTER TABLE user_prefs DROP CONSTRAINT IF EXISTS user_prefs_default_zone_fkey;

-- Reset to NULL before adding new FK — the stored zone IDs are not valid plan IDs
UPDATE user_prefs SET default_plan = NULL;

-- Add new FK
ALTER TABLE user_prefs ADD FOREIGN KEY (default_plan) REFERENCES plan(id) ON DELETE SET NULL;
