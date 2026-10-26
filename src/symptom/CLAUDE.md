# CLAUDE.md — src/symptom/

## Purpose

The rule-based symptom-triage engine. Pure TypeScript logic, no I/O, no database or network
calls — it takes answer data in and returns a structured assessment out. This is the clinical
decision logic behind `start_symptom_check` / `answer_symptom_question` / `generate_medical_report`.

## Key files

- `questions.ts` — the fixed 6-step question set (`QUESTIONS`, `TOTAL_STEPS`) and
  `formatQuestion()`, which renders a question (enum / integer / flat-booleans) as text for the
  MCP client.
- `assessment.ts` — `generateAssessment(answers)`, ~265 lines. Emergency-flag override first,
  then per-`primary_symptom` branches (chest pain, headache, shortness of breath, fever, default),
  plus region risk `Set`s (`HIGH_MALARIA`, `MODERATE_MALARIA`, `HIGH_DENGUE`, `HIGH_TYPHOID`) keyed
  by lower-cased country name, used only when `primary_symptom === 'Fever'`.

## Data flow in/out

- **In:** an `Answers` object assembled by `../tools/symptom-checker.ts` from the
  `symptom_sessions.answers` JSONB column (accumulated one step at a time across calls to
  `answer_symptom_question`).
- **Out:** an `Assessment` (`urgency`, `urgency_message`, `likely_conditions[]`,
  `recommended_action`, `disclaimer`). The caller (`../tools/symptom-checker.ts`) enriches
  `likely_conditions[]` with ICD-11 codes (`../services/icd11.ts`) and article citations
  (`../tools/search-health-content.ts`) — **this folder does not call either of those itself.**
  The enriched result is persisted to `symptom_sessions.assessment` and later rendered by
  `../pdf/report-generator.ts`.

## Rules

- **Human-review-only.** Any edit here changes patient-facing medical guidance. Show the diff
  and get Michael's sign-off before merging; new logic needs tests, no exceptions unless waived.
- Never remove or weaken the `DISCLAIMER` string or the emergency-flag override — it must stay
  the first check in `generateAssessment`.
- Never make this produce a diagnosis — informational urgency assessment only.
- Adding a country to a region's risk set is a one-line, lower-case addition to the relevant
  `Set` in `assessment.ts` — don't restructure the branching around it without review.
- This is explicitly rule-based "not a design oversight" per `VISION.md` — an ML upgrade is a
  future roadmap idea, not a current bug to silently patch.

## How to test

No unit tests exist for this folder specifically (zero automated test coverage). Exercise it via:
- `node e2e-test.mjs [base-url]` — full tool run including a complete symptom-check flow.
- Manually: call `start_symptom_check` then `answer_symptom_question` through the MCP Inspector
  or a client, using a caller whose JWT `sub`/email is in `TEAM_ALLOWLIST` (these tools are
  gated — see `../lib/team-allowlist.ts` and `../middleware/CLAUDE.md`).

## Maintenance rule

Maintenance rule. Whenever you change code, config, commands, environment variables, data structures, routes, integrations or deployment in this repo, update this CLAUDE.md (and any linked folder CLAUDE.md or docs/ARCHITECTURE.md) in the same branch and commit, and update its "Last updated" line. Read this file and the relevant folder CLAUDE.md before opening source files, and open only what the task needs. If a change contradicts a frozen spec named here, stop and ask Michael first. Never leave these files describing code that no longer exists.

Last updated: 2026-10-26
