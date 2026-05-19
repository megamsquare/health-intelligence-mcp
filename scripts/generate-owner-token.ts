import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;

const sharedSecret = process.env.SHARED_SECRET;
const ownerEmail = process.env.OWNER_EMAIL;
const databaseUrl = process.env.DATABASE_URL;

if (!sharedSecret) throw new Error('SHARED_SECRET is required in .env');
if (!ownerEmail) throw new Error('OWNER_EMAIL is required in .env');
if (!databaseUrl) throw new Error('DATABASE_URL is required in .env');

// Generate JWT — 3650-day owner token
const token = jwt.sign(
  {
    email: ownerEmail,
    tier: 'owner',
    calls_per_day: 999999,
    sessions_per_day: 999999,
    org_id: null,
  },
  sharedSecret,
  {
    algorithm: 'HS256',
    subject: 'owner-001',
    expiresIn: 3650 * 24 * 60 * 60,
    jwtid: 'owner-token-001',
  },
);

const keyHash = crypto.createHash('sha256').update(token).digest('hex');
const keyPrefix = token.slice(0, 8);

// Insert into Neon — skip silently if already exists
const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: true }, max: 1 });

await pool.query(
  `INSERT INTO api_keys (user_id, org_id, key_hash, key_prefix, name, revoked)
   VALUES ($1, $2, $3, $4, $5, $6)
   ON CONFLICT (key_hash) DO NOTHING`,
  ['owner-001', null, keyHash, keyPrefix, 'Owner Production Token', false],
);

await pool.end();

console.log('\n========================================');
console.log('  OWNER TOKEN — SAVE THIS NOW');
console.log('========================================');
console.log(token);
console.log('========================================\n');
console.log(`key_prefix : ${keyPrefix}`);
console.log(`key_hash   : ${keyHash}`);
console.log(`jti        : owner-token-001`);
console.log(`user_id    : owner-001`);
console.log(`expires    : 3650 days from now\n`);
