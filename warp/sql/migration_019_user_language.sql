-- Per-user UI language selection. NULL = follow the deployment's
-- DEFAULT_LANGUAGE (the prefs modal's "Default" option). See PLAN_language_selection.md.
ALTER TABLE user_prefs ADD COLUMN language text;