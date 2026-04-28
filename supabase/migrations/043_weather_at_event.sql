-- =============================================================================
-- 043: Weather at event
--
-- Extreme weather is its own axis of evidence. Major storms cover
-- abductions (witnesses indoors, reports delayed); cold-snap deaths look
-- different from warm-weather accidents; a Christmas-Eve blizzard rewrites
-- what a "last seen near home" report can mean. Until now Threadline knew
-- the date and the city but never asked what the weather was that day.
--
-- This adds two fields to import_records: a JSONB summary of conditions on
-- the relevant date (from Open-Meteo Archive), and a fetched-at timestamp
-- so the scraper knows what to revisit. Open-Meteo is free and key-less so
-- we avoid the bandwidth/storage of a per-record cache table.
-- =============================================================================

ALTER TABLE import_records
  ADD COLUMN IF NOT EXISTS weather_at_event JSONB,
  ADD COLUMN IF NOT EXISTS weather_fetched_at TIMESTAMPTZ;

COMMENT ON COLUMN import_records.weather_at_event IS 'Open-Meteo daily summary for the event date at the record location. Shape: { date, temp_max_f, temp_min_f, precip_in, snow_in, wind_max_mph, weathercode, severity, notes }.';
COMMENT ON COLUMN import_records.weather_fetched_at IS 'When weather_at_event was last populated. Null = never fetched.';

CREATE INDEX IF NOT EXISTS idx_import_records_weather_pending
  ON import_records(weather_fetched_at)
  WHERE weather_fetched_at IS NULL;
