-- =============================================================================
-- 042: Record photos
--
-- NamUs case-detail responses carry an `images` array. Until now we ignored
-- it, so every registry profile was a wall of text without a face. Adding
-- a photo column does not download the images — it stores the source URLs
-- and lets the UI fetch them through a server-side proxy that hot-links
-- with the right User-Agent and only allows known-source domains. This is
-- enough to put faces on profiles without taking on storage cost or
-- bandwidth bills.
-- =============================================================================

ALTER TABLE import_records
  ADD COLUMN IF NOT EXISTS photo_urls TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS photos_fetched_at TIMESTAMPTZ;

COMMENT ON COLUMN import_records.photo_urls IS 'Public URLs to the original-size source photos. The UI proxies these through /api/photo-proxy so the source server sees the right User-Agent and CORS works.';
COMMENT ON COLUMN import_records.photos_fetched_at IS 'When the photo URLs were last refreshed. Null = never; old = candidate for re-fetch.';

CREATE INDEX IF NOT EXISTS idx_import_records_photos_fetched
  ON import_records(photos_fetched_at)
  WHERE photos_fetched_at IS NULL;
