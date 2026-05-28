import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { cache } from '../cache/index.js';

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
  tier?: string;
  calls_per_day?: number;
  sessions_per_day?: number;
  iat?: number;
  exp?: number;
}

if (!process.env.SHARED_SECRET) throw new Error('SHARED_SECRET environment variable is required');
const secret: string = process.env.SHARED_SECRET;

// Minimal fallback limits used only when JWT claims are absent (very old tokens).
const FREE_CALLS_PER_DAY = 10;
const FREE_SESSIONS_PER_DAY = 2;

function wwwAuthenticate(): string {
  const base = process.env.MCP_SERVER_URL ?? 'http://localhost:3000';
  return `Bearer realm="Health Intelligence MCP", resource_metadata="${base}/.well-known/oauth-protected-resource"`;
}

function toYYYYMMDD(d: Date): string {
  return d.toISOString().slice(0, 10);
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

  // Limits are baked into the JWT by the NestJS backend at issuance time.
  // Fall back to minimal free-tier values only when claims are absent.
  const callsPerDay = payload.calls_per_day ?? FREE_CALLS_PER_DAY;
  const sessionsPerDay = payload.sessions_per_day ?? FREE_SESSIONS_PER_DAY;
  const tier = payload.tier ?? 'free';

  const usageKey = `mcp:usage:${payload.sub}:${toYYYYMMDD(new Date())}`;
  const currentCount = cache.get<number>(usageKey) ?? 0;
  if (currentCount >= callsPerDay) {
    res.status(429).json({
      error: 'Daily call limit exceeded',
      plan: tier,
      limit: callsPerDay,
      resets_at: 'midnight UTC',
    });
    return;
  }
  cache.increment(usageKey, 86400);

  req.user = { ...payload, tier, calls_per_day: callsPerDay, sessions_per_day: sessionsPerDay };
  next();
}
