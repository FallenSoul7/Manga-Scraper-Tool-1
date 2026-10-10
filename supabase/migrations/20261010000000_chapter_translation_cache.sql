-- Shared page-translation cache. The key is derived from the actual compressed
-- image bytes, source/target language, and translation revision. Source metadata
-- is informational only; no source URLs, tokens, or image bytes are stored.
CREATE TABLE IF NOT EXISTS public.chapter_translations (
  cache_key           TEXT PRIMARY KEY CHECK (cache_key ~ '^[a-f0-9]{64}$'),
  image_sha256        TEXT NOT NULL CHECK (image_sha256 ~ '^[a-f0-9]{64}$'),
  translation_revision TEXT NOT NULL CHECK (char_length(translation_revision) <= 80),
  source_language     TEXT NOT NULL CHECK (char_length(source_language) <= 40),
  target_language     TEXT NOT NULL CHECK (char_length(target_language) <= 40),
  regions             JSONB NOT NULL CHECK (
    CASE WHEN jsonb_typeof(regions) = 'array'
      THEN jsonb_array_length(regions) BETWEEN 1 AND 80
      ELSE FALSE
    END
  ),
  provider            TEXT NOT NULL CHECK (char_length(provider) <= 100),
  source_id           TEXT CHECK (source_id IS NULL OR char_length(source_id) <= 128),
  chapter_id          TEXT CHECK (chapter_id IS NULL OR char_length(chapter_id) <= 256),
  page_index          INTEGER CHECK (page_index IS NULL OR page_index BETWEEN 0 AND 10000),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '180 days')
);

CREATE INDEX IF NOT EXISTS chapter_translations_expires_at_idx
  ON public.chapter_translations (expires_at);

CREATE INDEX IF NOT EXISTS chapter_translations_chapter_idx
  ON public.chapter_translations (source_id, chapter_id, page_index);

ALTER TABLE public.chapter_translations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chapter_translations FROM anon, authenticated;
GRANT ALL ON TABLE public.chapter_translations TO service_role;

COMMENT ON TABLE public.chapter_translations IS
  'Backend-written shared page translations; stores bounded OCR text/coordinates only, never page images or source URLs. Entries expire after 180 days.';

-- The browser can request one known cache key but cannot enumerate or read the
-- table directly. The function returns only overlay data for a live cache item.
CREATE OR REPLACE FUNCTION public.get_chapter_translation_cache(p_cache_key TEXT)
RETURNS TABLE (regions JSONB, provider TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT cache.regions, cache.provider
  FROM public.chapter_translations AS cache
  WHERE cache.cache_key = p_cache_key
    AND cache.expires_at > NOW()
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_chapter_translation_cache(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chapter_translation_cache(TEXT) TO anon, authenticated;

-- Backend-only, bounded cleanup; invoked at most once per day per API process.
CREATE OR REPLACE FUNCTION public.prune_expired_chapter_translations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  removed INTEGER;
BEGIN
  DELETE FROM public.chapter_translations
  WHERE ctid IN (
    SELECT expired.ctid
    FROM public.chapter_translations AS expired
    WHERE expired.expires_at <= NOW()
    ORDER BY expired.expires_at
    LIMIT 500
  );
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_expired_chapter_translations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_expired_chapter_translations() TO service_role;
