import { Router } from 'express';
import type { Request, Response } from 'express';
import { cache } from '../cache/index.js';

if (!process.env.SERVER_SECRET) throw new Error('SERVER_SECRET environment variable is required');
const serverSecret: string = process.env.SERVER_SECRET;

export const revokeRouter = Router();

revokeRouter.post('/mcp/token/revoke', (req: Request, res: Response) => {
  if (req.headers['x-server-secret'] !== serverSecret) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const { jti, exp } = req.body as { jti?: unknown; exp?: unknown };

  if (typeof jti !== 'string' || !jti) {
    res.status(400).json({ error: 'jti must be a non-empty string' });
    return;
  }
  if (typeof exp !== 'number') {
    res.status(400).json({ error: 'exp must be a number' });
    return;
  }

  const ttlSeconds = exp - Math.floor(Date.now() / 1000);
  if (ttlSeconds > 0) {
    cache.set(`mcp:revoked:${jti}`, true, ttlSeconds);
  }
  // If ttlSeconds <= 0 the token is already expired and can't be used — nothing to store.

  res.status(200).json({ message: 'token revoked' });
});
