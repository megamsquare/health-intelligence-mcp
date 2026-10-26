// Forward-only SQL migration runner.
//
// RULE: never add a migration file that drops data or rewrites existing rows
// (DROP TABLE/COLUMN, TRUNCATE, UPDATE/DELETE on existing rows, etc.) without
// explicit approval first. Every migration here must be additive and safe to
// re-run (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS style).
//
// Applies every *.sql file in migrations/ (repo root) that isn't yet recorded
// in schema_migrations, in filename order, each in its own transaction. Takes
// a Postgres advisory lock first so that multiple instances starting at once
// don't race to apply the same migration twice.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { db } from './client.js';

// Arbitrary but stable — only meaningful as a lock key shared by every
// instance of this app. Change it and old/new deploys would stop sharing a
// lock, not that it matters once no instance is left running the old value.
const MIGRATION_LOCK_ID = 847_291_004;

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

export async function runMigrations(): Promise<void> {
  const client = await db.connect();
  try {
    // The lock must be taken before anything else touches schema_migrations —
    // including its own bootstrap CREATE TABLE. Two instances racing on
    // "CREATE TABLE IF NOT EXISTS" concurrently can both pass the existence
    // check and then collide on Postgres's system catalogs (observed in
    // testing: "duplicate key value violates unique constraint
    // pg_type_typname_nsp_index"). The lock serializes that too.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version     TEXT PRIMARY KEY,
          applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);

      const { rows } = await client.query<{ version: string }>(
        'SELECT version FROM schema_migrations'
      );
      const applied = new Set(rows.map((r) => r.version));

      let files: string[];
      try {
        files = (await readdir(MIGRATIONS_DIR))
          .filter((f) => f.endsWith('.sql'))
          .sort();
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          console.log('[migrate] no migrations/ directory found — nothing to do');
          return;
        }
        throw err;
      }

      for (const version of files) {
        if (applied.has(version)) {
          console.log(`[migrate] skip ${version} (already applied)`);
          continue;
        }

        const sql = await readFile(path.join(MIGRATIONS_DIR, version), 'utf8');
        console.log(`[migrate] applying ${version}`);

        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query(
            'INSERT INTO schema_migrations (version) VALUES ($1)',
            [version]
          );
          await client.query('COMMIT');
          console.log(`[migrate] applied ${version}`);
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(
            `migration ${version} failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    }
  } finally {
    client.release();
  }
}
