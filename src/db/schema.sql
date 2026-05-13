-- Run once against your Neon database to set up the schema.
-- psql $DATABASE_URL -f src/db/schema.sql

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS health_articles (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source       TEXT        NOT NULL CHECK (source IN ('WHO', 'CDC', 'NHS', 'OpenFDA', 'PubMed')),
  external_id  TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  summary      TEXT,
  url          TEXT,
  published_at TIMESTAMPTZ,
  ingested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tags         TEXT[]      NOT NULL DEFAULT '{}',
  UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS health_articles_fts
  ON health_articles
  USING GIN (to_tsvector('english', title || ' ' || COALESCE(summary, '')));

CREATE INDEX IF NOT EXISTS health_articles_source_date
  ON health_articles (source, published_at DESC);

CREATE TABLE IF NOT EXISTS symptom_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  current_step INTEGER     NOT NULL DEFAULT 0,
  answers      JSONB       NOT NULL DEFAULT '{}',
  assessment   JSONB
);
