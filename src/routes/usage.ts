import { Router, Request, Response } from 'express';
import { cache } from '../cache/index.js';

const usageRouter = Router();
const serverSecret = process.env.SERVER_SECRET;

// POST /internal/usage
// Body: { userIds: string[] }
// Returns: Record<userId, callsToday>
// Protected by x-server-secret header — backend use only.
usageRouter.post('/internal/usage', (req: Request, res: Response) => {
  if (!serverSecret || req.headers['x-server-secret'] !== serverSecret) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const { userIds } = req.body as { userIds?: unknown };
  if (!Array.isArray(userIds) || userIds.some((id) => typeof id !== 'string')) {
    res.status(400).json({ error: 'userIds must be an array of strings' });
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const result: Record<string, number> = {};

  for (const uid of userIds as string[]) {
    const key = `mcp:usage:${uid}:${today}`;
    result[uid] = cache.get<number>(key) ?? 0;
  }

  res.status(200).json(result);
});

export { usageRouter };
