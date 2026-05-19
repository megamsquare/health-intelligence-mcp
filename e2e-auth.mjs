/**
 * Auth end-to-end test: JWT rate-limiting and token revocation.
 *
 * Usage: node --env-file=.env e2e-auth.mjs [base-url]
 * Default base URL: http://localhost:3000
 *
 * Steps
 *  1. Generate a test JWT (tier=personal, calls_per_day=5, unique jti)
 *  2. Call start_symptom_check → expect 200 success
 *  3. Call start_symptom_check 5 more times → calls 2-5 succeed, call 6 returns 429
 *  4. POST /mcp/token/revoke with jti + x-server-secret → expect 200
 *  5. Call start_symptom_check with same JWT → expect 401 (revoked)
 */

import { createHmac, randomUUID } from 'node:crypto';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const MCP  = `${BASE}/mcp`;

const SHARED_SECRET = process.env.SHARED_SECRET;
const SERVER_SECRET = process.env.SERVER_SECRET;
if (!SHARED_SECRET) throw new Error('SHARED_SECRET not set — run with: node --env-file=.env e2e-auth.mjs');
if (!SERVER_SECRET) throw new Error('SERVER_SECRET not set — run with: node --env-file=.env e2e-auth.mjs');

let passed = 0;
let failed = 0;

function pass(label) { console.log(`  ✅ PASS  ${label}`); passed++; }
function fail(label, reason) { console.log(`  ❌ FAIL  ${label} — ${reason}`); failed++; }

// ── JWT helpers ───────────────────────────────────────────────────────────────

function b64url(str) {
  return Buffer.from(str).toString('base64url');
}

function signJwt(payload, secret) {
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body    = b64url(JSON.stringify(payload));
  const sig     = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function mcpCall(token) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'start_symptom_check', arguments: {} },
    }),
  });

  const raw = await res.text();

  if (res.status !== 200) {
    let errBody;
    try { errBody = JSON.parse(raw); } catch { errBody = { error: raw.slice(0, 120) }; }
    return { httpStatus: res.status, error: errBody.error ?? raw.slice(0, 120) };
  }

  // Parse SSE envelope: first `data:` line carries the JSON-RPC response.
  const dataLine = raw.split('\n').find(l => l.startsWith('data:'));
  if (!dataLine) return { httpStatus: 200, error: `No data line — raw: ${raw.slice(0, 120)}` };

  const envelope = JSON.parse(dataLine.slice(5).trim());
  if (envelope.error) return { httpStatus: 200, error: JSON.stringify(envelope.error) };

  const text = envelope.result?.content?.find(c => c.type === 'text')?.text ?? '';
  let result;
  try { result = JSON.parse(text); } catch { result = text; }
  return { httpStatus: 200, result };
}

async function revokeToken(jti, exp) {
  const res = await fetch(`${BASE}/mcp/token/revoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-server-secret': SERVER_SECRET,
    },
    body: JSON.stringify({ jti, exp }),
  });
  return { httpStatus: res.status, body: await res.json() };
}

// ── Test token ────────────────────────────────────────────────────────────────

const now = Math.floor(Date.now() / 1000);
const jti = randomUUID();
const exp = now + 3600;

const token = signJwt({
  sub:              'e2e-test-user',
  jti,
  tier:             'personal',
  calls_per_day:    5,
  sessions_per_day: 10,
  iat:              now,
  exp,
}, SHARED_SECRET);

console.log(`\nTarget: ${BASE}`);
console.log(`JWT jti: ${jti}\n`);

// ── Step 2: first call succeeds ───────────────────────────────────────────────

console.log('Step 2 — first call should succeed:');
{
  const r = await mcpCall(token);
  if (r.httpStatus === 200 && r.result?.session_id) {
    pass(`start_symptom_check → 200, session_id=${r.result.session_id}`);
  } else {
    fail('start_symptom_check (call 1)', `status=${r.httpStatus} ${r.error ?? JSON.stringify(r.result)}`);
  }
}

// ── Step 3: calls 2-5 succeed, call 6 returns 429 ────────────────────────────

console.log('\nStep 3 — calls 2-5 succeed, call 6 returns 429:');
for (let i = 2; i <= 5; i++) {
  const r = await mcpCall(token);
  if (r.httpStatus === 200 && r.result?.session_id) {
    pass(`start_symptom_check (call ${i}) → 200`);
  } else {
    fail(`start_symptom_check (call ${i})`, `status=${r.httpStatus} ${r.error ?? ''}`);
  }
}
{
  const r = await mcpCall(token);
  if (r.httpStatus === 429) {
    pass(`start_symptom_check (call 6) → 429 Daily call limit exceeded`);
  } else {
    fail('start_symptom_check (call 6)', `expected 429, got ${r.httpStatus} ${r.error ?? JSON.stringify(r.result)}`);
  }
}

// ── Step 4: revoke token ──────────────────────────────────────────────────────

console.log('\nStep 4 — revoke token:');
{
  const r = await revokeToken(jti, exp);
  if (r.httpStatus === 200 && r.body?.message === 'token revoked') {
    pass(`POST /mcp/token/revoke → 200 "${r.body.message}"`);
  } else {
    fail('POST /mcp/token/revoke', `status=${r.httpStatus} body=${JSON.stringify(r.body)}`);
  }
}

// ── Step 5: revoked token returns 401 ────────────────────────────────────────

console.log('\nStep 5 — same JWT after revocation should return 401:');
{
  const r = await mcpCall(token);
  if (r.httpStatus === 401) {
    pass(`start_symptom_check → 401 Token has been revoked`);
  } else {
    fail('start_symptom_check (post-revoke)', `expected 401, got ${r.httpStatus} ${r.error ?? JSON.stringify(r.result)}`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(55)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('All auth tests passed ✅');
} else {
  console.log('Some tests failed — see ❌ lines above.');
  process.exit(1);
}
