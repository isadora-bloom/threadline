-- City geocode cache
-- Stores lat/lng for city+state combos extracted from submission location fields.
-- Populated by scripts/geocode-submissions.ts via Nominatim (OpenStreetMap).

CREATE TABLE IF NOT EXISTS city_geocodes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city        TEXT NOT NULL,
  state       TEXT NOT NULL,
  country     TEXT NOT NULL DEFAULT 'US',
  lat         FLOAT NOT NULL,
  lng         FLOAT NOT NULL,
  display_name TEXT,
  source      TEXT NOT NULL DEFAULT 'nominatim',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (city, state, country)
);

-- Fast lookup by city+state
CREATE INDEX IF NOT EXISTS idx_city_geocodes_lookup ON city_geocodes (lower(city), lower(state));

COMMENT ON TABLE city_geocodes IS
  'Cache of lat/lng for city+state combos from Doe Network submission locations. '
  'Used by highway_proximity and national_park_proximity cluster analyses '
  'to compute real geographic distances rather than city-name string matching.';
