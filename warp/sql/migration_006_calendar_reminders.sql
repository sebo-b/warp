ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS reminder_weekdays integer NOT NULL DEFAULT 0;
ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS reminder_ahead_days integer NOT NULL DEFAULT 0;
ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS reminder_time integer NOT NULL DEFAULT 79200;
ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS reminder_release_ahead_days integer NOT NULL DEFAULT 0;
ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS reminder_zones integer[] NOT NULL DEFAULT '{}';
