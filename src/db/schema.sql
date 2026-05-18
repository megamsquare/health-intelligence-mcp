-- Run once against your Neon database to set up the schema.
-- psql $DATABASE_URL -f src/db/schema.sql
--
-- Existing databases: run the migration block at the bottom of this file first.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS health_articles (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source        TEXT        NOT NULL CHECK (source IN ('WHO', 'CDC', 'NHS', 'OpenFDA', 'PubMed')),
  external_id   TEXT        NOT NULL,
  title         TEXT        NOT NULL,
  summary       TEXT,
  url           TEXT,
  published_at  TIMESTAMPTZ,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tags          TEXT[]      NOT NULL DEFAULT '{}',
  -- Stored tsvector: computed once at insert, reused by FTS queries and ts_rank.
  search_vector TSVECTOR    GENERATED ALWAYS AS
                  (to_tsvector('english', title || ' ' || COALESCE(summary, ''))) STORED,
  UNIQUE (source, external_id)
);

-- FTS index on the stored column (faster than a functional index).
CREATE INDEX IF NOT EXISTS health_articles_fts
  ON health_articles USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS health_articles_source_date
  ON health_articles (source, published_at DESC);

-- Speeds up tag-based filtering.
CREATE INDEX IF NOT EXISTS health_articles_tags
  ON health_articles USING GIN (tags);

CREATE TABLE IF NOT EXISTS symptom_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  current_step INTEGER     NOT NULL DEFAULT 0,
  answers      JSONB       NOT NULL DEFAULT '{}',
  assessment   JSONB
);

-- Partial index: only active (incomplete) sessions are queried mid-flow.
CREATE INDEX IF NOT EXISTS symptom_sessions_active
  ON symptom_sessions (id)
  WHERE completed_at IS NULL;

-- ─── Migration for existing databases ────────────────────────────────────────
-- Run this block once if health_articles already exists:
--
--   ALTER TABLE health_articles
--     ADD COLUMN IF NOT EXISTS search_vector TSVECTOR
--     GENERATED ALWAYS AS
--       (to_tsvector('english', title || ' ' || COALESCE(summary, ''))) STORED;
--
--   DROP INDEX IF EXISTS health_articles_fts;
--   CREATE INDEX IF NOT EXISTS health_articles_fts
--     ON health_articles USING GIN (search_vector);
--
--   CREATE INDEX IF NOT EXISTS health_articles_tags
--     ON health_articles USING GIN (tags);
--
--   CREATE INDEX IF NOT EXISTS symptom_sessions_active
--     ON symptom_sessions (id) WHERE completed_at IS NULL;
