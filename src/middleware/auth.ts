import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { cache } from '../cache/index.js';
import { db } from '../db/client.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export interface AuthPayload {
  sub: string;
  jti?: string;
  org_id?: string;
  // Legacy JWT claims — ignored if DB subscription found.
  tier?: string;
  calls_per_day?: number;
  sessions_per_day?: number;
  iat?: number;
  exp?: number;
}

export interface ResolvedLimits {
  plan: string;
  calls_per_day: number;
  sessions_per_day: number;
}

if (!process.env.SHARED_SECRET) throw new Error('SHARED_SECRET environment variable is required');
const secret: string = process.env.SHARED_SECRET;

const FREE_FALLBACK: ResolvedLimits = { plan: 'free', calls_per_day: 10, sessions_per_day: 2 };
const SUBSCRIPTION_CACHE_TTL = 300; // 5 minutes

function wwwAuthenticate(): string {
  const base = process.env.MCP_SERVER_URL ?? 'http://localhost:3000';
  return `Bearer realm="Health Intelligence MCP", resource_metadata="${base}/.well-known/oauth-protected-resource"`;
}

function toYYYYMMDD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Look up the effective plan limits for a user/org from the DB.
// Returns the active subscription limits, or the free tier if none/expired.
// Result is cached per user for 5 minutes to avoid a DB hit on every request.
async function resolveSubscription(userId: string, orgId?: string): Promise<ResolvedLimits> {
  const cacheKey = `mcp:sub:${orgId ?? userId}`;
  const cached = cache.get<ResolvedLimits>(cacheKey);
  if (cached) return cached;

  try {
    // Prefer org subscription if org_id present, else user subscription.
    const { rows } = await db.query<{
      plan: string;
      calls_per_day: number;
      sessions_per_day: number;
      expires_at: string | null;
    }>(
      `SELECT plan, calls_per_day, sessions_per_day, expires_at
       FROM subscriptions
       WHERE status = 'active'
         AND ($1::uuid IS NULL OR org_id = $1::uuid)
         AND ($2::text IS NULL OR user_id = $2)
       ORDER BY
         CASE WHEN org_id = $1::uuid THEN 0 ELSE 1 END,
         expires_at DESC NULLS LAST
       LIMIT 1`,
      [orgId ?? null, orgId ? null : userId]
    );

    if (rows.length > 0) {
      const row = rows[0];
      const isExpired = row.expires_at !== null && new Date(row.expires_at) < new Date();

      if (!isExpired) {
        const limits: ResolvedLimits = {
          plan: row.plan,
          calls_per_day: row.calls_per_day,
          sessions_per_day: row.sessions_per_day,
        };
        cache.set(cacheKey, limits, SUBSCRIPTION_CACHE_TTL);
        return limits;
      }
    }

    // No active subscription or expired — look up free tier limits.
    const { rows: freeRows } = await db.query<{ calls_per_day: number; sessions_per_day: number }>(
      `SELECT calls_per_day, sessions_per_day FROM plan_tiers WHERE name = 'free'`
    );

    const free: ResolvedLimits = freeRows.length > 0
      ? { plan: 'free', calls_per_day: freeRows[0].calls_per_day, sessions_per_day: freeRows[0].sessions_per_day }
      : FREE_FALLBACK;

    cache.set(cacheKey, free, SUBSCRIPTION_CACHE_TTL);
    return free;
  } catch {
    // DB unreachable — use hardcoded fallback so the server keeps responding.
    return FREE_FALLBACK;
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.set('WWW-Authenticate', wwwAuthenticate()).status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = header.slice(7);
  let payload: AuthPayload;

  try {
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as unknown as AuthPayload;
  } catch {
    res.set('WWW-Authenticate', wwwAuthenticate()).status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  if (payload.jti) {
    const revoked = cache.get<boolean>(`mcp:revoked:${payload.jti}`);
    if (revoked) {
      res.set('WWW-Authenticate', wwwAuthenticate()).status(401).json({ error: 'Token has been revoked' });
      return;
    }
  }

  // Resolve effective limits from DB (falls back to free tier automatically).
  const limits = await resolveSubscription(payload.sub, payload.org_id);

  const usageKey = `mcp:usage:${payload.sub}:${toYYYYMMDD(new Date())}`;
  const currentCount = cache.get<number>(usageKey) ?? 0;
  if (currentCount >= limits.calls_per_day) {
    res.status(429).json({
      error: 'Daily call limit exceeded',
      plan: limits.plan,
      limit: limits.calls_per_day,
      resets_at: 'midnight UTC',
    });
    return;
  }
  cache.increment(usageKey, 86400);

  // Attach resolved limits alongside the JWT payload for downstream use.
  req.user = { ...payload, tier: limits.plan, calls_per_day: limits.calls_per_day, sessions_per_day: limits.sessions_per_day };
  next();
}
