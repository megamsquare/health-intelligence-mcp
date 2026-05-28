-- Run once against your Neon database to set up the schema.
-- psql $DATABASE_URL -f src/db/schema.sql
--
-- Existing databases: run the migration block at the bottom of this file first.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS health_articles (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source        TEXT        NOT NULL CHECK (source IN ('WHO', 'CDC', 'NHS', 'OpenFDA', 'PubMed', 'ECDC', 'PAHO', 'AfricaCDC', 'Upload')),
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

-- ─── Plan tiers ──────────────────────────────────────────────────────────────
-- Admin-configurable limits per plan name.
-- max_duration_days NULL = permanent (free tier never expires).

CREATE TABLE IF NOT EXISTS plan_tiers (
  name             TEXT  PRIMARY KEY,
  calls_per_day    INT   NOT NULL,
  sessions_per_day INT   NOT NULL,
  max_duration_days INT              -- NULL = unlimited / permanent
);

-- Default free tier — very limited, permanent.
INSERT INTO plan_tiers (name, calls_per_day, sessions_per_day, max_duration_days)
VALUES ('free', 10, 2, NULL)
ON CONFLICT (name) DO NOTHING;

-- ─── API keys, organisations, subscriptions, usage ───────────────────────────

CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT        NOT NULL,
  org_id       TEXT,
  key_hash     TEXT        NOT NULL UNIQUE,
  key_prefix   TEXT        NOT NULL,
  name         TEXT        NOT NULL,
  revoked      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_keys_user_id ON api_keys (user_id);
CREATE INDEX IF NOT EXISTS api_keys_org_id  ON api_keys (org_id) WHERE org_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS organizations (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  owner_id   TEXT        NOT NULL,
  plan       TEXT        NOT NULL,
  seat_limit INT         NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS organizations_owner_id ON organizations (owner_id);

CREATE TABLE IF NOT EXISTS org_members (
  org_id    UUID        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id   TEXT        NOT NULL,
  role      TEXT        NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, user_id)
);

-- Reverse lookup: all orgs a user belongs to.
CREATE INDEX IF NOT EXISTS org_members_user_id ON org_members (user_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT        NOT NULL,
  org_id           UUID        REFERENCES organizations (id) ON DELETE SET NULL,
  plan             TEXT        NOT NULL,
  status           TEXT        NOT NULL,
  calls_per_day    INT         NOT NULL,
  sessions_per_day INT         NOT NULL,
  expires_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS subscriptions_user_id ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS subscriptions_org_id  ON subscriptions (org_id) WHERE org_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS usage_log (
  id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   TEXT        NOT NULL,
  tool_name TEXT        NOT NULL,
  called_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Supports per-user rate-limit window queries (WHERE user_id = ? AND called_at > ?).
CREATE INDEX IF NOT EXISTS usage_log_user_time ON usage_log (user_id, called_at DESC);
-- Supports per-tool analytics aggregations.
CREATE INDEX IF NOT EXISTS usage_log_tool_time ON usage_log (tool_name, called_at DESC);

-- ─── Migration: add plan_tiers + free org subscriptions ──────────────────────
-- Run once on existing databases:
--
--   CREATE TABLE IF NOT EXISTS plan_tiers (
--     name TEXT PRIMARY KEY,
--     calls_per_day INT NOT NULL,
--     sessions_per_day INT NOT NULL,
--     max_duration_days INT
--   );
--   INSERT INTO plan_tiers (name, calls_per_day, sessions_per_day, max_duration_days)
--   VALUES ('free', 10, 2, NULL) ON CONFLICT DO NOTHING;

-- ─── Migration: add Upload source ─────────────────────────────────────────────
-- Run once on existing databases to allow doctor document uploads:
--
--   ALTER TABLE health_articles
--     DROP CONSTRAINT IF EXISTS health_articles_source_check;
--   ALTER TABLE health_articles
--     ADD CONSTRAINT health_articles_source_check
--     CHECK (source IN ('WHO','CDC','NHS','OpenFDA','PubMed','ECDC','PAHO','AfricaCDC','Upload'));

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
