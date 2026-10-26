# CLAUDE.md — src/pdf/ (reports)

## Purpose

Renders a completed symptom-check session into a downloadable PDF medical report, and (via the
route documented below) serves that PDF to a bearer-token caller who owns the session.

## Key files

- `report-generator.ts` — `generateMedicalReport(data: ReportData): Promise<string>` (base64 PDF
  bytes). Hand-drawn `pdf-lib` layout: header bar, disclaimer strip, urgency-colored banner,
  primary-complaint / associated-symptoms / medical-history / possible-conditions /
  recommended-action sections, footer disclaimer, plus local `drawSection`/`drawLine`/`drawWrapped`
  helpers.
- `../tools/generate-report.ts` — the `generate_medical_report` MCP tool. Fetches the completed
  `symptom_sessions` row and calls `generateMedicalReport`. Gated by the team allowlist
  (`../lib/team-allowlist.ts`) at the `registerTool` layer in `../register/tools.ts`.
- `../routes/app-routes.ts` — `GET /reports/:session_id.pdf`, **the report endpoint**: calls
  `generateReport(sessionId)` (which calls into this folder) after its own auth/ownership checks.

## Data flow in/out

- **In:** a completed `symptom_sessions` row (`answers` + `assessment` JSONB, both populated by
  `../tools/symptom-checker.ts` once `done:true`).
- **Out:** a base64-encoded PDF, returned to the MCP tool caller as text (with a download URL)
  or streamed directly as `application/pdf` by the `/reports/:session_id.pdf` route.

## Rules

- **Human-review-only.** Treat any change to the generated report's content or layout as
  patient-facing; show the diff and require tests before merging.
- The endpoint's auth model (not this folder's own code, but critical context for anyone editing
  here) requires, in order: a valid non-revoked bearer token, team-allowlist membership
  (`../lib/team-allowlist.ts`), and `symptom_sessions.user_id === caller.sub`. **Every failure —
  no token, invalid/expired/revoked token, valid-but-non-team token, valid team token for
  someone else's session, or a session that doesn't exist — returns the exact same `404` with no
  distinguishing detail.** Never add a different status code or error message to any one of
  these paths; that would let a caller probe which session IDs exist or whose they are.
- A `symptom_sessions` row with `user_id IS NULL` (pre-existing row, created before the
  ownership migration) is owned by nobody — it must never be served to anybody via this
  endpoint, not treated as "public."

## How to test

- `node --env-file=.env e2e-disabled-tools.mjs [base-url]` — covers all the 404 cases above and
  the one 200 (owner, team member, valid token) case for `GET /reports/:session_id.pdf`.
- No fixture/visual test exists for the rendered PDF's layout itself — review a layout change by
  completing a symptom-check session end-to-end and opening the generated file.

## Maintenance rule

Maintenance rule. Whenever you change code, config, commands, environment variables, data structures, routes, integrations or deployment in this repo, update this CLAUDE.md (and any linked folder CLAUDE.md or docs/ARCHITECTURE.md) in the same branch and commit, and update its "Last updated" line. Read this file and the relevant folder CLAUDE.md before opening source files, and open only what the task needs. If a change contradicts a frozen spec named here, stop and ask Michael first. Never leave these files describing code that no longer exists.

Last updated: 2026-10-26
