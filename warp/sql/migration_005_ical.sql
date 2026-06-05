ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS ical_enabled boolean NOT NULL DEFAULT FALSE;
ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS ical_token text;
CREATE UNIQUE INDEX IF NOT EXISTS user_prefs_ical_token_idx ON user_prefs(ical_token) WHERE ical_token IS NOT NULL;
