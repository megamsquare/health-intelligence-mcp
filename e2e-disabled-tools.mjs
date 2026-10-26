/**
 * E2E test for the public symptom-tool shutoff (fix/disable-public-symptom-tools).
 *
 * Covers:
 *  - tools/list hides start_symptom_check, answer_symptom_question, and
 *    generate_medical_report for a non-team caller, and shows them for a team caller.
 *  - tools/call on each of those three is refused ("This tool is not available.")
 *    for a non-team caller, and succeeds for a team caller.
 *  - GET /reports/:session_id.pdf returns 404 for: no token, a non-team token,
 *    and a team token that doesn't own the session — and 200 for the owner.
 *
 * This does NOT cover the "missing TEAM_ALLOWLIST refuses everyone" case —
 * that's a startup-config condition, not something an HTTP client can flip on
 * a running server. See test-team-allowlist.mjs for that (no server needed).
 *
 * Setup: before running, start the server with SHARED_SECRET set and with
 *   TEAM_ALLOWLIST=e2e-team-user-1,e2e-team-user-2
 * (plus any real team entries you also want — this script only requires those
 * two exact sub values to be present; it does not require them to be the only
 * ones). Do NOT include "e2e-outsider-user" in TEAM_ALLOWLIST — this script
 * relies on that sub being refused.
 *
 * Usage: node --env-file=.env e2e-disabled-tools.mjs [base-url]
 * Default base URL: http://localhost:3000
 */

import { createHmac, randomUUID } from 'node:crypto';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const MCP = `${BASE}/mcp`;

const SHARED_SECRET = process.env.SHARED_SECRET;
if (!SHARED_SECRET) throw new Error('SHARED_SECRET not set — run with: node --env-file=.env e2e-disabled-tools.mjs');

let passed = 0;
let failed = 0;

function pass(label) { console.log(`  ✅ PASS  ${label}`); passed++; }
function fail(label, reason) { console.log(`  ❌ FAIL  ${label} — ${reason}`); failed++; }

// ── JWT helpers (mirrors e2e-auth.mjs) ─────────────────────────────────────────

function b64url(str) { return Buffer.from(str).toString('base64url'); }

function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function makeToken(sub, extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    { sub, jti: randomUUID(), tier: 'personal', calls_per_day: 1000, sessions_per_day: 1000, iat: now, exp: now + 3600, ...extra },
    SHARED_SECRET
  );
}

const TEAM_TOKEN = makeToken('e2e-team-user-1');
const TEAM_TOKEN_2 = makeToken('e2e-team-user-2');
const OUTSIDER_TOKEN = makeToken('e2e-outsider-user');

// ── MCP helpers ────────────────────────────────────────────────────────────────

async function mcpRaw(token, method, params) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const raw = await res.text();
  if (res.status !== 200) return { httpStatus: res.status, raw };
  const dataLine = raw.split('\n').find((l) => l.startsWith('data:'));
  if (!dataLine) return { httpStatus: 200, raw };
  const envelope = JSON.parse(dataLine.slice(5).trim());
  return { httpStatus: 200, envelope };
}

async function toolsList(token) {
  const { envelope } = await mcpRaw(token, 'tools/list', {});
  return (envelope?.result?.tools ?? []).map((t) => t.name);
}

async function toolCall(token, name, args) {
  const { envelope } = await mcpRaw(token, 'tools/call', { name, arguments: args });
  if (envelope?.error) return { isError: true, text: JSON.stringify(envelope.error) };
  const content = envelope?.result?.content ?? [];
  const text = content.find((c) => c.type === 'text')?.text ?? '';
  return { isError: envelope?.result?.isError === true, text };
}

const GATED_TOOLS = ['start_symptom_check', 'answer_symptom_question', 'generate_medical_report'];

console.log(`\nTarget: ${BASE}\n`);

// ── 1. tools/list hides the gated tools for a non-team caller ────────────────

console.log('1 — tools/list visibility:');
{
  const outsiderList = await toolsList(OUTSIDER_TOKEN);
  const missing = GATED_TOOLS.filter((t) => !outsiderList.includes(t));
  if (missing.length === GATED_TOOLS.length) {
    pass('tools/list (outsider) hides all 3 gated tools');
  } else {
    fail('tools/list (outsider)', `expected all 3 hidden, still saw: ${GATED_TOOLS.filter((t) => outsiderList.includes(t)).join(', ') || 'none missing?!'}`);
  }

  const teamList = await toolsList(TEAM_TOKEN);
  const shown = GATED_TOOLS.filter((t) => teamList.includes(t));
  if (shown.length === GATED_TOOLS.length) {
    pass('tools/list (team) shows all 3 gated tools');
  } else {
    fail('tools/list (team)', `expected all 3 shown, missing: ${GATED_TOOLS.filter((t) => !teamList.includes(t)).join(', ')}`);
  }
}

// ── 2. tools/call refuses a non-team caller on each gated tool ───────────────

console.log('\n2 — tools/call refusal for non-team caller:');
{
  const argsByTool = {
    start_symptom_check: { country: 'Nigeria' },
    answer_symptom_question: { session_id: randomUUID(), step: 0, answer: 'Fever' },
    generate_medical_report: { session_id: randomUUID() },
  };
  for (const tool of GATED_TOOLS) {
    const r = await toolCall(OUTSIDER_TOKEN, tool, argsByTool[tool]);
    if (r.isError && r.text === 'This tool is not available.') {
      pass(`${tool} (outsider) → refused with exact message`);
    } else {
      fail(`${tool} (outsider)`, `expected isError + "This tool is not available.", got isError=${r.isError} text=${JSON.stringify(r.text)}`);
    }
  }
}

// ── 3. tools/call succeeds for a team caller — drive a full session ──────────

console.log('\n3 — tools/call success for team caller (full session walk):');
let sessionId;
{
  const start = await toolCall(TEAM_TOKEN, 'start_symptom_check', { country: 'Nigeria' });
  try {
    const j = JSON.parse(start.text);
    if (!start.isError && j.session_id) { sessionId = j.session_id; pass(`start_symptom_check (team) → session ${sessionId}`); }
    else fail('start_symptom_check (team)', `unexpected: ${start.text}`);
  } catch { fail('start_symptom_check (team)', `non-JSON response: ${start.text}`); }
}

const answers = [
  { step: 0, answer: 'Fever' },
  { step: 1, answer: '1-3 days' },
  { step: 2, answer: 7 },
  { step: 3, answer: { unusual_fatigue: true, fever: false, chills: false, night_sweats: false, nausea: false, vomiting: false, diarrhea: false, rash: false, swollen_lymph_nodes: false, joint_pain: false } },
  { step: 4, answer: { diabetes: false, heart_disease: false, hypertension: false, asthma: false, immunocompromised: false, pregnant: false } },
  { step: 5, answer: { crushing_chest_pain: false, difficulty_breathing: false, loss_of_consciousness: false, sudden_severe_headache: false, facial_drooping: false, uncontrolled_bleeding: false } },
];

let sessionDone = false;
if (sessionId) {
  for (const { step, answer } of answers) {
    const r = await toolCall(TEAM_TOKEN, 'answer_symptom_question', { session_id: sessionId, step, answer });
    try {
      const j = JSON.parse(r.text);
      if (r.isError) { fail(`answer_symptom_question step ${step}`, r.text); break; }
      if (j.done === true) { sessionDone = true; pass(`answer_symptom_question step ${step} (final) → done, urgency=${j.assessment?.urgency}`); break; }
      pass(`answer_symptom_question step ${step} → next step ${j.step}`);
    } catch { fail(`answer_symptom_question step ${step}`, `non-JSON: ${r.text}`); break; }
  }
}

if (sessionDone) {
  const r = await toolCall(TEAM_TOKEN, 'generate_medical_report', { session_id: sessionId });
  if (!r.isError && r.text.includes('.pdf')) pass('generate_medical_report (team) → download link returned');
  else fail('generate_medical_report (team)', r.text);
} else {
  fail('generate_medical_report (team)', 'skipped — session never reached done:true');
}

// ── 4. GET /reports/:session_id.pdf ───────────────────────────────────────────

console.log('\n4 — report PDF endpoint:');
if (sessionId) {
  const reportUrl = `${BASE}/reports/${sessionId}.pdf`;

  {
    const res = await fetch(reportUrl);
    if (res.status === 404) pass('GET /reports/:id.pdf with no token → 404');
    else fail('no-token', `expected 404, got ${res.status}`);
  }
  {
    const res = await fetch(reportUrl, { headers: { Authorization: `Bearer ${OUTSIDER_TOKEN}` } });
    if (res.status === 404) pass('GET /reports/:id.pdf with a non-team token → 404');
    else fail('non-team-token', `expected 404, got ${res.status}`);
  }
  {
    const res = await fetch(reportUrl, { headers: { Authorization: `Bearer ${TEAM_TOKEN_2}` } });
    if (res.status === 404) pass('GET /reports/:id.pdf with another team member\'s token → 404');
    else fail('other-team-member-token', `expected 404, got ${res.status}`);
  }
  {
    const res = await fetch(reportUrl, { headers: { Authorization: `Bearer ${TEAM_TOKEN}` } });
    if (res.status === 200 && res.headers.get('content-type') === 'application/pdf') pass("GET /reports/:id.pdf with the owner's team token → 200 PDF");
    else fail('owner-token', `expected 200 application/pdf, got ${res.status} ${res.headers.get('content-type')}`);
  }
} else {
  fail('report PDF endpoint', 'skipped — no session_id from step 3');
}

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(55)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('All disabled-tools tests passed ✅');
} else {
  console.log('Some tests failed — see ❌ lines above.');
  process.exit(1);
}
