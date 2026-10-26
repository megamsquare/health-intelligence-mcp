# CLAUDE.md — src/middleware/ (auth, revocation, quotas)

## Purpose

Verifies the caller's identity and enforces usage limits on every `/mcp` and `/upload` request.
This folder holds JWT verification; the revocation *write* path and the backing cache for both
revocation and quota counters live in sibling files referenced below — document them together
since they're one feature.

## Key files

- `auth.ts` — the only file in this folder.
  - `authMiddleware` — full gate used by `POST /mcp` and `POST /upload`: verifies the HS256 JWT
    signature against `SHARED_SECRET`, checks `jti` against the revocation cache, enforces
    `calls_per_day` from JWT claims (falls back to a minimal free-tier default only if claims are
    absent), attaches `req.user`, logs a usage row.
  - `verifyBearerToken` — signature + revocation check only, no quota, no response writing. Used
    by the PDF report route (`../routes/app-routes.ts`) so "no token", "invalid token", and
    "revoked token" all collapse into the same outward response as other refusals.
- `../routes/revoke.ts` — `POST /mcp/token/revoke`, gated by header `x-server-secret` matching
  `SERVER_SECRET`. Writes `mcp:revoked:{jti}` into the cache with a TTL equal to the token's
  remaining lifetime.
- `../cache/index.ts` → `../lib/cache.ts` — the actual store (`AppCache` over `TtlCache`, a plain
  in-process `Map`) backing both revocation (`mcp:revoked:{jti}`) and quota
  (`mcp:usage:{sub}:{YYYY-MM-DD}`) keys.

## Data flow in/out

- **In:** `Authorization: Bearer <JWT>` header. The JWT is signed entirely by the external
  NestJS backend ("backend-profile") using `SHARED_SECRET` — this repo never issues tokens.
- **Out:** `req.user` (`AuthPayload`: `sub`, `email`, `jti`, `org_id`, `tier`, `calls_per_day`,
  `sessions_per_day`) for downstream handlers, or a `401`/`429` response.

## Rules

- **Human-review-only.** Changes here are security-sensitive; show the diff and require tests.
- `SHARED_SECRET`, `SERVER_SECRET`, `DATABASE_URL` throw at module load if missing — never
  change this to a silent default.
- **Known defect, record don't fix without Michael's go-ahead:** revocation and quota state are
  in-memory only. A restart/deploy/Render free-tier spin-down silently un-revokes every
  previously revoked token and resets everyone's daily quota early. CuraBeam v13.1 requires
  durable revocation (Firestore `revokedTokens`). Any local cache introduced here must sit in
  front of that durable store, never replace it as the only copy.
- This folder (and `revoke.ts`, `cache/`) is governed by **CuraBeam v13.1 §5A**
  (`CuraBeam-TRD-V1.docx`) and `sql/gate.sql` for gate/entitlement/access-control work — see the
  root CLAUDE.md's Spec index. Stop and ask Michael if a change here would contradict that spec.

## How to test

- `node --env-file=.env e2e-auth.mjs [base-url]` — JWT issuance/rate-limit/revocation flow
  against a running server (requires `SHARED_SECRET`/`SERVER_SECRET` env vars).
- `node --env-file=.env e2e-disabled-tools.mjs [base-url]` — also exercises how the team
  allowlist and auth interact for the gated tools and the PDF route.

## Maintenance rule

Maintenance rule. Whenever you change code, config, commands, environment variables, data structures, routes, integrations or deployment in this repo, update this CLAUDE.md (and any linked folder CLAUDE.md or docs/ARCHITECTURE.md) in the same branch and commit, and update its "Last updated" line. Read this file and the relevant folder CLAUDE.md before opening source files, and open only what the task needs. If a change contradicts a frozen spec named here, stop and ask Michael first. Never leave these files describing code that no longer exists.

Last updated: 2026-10-26
