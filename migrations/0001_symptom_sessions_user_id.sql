-- Owner scoping for symptom_sessions, as part of fix/disable-public-symptom-tools.
-- Idempotent: safe to run against a database that already has this column
-- (e.g. one created from the current src/db/schema.sql).
-- Pre-existing rows get user_id = NULL — "nobody owns this", not "everybody".

ALTER TABLE symptom_sessions ADD COLUMN IF NOT EXISTS user_id TEXT;
CREATE INDEX IF NOT EXISTS symptom_sessions_user_id ON symptom_sessions (user_id) WHERE user_id IS NOT NULL;
