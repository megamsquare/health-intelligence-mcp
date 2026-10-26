// Gates the symptom-checker / medical-report surface (start_symptom_check,
// answer_symptom_question, generate_medical_report, the PDF report endpoint,
// and the session/condition-detail MCP resources) to an internal team only,
// pending a real clinical/legal review of that surface.
//
// Fails closed: a missing, empty, or unreadable TEAM_ALLOWLIST refuses
// everyone, including the team itself. Never hard-code allowlist entries —
// this must stay driven by the TEAM_ALLOWLIST env var / Secret Manager value.

export interface TeamIdentity {
  sub?: string;
  email?: string;
}

interface ParsedAllowlist {
  exact: Set<string>;
  emailsLower: Set<string>;
}

function parseAllowlist(): ParsedAllowlist | null {
  const raw = process.env.TEAM_ALLOWLIST;
  if (!raw) return null;

  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) return null;

  return {
    exact: new Set(entries),
    emailsLower: new Set(entries.map((entry) => entry.toLowerCase())),
  };
}

export function isTeamMember(user: TeamIdentity | undefined | null): boolean {
  const allowlist = parseAllowlist();
  if (!allowlist || !user) return false;

  if (user.sub && allowlist.exact.has(user.sub)) return true;
  if (user.email && allowlist.emailsLower.has(user.email.toLowerCase())) return true;
  return false;
}

export function logGatedRefusal(entryPoint: string, user: TeamIdentity | undefined | null, reason: string): void {
  console.log(
    `[access-denied] entry=${entryPoint} user=${user?.sub ?? 'anonymous'} email=${user?.email ?? 'none'} reason=${reason} time=${new Date().toISOString()}`
  );
}
