import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Strip sslmode from the connection string — SSL is controlled explicitly via
// the ssl option below. This avoids the pg-connection-string deprecation warning
// about 'require'/'prefer'/'verify-ca' being treated as 'verify-full'.
const dbUrl = new URL(process.env.DATABASE_URL);
dbUrl.searchParams.delete('sslmode');

export const db = new Pool({
  connectionString: dbUrl.toString(),
  ssl: { rejectUnauthorized: true },
  min: 2,
  max: 10,
  idleTimeoutMillis: 30_000,
});

// Neon serverless terminates idle connections. Without this listener Node.js
// treats the pool error event as unhandled and dumps the full client object.
db.on('error', (err) => {
  console.error('[db-pool] idle client error:', err.message);
});
