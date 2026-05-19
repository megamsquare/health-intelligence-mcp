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
  tier: string;
  calls_per_day: number;
  sessions_per_day: number;
  iat?: number;
  exp?: number;
}

if (!process.env.SHARED_SECRET) throw new Error('SHARED_SECRET environment variable is required');
const secret: string = process.env.SHARED_SECRET;

function toYYYYMMDD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = header.slice(7);
  let payload: AuthPayload;

  try {
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as unknown as AuthPayload;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  if (payload.tier === 'expired') {
    res.status(402).json({ error: 'Subscription expired' });
    return;
  }

  if (payload.jti) {
    const revoked = cache.get<boolean>(`mcp:revoked:${payload.jti}`);
    if (revoked) {
      res.status(401).json({ error: 'Token has been revoked' });
      return;
    }
  }

  const usageKey = `mcp:usage:${payload.sub}:${toYYYYMMDD(new Date())}`;
  const currentCount = cache.get<number>(usageKey) ?? 0;
  if (currentCount >= payload.calls_per_day) {
    res.status(429).json({ error: 'Daily call limit exceeded' });
    return;
  }
  cache.increment(usageKey, 86400);

  req.user = payload;
  next();
}
