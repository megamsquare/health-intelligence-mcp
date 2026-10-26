// Standalone CLI entry for the migration runner — `npm run migrate`.
// Runs the same runMigrations() the server calls at startup, then exits.

import { runMigrations } from './run-migrations.js';
import { db } from './client.js';

try {
  await runMigrations();
  console.log('[migrate] done');
  await db.end();
  process.exit(0);
} catch (err) {
  console.error('[migrate] fatal:', err instanceof Error ? err.message : err);
  await db.end();
  process.exit(1);
}
