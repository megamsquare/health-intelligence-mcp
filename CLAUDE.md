# CLAUDE.md — health-mcp

## What this repo is

A remote MCP server, **"Health Intelligence MCP,"** over Streamable HTTP at `/mcp`. Gives an
LLM client seven tools: health-news ingestion (WHO/CDC/UKHSA/OpenFDA/ECDC/PAHO/Africa CDC),
full-text + PubMed search, a rule-based region-aware symptom checker (malaria/dengue/typhoid +
ICD-11), nearby-specialist lookup, doctor-document ingestion, and PDF medical-report generation.
Also runs its own JWT/billing layer (API keys, orgs, plan tiers, usage logging).

**Live service:** Render, `health-intelligence-mcp`, `https://health-intelligence-mcp.onrender.com/mcp`.

Sibling to a separate NestJS backend ("backend-profile", not in this repo — issues the JWTs
this server validates) and a Next.js frontend.

## Status

**Dormant in git, LIVE in production.** Long gaps between commits, then same-day fixes just
merged to `main`. No staging, no CI gate — **treat every change as a production change.**

## Stack and versions

TypeScript `strict: true`, ES2022/NodeNext, Node 20 (Dockerfile `node:20-alpine`), npm. Key deps:
`@modelcontextprotocol/sdk` ^1.12.0, `express` ^4.21.2, `jsonwebtoken` ^9.0.3, `pg` ^8.13.3,
`zod` ^3.24.1, `pdf-lib` ^1.17.1, `pdf-parse` ^2.4.5, `mammoth` ^1.12.0, `multer` ^2.1.1; dev:
`tsx` ^4.19.2, `typescript` ^5.8.3. No ESLint/Prettier, no test framework, no CI.

## Commands (exact)

| Action | Command |
|---|---|
| Install | `npm ci` |
| Dev | `npm run dev` |
| Build | `npm run build` |
| Start | `npm start` |
| Migrate (standalone) | `npm run migrate` (also runs automatically at server startup) |
| e2e: allowlist + disabled tools | `node --env-file=.env e2e-disabled-tools.mjs [base-url]` |
| e2e: fail-closed allowlist (no server) | `node --import=tsx/esm test-team-allowlist.mjs` |
| e2e: full tool run | `node e2e-test.mjs [base-url]` |
| e2e: JWT/quota/revocation | `node --env-file=.env e2e-auth.mjs [base-url]` |
| Local DB | `docker-compose up` |

No `test`/`lint`/`typecheck` script; typechecking is implicit in `build`.

## Map

- `src/server.ts` — Express bootstrap; fresh `McpServer` per `/mcp` request; runs migrations before `listen()`.
- `src/routes/app-routes.ts` — `/mcp`, `/upload`, `/reports/:session_id.pdf`, `/health`, OAuth metadata. `revoke.ts`, `keys.ts`, `orgs.ts`, `usage.ts`, `admin.ts` — server-to-server/admin, gated by `x-server-secret`.
- `src/middleware/` — JWT verify, revocation, quotas. See **[src/middleware/CLAUDE.md](src/middleware/CLAUDE.md)**.
- `src/lib/team-allowlist.ts` — fail-closed gate (`TEAM_ALLOWLIST`) for the symptom/report surface. `src/cache/index.ts` — in-memory `AppCache`; `USE_REDIS` is a documented TODO, unimplemented.
- `src/tools/` — tool implementations (ingest-health-news, ingest-document, search-health-content, symptom-checker, generate-report).
- `src/symptom/` — triage rule engine. See **[src/symptom/CLAUDE.md](src/symptom/CLAUDE.md)**.
- `src/pdf/` — report rendering + endpoint. See **[src/pdf/CLAUDE.md](src/pdf/CLAUDE.md)**.
- `src/services/` — external clients (health-feeds, openfda, pubmed, google-maps, icd11, document-parser).
- `src/db/` — `client.ts`, `schema.sql`, `run-migrations.ts`, `migrate.ts`. `migrations/` — forward-only SQL, applied in filename order at startup.
- `src/register/` — wires tools/resources/prompts; `tools.ts` has the `gateTool()` allowlist wrapper. `src/resources/`, `src/prompts/` — MCP resource handlers and prompt builders.
- `scripts/generate-owner-token.ts` — generates the owner JWT; untracked/gitignored, stays that way.
- `docs/ARCHITECTURE.md` — longer architecture detail.

## Main flows

- Tool/resource/prompt call: `server.ts` → `routes/app-routes.ts` (`/mcp`) → `authMiddleware` →
  per-request `McpServer` → `register/*.ts` → `tools|resources|prompts/*`.
- Symptom check: `tools/symptom-checker.ts` → `symptom/questions.ts` + `assessment.ts` →
  enrichment via `services/icd11.ts` + `search-health-content.ts` → `symptom_sessions`.
- PDF report: `tools/generate-report.ts` → `pdf/report-generator.ts`; served by
  `GET /reports/:session_id.pdf` in `routes/app-routes.ts`.
- Startup migrations: `server.ts` → `db/run-migrations.ts` (advisory lock, `schema_migrations`);
  a failed migration `process.exit(1)`s, so Render keeps the previous deploy live.

## Data owned vs only read

**Owned (Postgres, `src/db/schema.sql`, sole writer/reader):** `health_articles`,
`symptom_sessions` (now has `user_id`), `plan_tiers`, `api_keys`, `organizations`,
`org_members`, `subscriptions`, `usage_log`, `schema_migrations`.

**Only read:** WHO/UKHSA/ECDC/PAHO/Africa CDC feeds, OpenFDA, PubMed, Google Maps, WHO ICD-11 API.

**Not owned at all:** JWTs — issued entirely by the external "backend-profile" backend.

## Integrations and other repos

| Dependency | How it's used |
|---|---|
| **backend-profile** (`/Users/megamsquare/Documents/Personal/health/backend-profile`, external NestJS) | Issues JWTs via `SHARED_SECRET`; calls back `POST /mcp/token/revoke`, `/internal/usage`, `/admin/reset-usage`, gated by `x-server-secret` = `SERVER_SECRET`. |
| WHO, UKHSA, ECDC, PAHO, Africa CDC | RSS/Atom, no key. |
| OpenFDA | optional `OPENFDA_API_KEY`. |
| PubMed (NCBI eutils) | optional `PUBMED_API_KEY`. |
| Google Maps | requires `GOOGLE_MAPS_API_KEY`. |
| WHO ICD-11 API | OAuth2 client-credentials, `ICD11_CLIENT_ID`/`ICD11_CLIENT_SECRET`; silently disabled if absent. |
| Render | Hosting, auto-deploy from `main`, health check `/health`. |
| Neon | Managed Postgres (`DATABASE_URL`). |

## Environment variable names

`DATABASE_URL`, `SHARED_SECRET`, `SERVER_SECRET`, `OWNER_TOKEN`, `TEAM_ALLOWLIST`,
`PUBMED_API_KEY`, `GOOGLE_MAPS_API_KEY`, `OPENFDA_API_KEY`, `USE_REDIS`, `PORT`, `NODE_ENV`,
`MCP_SERVER_URL`, `ICD11_CLIENT_ID`, `ICD11_CLIENT_SECRET`, `OWNER_EMAIL`. Names only, never
values. `SHARED_SECRET`/`SERVER_SECRET`/`DATABASE_URL` throw at module load if missing.

## Conventions

kebab-case filenames, one responsibility per file, `.js`-suffixed imports (NodeNext ESM). `zod`
validates MCP tool/prompt input; HTTP route bodies are checked by hand. Tool handlers return
`{ isError: true, ... }`; route handlers mostly let errors throw (bare 500). `console.log`/`error`
only, no structured logging. Config via `process.env`, fail-fast for the three required secrets.

## Guardrails

- Never open real `.env` files or write secret/credential values anywhere — names only, now and future.
- Work on a branch; show the diff and wait for Michael's "go" before commit/push/deploy. Never delete data or production resources.
- Don't fix unrelated bugs in-task — note them under Known issues instead. Cleanups (branches, dead code, logs, stale tests) only as separate, Michael-approved tasks.
- Roadmap files (README roadmap, `VISION.md`) are aspirational, not binding. The only frozen spec is CuraBeam v13.1, for gate/entitlement/access-control work only — see Spec index.
- New/changed code comes with tests unless Michael waives it for that task.
- Never ask for/read/use Michael's credentials. Deploys only via Michael merging to `main`; credential-needing steps are written up for Michael to run himself. Deploy: Render auto-deploy from `main`. Rollback: Render "Rollback".
- **Repo-specific:** dormant in git, live in prod — every change is a production change. The symptom-check/medical-report surface stays disabled outside `TEAM_ALLOWLIST` — a standing decision, not a gap to fix by re-enabling it. As of 26 Oct 2026 `TEAM_ALLOWLIST` is **not set** in Render production, so those tools are off for everyone including the team — intended until Michael sets it himself. `scripts/generate-owner-token.ts` stays untracked; Michael keeps its logic backed up in his own password manager, never in a repo.

## Human-review areas

`src/symptom/` (incl. `assessment.ts`) · token verification/revocation/quotas
(`src/middleware/auth.ts`, `src/routes/revoke.ts`, `src/cache/`, `src/lib/cache.ts`) ·
the report endpoint (`src/pdf/report-generator.ts`, `GET /reports/:session_id.pdf`).

## Known issues (record, don't fix without Michael's go-ahead)

- Token revocation and usage quotas are **in-memory only** — lost on restart/deploy/spin-down.
  v13.1 requires durable revocation (Firestore `revokedTokens`); a local cache may sit in front
  of it later but must never be the only copy. This migration is planned, but **no date is set**.
- `USE_REDIS` is documented but unimplemented — keep it a TODO, not a working toggle.
- Pre-existing `symptom_sessions` rows have `user_id = NULL` — owned by nobody, not everybody.
- No automated tests beyond manual e2e scripts; no CI. `scripts/generate-owner-token.ts` exists only on this machine.

## UNKNOWN / open questions

- ~~Exact repo location of "backend-profile"~~ — resolved: `/Users/megamsquare/Documents/Personal/health/backend-profile`. It's the JWT issuer, minting with `SHARED_SECRET` (see Integrations).
- ~~Whether `TEAM_ALLOWLIST` is currently set in Render's production env~~ — resolved: **not set, as of 26 Oct 2026.** The gated symptom/report tools are therefore off for everyone, including the team. This is intended, not a bug — stays this way until Michael sets `TEAM_ALLOWLIST` on Render himself.
- Timing/plan for migrating revocation/quota to the v13.1 durable model — partially resolved: it **is** planned (not just a hypothetical), but **no date** has been set.
- ~~Whether `generate-owner-token.ts`'s logic should be backed up somewhere safe~~ — resolved: it stays untracked/gitignored in this repo; Michael backs it up in his password manager, never in any repo.

## Spec index

CuraBeam v13.1 lives at `/Users/megamsquare/Documents/Personal/health/curabeam-spec/v13.1/` —
private, outside every deployed repo. Never copy its content into this repo; reference names/
sections only. **health-mcp is governed by v13.1 for gate/entitlement/access-control work only**
(team-allowlist gating, PDF/session ownership checks, future durable revocation):
`CuraBeam-TRD-V1.docx` §5A, and `sql/gate.sql`. Everything else here (triage logic, ingestion,
billing, `VISION.md`'s roadmap) is ordinary, non-binding documentation.

## Maintenance rule

Maintenance rule. Whenever you change code, config, commands, environment variables, data structures, routes, integrations or deployment in this repo, update this CLAUDE.md (and any linked folder CLAUDE.md or docs/ARCHITECTURE.md) in the same branch and commit, and update its "Last updated" line. Read this file and the relevant folder CLAUDE.md before opening source files, and open only what the task needs. If a change contradicts a frozen spec named here, stop and ask Michael first. Never leave these files describing code that no longer exists.

## Last updated

2026-10-26
