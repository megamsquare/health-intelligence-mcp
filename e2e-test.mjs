/**
 * End-to-end test for the Health Intelligence MCP server.
 * Runs every tool in sequence against the live Render deployment.
 *
 * Usage: node e2e-test.mjs [base-url]
 * Default base URL: https://health-intelligence-mcp.onrender.com
 */

const BASE = process.argv[2] ?? 'https://health-intelligence-mcp.onrender.com';
const MCP = `${BASE}/mcp`;

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`✅ PASS  ${label}`);
  passed++;
}

function fail(label, reason) {
  console.log(`❌ FAIL  ${label} — ${reason}`);
  failed++;
}

async function mcpCall(method, params, id = 1) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const raw = await res.text();
  // SSE: pick the first `data:` line
  const dataLine = raw.split('\n').find(l => l.startsWith('data:'));
  if (!dataLine) throw new Error(`No data line in response:\n${raw.slice(0, 300)}`);
  const envelope = JSON.parse(dataLine.slice(5).trim());
  if (envelope.error) throw new Error(JSON.stringify(envelope.error));
  return envelope.result;
}

function toolText(result) {
  return result.content.find(c => c.type === 'text')?.text ?? '';
}

function toolJSON(result) {
  return JSON.parse(toolText(result));
}

// ── 1. Health check ──────────────────────────────────────────────────────────
console.log(`\nTarget: ${BASE}\n`);
try {
  const r = await fetch(`${BASE}/health`);
  const j = await r.json();
  if (j.status === 'ok') pass('health check');
  else fail('health check', `unexpected status: ${JSON.stringify(j)}`);
} catch (e) {
  fail('health check', e.message);
}

// ── 2. ingest_health_news ────────────────────────────────────────────────────
try {
  const result = await mcpCall('tools/call', {
    name: 'ingest_health_news',
    arguments: { sources: ['WHO', 'CDC', 'NHS', 'OpenFDA'] },
  });
  const j = toolJSON(result);
  if (typeof j.ingested === 'number' && typeof j.skipped_duplicates === 'number') {
    pass(`ingest_health_news — ingested ${j.ingested}, skipped ${j.skipped_duplicates}`);
  } else {
    fail('ingest_health_news', `unexpected shape: ${JSON.stringify(j)}`);
  }
} catch (e) {
  fail('ingest_health_news', e.message);
}

// ── 3. search_health_content ─────────────────────────────────────────────────
try {
  const result = await mcpCall('tools/call', {
    name: 'search_health_content',
    arguments: { query: 'fever', include_pubmed: false, limit: 5 },
  });
  const j = toolJSON(result);
  if (typeof j.total === 'number') {
    pass(`search_health_content — total ${j.total} results`);
  } else {
    fail('search_health_content', `unexpected shape: ${JSON.stringify(j)}`);
  }
} catch (e) {
  fail('search_health_content', e.message);
}

// ── 4. start_symptom_check ───────────────────────────────────────────────────
let sessionId;
try {
  const result = await mcpCall('tools/call', { name: 'start_symptom_check', arguments: {} });
  const j = toolJSON(result);
  if (j.session_id && j.step === 0 && j.total_steps === 6) {
    sessionId = j.session_id;
    pass(`start_symptom_check — session ${sessionId}`);
  } else {
    fail('start_symptom_check', `unexpected shape: ${JSON.stringify(j)}`);
  }
} catch (e) {
  fail('start_symptom_check', e.message);
}

if (!sessionId) {
  console.log('\n⚠ Cannot continue — no session ID. Skipping remaining tool tests.\n');
} else {
  // ── 5. answer step 0: primary symptom = Fever ──────────────────────────────
  try {
    const result = await mcpCall('tools/call', {
      name: 'answer_symptom_question',
      arguments: { session_id: sessionId, step: 0, answer: 'Fever' },
    });
    const j = toolJSON(result);
    if (j.done === false && j.step === 1) pass('answer step 0 (Fever)');
    else fail('answer step 0', `unexpected: ${JSON.stringify(j)}`);
  } catch (e) {
    fail('answer step 0', e.message);
  }

  // ── 6. answer step 1: duration ─────────────────────────────────────────────
  try {
    const result = await mcpCall('tools/call', {
      name: 'answer_symptom_question',
      arguments: { session_id: sessionId, step: 1, answer: '1-3 days' },
    });
    const j = toolJSON(result);
    if (j.done === false && j.step === 2) pass('answer step 1 (1-3 days)');
    else fail('answer step 1', `unexpected: ${JSON.stringify(j)}`);
  } catch (e) {
    fail('answer step 1', e.message);
  }

  // ── 7. answer step 2: severity ─────────────────────────────────────────────
  try {
    const result = await mcpCall('tools/call', {
      name: 'answer_symptom_question',
      arguments: { session_id: sessionId, step: 2, answer: 7 },
    });
    const j = toolJSON(result);
    if (j.done === false && j.step === 3) pass('answer step 2 (severity 7)');
    else fail('answer step 2', `unexpected: ${JSON.stringify(j)}`);
  } catch (e) {
    fail('answer step 2', e.message);
  }

  // ── 8. answer step 3: associated symptoms ──────────────────────────────────
  try {
    const result = await mcpCall('tools/call', {
      name: 'answer_symptom_question',
      arguments: {
        session_id: sessionId,
        step: 3,
        answer: {
          unusual_fatigue: true,
          fever: false,
          chills: false,
          night_sweats: false,
          nausea: false,
          vomiting: false,
          diarrhea: false,
          rash: false,
          swollen_lymph_nodes: false,
          joint_pain: false,
        },
      },
    });
    const j = toolJSON(result);
    if (j.done === false && j.step === 4) pass('answer step 3 (associated symptoms)');
    else fail('answer step 3', `unexpected: ${JSON.stringify(j)}`);
  } catch (e) {
    fail('answer step 3', e.message);
  }

  // ── 9. answer step 4: medical history ──────────────────────────────────────
  try {
    const result = await mcpCall('tools/call', {
      name: 'answer_symptom_question',
      arguments: {
        session_id: sessionId,
        step: 4,
        answer: {
          diabetes: false,
          heart_disease: false,
          hypertension: false,
          asthma: false,
          immunocompromised: false,
          pregnant: false,
        },
      },
    });
    const j = toolJSON(result);
    if (j.done === false && j.step === 5) pass('answer step 4 (medical history)');
    else fail('answer step 4', `unexpected: ${JSON.stringify(j)}`);
  } catch (e) {
    fail('answer step 4', e.message);
  }

  // ── 10. answer step 5: emergency flags (final) ─────────────────────────────
  try {
    const result = await mcpCall('tools/call', {
      name: 'answer_symptom_question',
      arguments: {
        session_id: sessionId,
        step: 5,
        answer: {
          crushing_chest_pain: false,
          difficulty_breathing: false,
          loss_of_consciousness: false,
          sudden_severe_headache: false,
          facial_drooping: false,
          uncontrolled_bleeding: false,
        },
      },
    });
    const j = toolJSON(result);
    const a = j.assessment;
    if (j.done === true && a?.urgency) {
      pass(`answer step 5 (final) — urgency: ${a.urgency}`);
    } else {
      fail('answer step 5', `unexpected: ${JSON.stringify(j).slice(0, 200)}`);
    }
  } catch (e) {
    fail('answer step 5', e.message);
  }

  // ── 11. find_specialists ───────────────────────────────────────────────────
  try {
    const result = await mcpCall('tools/call', {
      name: 'find_specialists',
      arguments: { location: 'Lagos, Nigeria', specialty: 'infectious disease', radius_km: 20 },
    });
    const j = toolJSON(result);
    if (Array.isArray(j) && j.length > 0 && j[0].name) {
      pass(`find_specialists — ${j.length} results, nearest: "${j[0].name}"`);
    } else if (Array.isArray(j) && j.length === 0) {
      pass('find_specialists — 0 results (Maps coverage may be limited in this region)');
    } else {
      fail('find_specialists', `unexpected shape: ${JSON.stringify(j).slice(0, 200)}`);
    }
  } catch (e) {
    fail('find_specialists', e.message);
  }

  // ── 12. generate_medical_report ────────────────────────────────────────────
  try {
    const result = await mcpCall('tools/call', {
      name: 'generate_medical_report',
      arguments: { session_id: sessionId },
    });
    const resource = result.content.find(c => c.type === 'resource');
    const blob = resource?.resource?.blob ?? '';
    if (blob.startsWith('JVBERi0')) {
      pass(`generate_medical_report — PDF blob ${blob.length} chars (starts with PDF magic bytes)`);
    } else {
      fail('generate_medical_report', `blob missing or wrong: ${blob.slice(0, 30)}`);
    }
  } catch (e) {
    fail('generate_medical_report', e.message);
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(55)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('All tests passed ✅');
} else {
  console.log('Some tests failed — see ❌ lines above.');
  process.exit(1);
}
