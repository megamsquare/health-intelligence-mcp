# Architecture — health-mcp

Longer architecture detail for the Health Intelligence MCP server. See the root
[CLAUDE.md](../CLAUDE.md) for the quick-reference version; this file goes deeper on the parts
that don't fit there.

## 1. Process model

`src/server.ts` creates **one Express app for the process's lifetime**, but builds a **fresh
`McpServer` instance per `/mcp` request** (see `createServer()`). This is intentional and
stateless — there is no server-side MCP session kept between requests; all state that needs to
survive a request lives in Postgres (`symptom_sessions`, etc.) or the in-memory cache
(revocation, quotas — see §4).

Startup order in `src/server.ts`:
1. Express app created, JSON body parser, request-timing logger middleware.
2. Server-to-server routers mounted: `revokeRouter`, `keysRouter`, `orgsRouter`, `usageRouter`,
   `adminRouter` — all gated by `x-server-secret`, not JWT.
3. `registerAppRoutes(app, createServer)` — mounts `/mcp`, `/upload`, `/reports/:id.pdf`,
   `/health`, the OAuth-metadata well-known endpoint.
4. `await runMigrations()` — **before** `app.listen()`. If this throws, the process calls
   `process.exit(1)` and never starts listening; Render's health check then fails and the
   previous deploy stays live (see §3).
5. `app.listen(PORT)`.

## 2. Request flow: `POST /mcp`

```
client ──Bearer JWT──▶ authMiddleware (src/middleware/auth.ts)
                         │  verify signature (SHARED_SECRET)
                         │  check jti against cache (mcp:revoked:{jti})
                         │  check/increment quota (mcp:usage:{sub}:{date})
                         ▼
                       Origin allow-list check (ALLOWED_ORIGINS, src/routes/app-routes.ts)
                         ▼
                       fire-and-forget usage_log insert
                         ▼
                       hideGatedToolsFromList = (method === 'tools/list' && !isTeamMember(user))
                         ▼
                       createServer({ user, hideGatedToolsFromList })
                         │  registerTools()   — src/register/tools.ts
                         │  registerResources()
                         │  registerPrompts()
                         ▼
                       StreamableHTTPServerTransport handles the request
```

`hideGatedToolsFromList` only controls what `tools/list` advertises. The real control is
`gateTool()` inside `src/register/tools.ts`, which runs `isTeamMember(ctx.user)` unconditionally
on every `tools/call`, independent of what was advertised. A client that already knows a gated
tool's name (e.g. from an old session) still gets refused at call time.

## 3. Database migrations

`src/db/run-migrations.ts` is a small forward-only runner:

1. Takes a Postgres advisory lock (`pg_advisory_lock`, fixed numeric key `847_291_004`) before
   touching anything — this prevents two instances starting concurrently (e.g. a Render deploy
   overlap) from racing on `CREATE TABLE IF NOT EXISTS schema_migrations` and colliding on
   Postgres system catalogs.
2. Ensures `schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ)` exists.
3. Reads `migrations/*.sql` (repo root), sorted by filename, skips any already recorded in
   `schema_migrations`.
4. Applies each remaining file in its own transaction; on success, records it in
   `schema_migrations`; on failure, rolls back and throws, which aborts the whole startup (see §1).
5. Releases the advisory lock.

**To add a migration:** create `migrations/00NN_description.sql` with the next sequential
number. Every migration must be additive and safe to re-run (`CREATE ... IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`, etc.) — the runner has no rollback/down migrations. **Never write a
migration that drops or rewrites existing data (`DROP TABLE`/`COLUMN`, `TRUNCATE`,
`UPDATE`/`DELETE` on existing rows) without Michael's explicit approval first.** Deploy by
merging to `main`; Render's `npm ci && npm run build` → `node dist/server.js` applies it at
startup automatically. The `Dockerfile`'s production stage also copies `migrations/` into the
image so this works in the containerized deploy, not just local/dev.

Current migrations: `migrations/0001_symptom_sessions_user_id.sql` — adds
`symptom_sessions.user_id TEXT` plus a partial index, idempotent, pre-existing rows get `NULL`.

## 4. Auth, revocation, and quotas

JWTs are HS256, signed by the external NestJS backend ("backend-profile") using `SHARED_SECRET`
— this repo has no login/token-issuance of its own. `src/middleware/auth.ts` verifies signature,
checks `jti` against an in-memory revocation set, and enforces `calls_per_day` (from JWT claims,
or a minimal free-tier fallback) via the same in-memory cache.

**Revocation write path:** `POST /mcp/token/revoke` (`src/routes/revoke.ts`), gated by
`x-server-secret` = `SERVER_SECRET`, writes `mcp:revoked:{jti}` with a TTL equal to the token's
remaining lifetime into `src/cache/index.ts`'s `AppCache`, backed by `src/lib/cache.ts`'s
`TtlCache` — a plain in-process `Map`.

**Known defect (recorded, not fixed here):** nothing is persisted to Postgres. A process
restart — deploy, crash, or a Render free-tier spin-down after 15 minutes idle — silently
un-revokes every previously revoked token and resets every user's daily quota early, because the
entire revocation/quota state lives in that one process's memory. CuraBeam v13.1 requires durable
revocation (a Firestore `revokedTokens` collection per the plan). Any local in-memory cache
introduced going forward must sit *in front of* that durable store as a fast path, never serve as
the only copy of revocation/quota state.

**Caching more broadly:** `USE_REDIS` is documented in `.env.example` and the README as a toggle
for Redis-backed rate limiting, but `src/cache/index.ts` never reads it and there is no Redis
client dependency — this is a documentation/code mismatch, kept as a TODO. Recommendation until
there are real users: keep the local in-process cache behind the existing `Cache` interface
(`src/cache/index.ts`) rather than building Redis support speculatively — swapping in
`ioredis` later is then a config change (implement `Cache`, swap the singleton), not a rewrite.

## 5. Team-allowlist gating (symptom-check / medical-report surface)

Added in the same-day pair of commits `fix: restrict symptom-check tools, PDF reports, and
session data to team allowlist` and `feat: apply database migrations automatically at startup`.

`src/lib/team-allowlist.ts` exports:
- `isTeamMember(user)` — reads `TEAM_ALLOWLIST` (comma-separated `sub` values and/or emails,
  case-insensitive on email) fresh from `process.env` on every call. **Fails closed**: if the
  variable is unset or empty, every caller is refused, including legitimate team members.
- `logGatedRefusal(entryPoint, user, reason)` — structured `console.log` line for every refusal.

Gated surfaces, and how each enforces it:
- **Tools** `start_symptom_check`, `answer_symptom_question`, `generate_medical_report`
  (`src/register/tools.ts`) — wrapped in `gateTool()`, which runs `isTeamMember()` before the
  real handler on every call, and returns a fixed `"This tool is not available."` message
  (never the real error) on refusal. Additionally hidden from `tools/list` for non-team callers
  via `.disable()`, called when `ctx.hideGatedToolsFromList` is true — cosmetic only, the real
  gate is `gateTool()`.
- **Resource** `health://conditions/{name}` (`src/register/resources.ts`) — gated because it
  leaks per-session identifiers (`session_id`, `primary_symptom`, `urgency`) across all users for
  a named condition.
- **Resource** `health://session/{id}` (`src/register/resources.ts`) — gated by team membership
  **and** session ownership (`session.user_id === ctx.user?.sub`). A session with `user_id IS
  NULL` (pre-existing row) is readable by nobody via this path, not by everybody.
- **Prompt** `pre-appointment-prep` (`src/prompts/pre-appointment-prep.ts`, wired through
  `src/register/prompts.ts`) — same team-membership gating when it looks up a session by id.
- **Endpoint** `GET /reports/:session_id.pdf` (`src/routes/app-routes.ts`) — requires a valid
  non-revoked token (`verifyBearerToken`), team membership, and `symptom_sessions.user_id ===
  caller.sub`. Every failure mode returns an identical `404 {"error":"Not found"}` so a caller
  cannot distinguish "wrong token" from "not on the team" from "not your session" from
  "session doesn't exist."

**This is a known, intentional decision, not a temporary gap:** the public symptom-check /
medical-report surface stays disabled for everyone outside `TEAM_ALLOWLIST` pending a real
clinical/legal review. Do not re-enable it for ordinary callers without that review and
Michael's explicit sign-off.

`symptom_sessions.user_id` (added by `migrations/0001_symptom_sessions_user_id.sql`) is the
ownership column backing all of the above. Pre-existing rows have `user_id = NULL` — treated as
"owned by nobody," never "owned by everybody" or "owned by the current caller."

## 6. Data model

Postgres is the single source of truth (`src/db/schema.sql`); this repo is the sole reader/writer
of every table below.

| Table | Rows represent | Notable |
|---|---|---|
| `health_articles` | Ingested news/alert/uploaded-doc items | `source` CHECK-constrained; generated `search_vector` TSVECTOR + GIN index; unique `(source, external_id)` |
| `symptom_sessions` | One symptom-check session | `user_id` added by migration 0001; pre-migration rows are `NULL` (unowned) |
| `plan_tiers` | Admin-defined quota tiers | Seeded with a permanent `free` tier |
| `api_keys` | Issued API keys (hashed) | Only `key_prefix` ever shown again after creation |
| `organizations` / `org_members` | Multi-user orgs | `org_members` composite PK `(org_id, user_id)` |
| `subscriptions` | Plan assignment per user/org | `expires_at` nullable (permanent) |
| `usage_log` | Append-only call log | Indexed for per-user time-window and per-tool queries |
| `schema_migrations` | Applied migration filenames | Written by `src/db/run-migrations.ts` |

No row-level security / single shared Postgres instance for all users — `VISION.md` itself
flags this as incompatible with HIPAA/GDPR Article 9 handling of health data for the current MVP.
This is a pre-existing, self-acknowledged limitation, not something this pass changed.

## 7. Deploy

Render (`render.yaml`): `npm ci && npm run build` → `node dist/server.js`, health check
`/health`, auto-deploy on push to `main`. No CI/test gate runs before deploy — the only
verification is whatever Michael runs by hand (see Commands in the root CLAUDE.md) plus startup
migrations failing closed (§3). Rollback is Render's "Rollback" to a previous successful deploy.

## 8. Testing

No test framework (no Jest/Vitest/Mocha). Four hand-written Node scripts at repo root, run
manually — see the root CLAUDE.md's Commands table for exact invocations:
- `e2e-test.mjs` — full tool run against a live/local server.
- `e2e-auth.mjs` — JWT issuance/rate-limit/revocation flow.
- `e2e-disabled-tools.mjs` — team-allowlist gating across tools/list, tools/call, and the PDF
  endpoint's five-way-identical-404 behavior.
- `test-team-allowlist.mjs` — no server needed; unit-style check that a missing/empty
  `TEAM_ALLOWLIST` refuses everyone, including would-be team members.
