-- Add per-plan dark-mode map filter settings.
ALTER TABLE plan ADD COLUMN dark_filter jsonb NOT NULL DEFAULT '{"id":"smart","invert":100,"grayscale":0,"sepia":0,"saturate":100,"hue":180,"brightness":100,"contrast":100}';

-- Existing plans default to the "smart" filter preset.
UPDATE plan SET dark_filter = '{"id":"smart","invert":100,"grayscale":0,"sepia":0,"saturate":100,"hue":180,"brightness":100,"contrast":100}';

UPDATE db_initialized SET version = 17;
