/**
 * Unit check for the fail-closed TEAM_ALLOWLIST behavior — no server, no DB.
 * Covers the one case e2e-disabled-tools.mjs can't: a missing/empty allowlist
 * must refuse EVERYONE, including would-be team members, not just outsiders.
 *
 * Usage: node --import=tsx/esm test-team-allowlist.mjs
 */

let passed = 0;
let failed = 0;

function pass(label) { console.log(`  ✅ PASS  ${label}`); passed++; }
function fail(label, reason) { console.log(`  ❌ FAIL  ${label} — ${reason}`); failed++; }

async function freshIsTeamMember() {
  // Re-import with a cache-busting query param so each case's env change is
  // actually picked up (parseAllowlist() itself re-reads process.env on every
  // call, so this isn't strictly required, but it keeps this test honest even
  // if that implementation detail ever changes).
  const mod = await import(`./src/lib/team-allowlist.ts?t=${Date.now()}-${Math.random()}`);
  return mod.isTeamMember;
}

console.log('\nteam-allowlist fail-closed behavior:\n');

// ── 1. Unset entirely ─────────────────────────────────────────────────────────
delete process.env.TEAM_ALLOWLIST;
{
  const isTeamMember = await freshIsTeamMember();
  if (isTeamMember({ sub: 'anyone' }) === false && isTeamMember({ sub: 'alice', email: 'alice@example.com' }) === false) {
    pass('TEAM_ALLOWLIST unset → refuses everyone, including a plausible team member');
  } else {
    fail('unset allowlist', 'expected false for all callers');
  }
}

// ── 2. Set to an empty string ─────────────────────────────────────────────────
process.env.TEAM_ALLOWLIST = '';
{
  const isTeamMember = await freshIsTeamMember();
  if (isTeamMember({ sub: 'alice' }) === false) pass('TEAM_ALLOWLIST="" → refuses everyone');
  else fail('empty-string allowlist', 'expected false');
}

// ── 3. Set to whitespace/commas only ─────────────────────────────────────────
process.env.TEAM_ALLOWLIST = ' , , ';
{
  const isTeamMember = await freshIsTeamMember();
  if (isTeamMember({ sub: 'alice' }) === false) pass('TEAM_ALLOWLIST=" , , " (no real entries) → refuses everyone');
  else fail('whitespace-only allowlist', 'expected false');
}

// ── 4. Populated — exact sub match, case-insensitive email match, and a miss ─
process.env.TEAM_ALLOWLIST = 'alice-sub-123, Bob@Example.com';
{
  const isTeamMember = await freshIsTeamMember();
  if (isTeamMember({ sub: 'alice-sub-123' }) === true) pass('exact sub match → allowed');
  else fail('sub match', 'expected true for alice-sub-123');

  if (isTeamMember({ sub: 'someone-else', email: 'bob@example.com' }) === true) pass('case-insensitive email match → allowed');
  else fail('email match', 'expected true for bob@example.com against "Bob@Example.com"');

  if (isTeamMember({ sub: 'charlie', email: 'charlie@example.com' }) === false) pass('non-member → refused');
  else fail('non-member', 'expected false for charlie');

  if (isTeamMember(undefined) === false) pass('no user object → refused');
  else fail('undefined user', 'expected false');
}

console.log(`\n${'─'.repeat(55)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('All team-allowlist tests passed ✅');
} else {
  console.log('Some tests failed — see ❌ lines above.');
  process.exit(1);
}
