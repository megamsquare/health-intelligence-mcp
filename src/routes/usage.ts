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

// POST /admin/reset-usage
// Body: { user_id: string }
// Deletes mcp:usage:{user_id}:{today} from the in-memory cache.
// Protected by x-server-secret header — backend use only.
usageRouter.post('/admin/reset-usage', (req: Request, res: Response) => {
  if (!serverSecret || req.headers['x-server-secret'] !== serverSecret) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const { user_id } = req.body as { user_id?: unknown };
  if (!user_id || typeof user_id !== 'string') {
    res.status(400).json({ error: 'user_id must be a non-empty string' });
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const key = `mcp:usage:${user_id}:${today}`;
  cache.delete(key);

  res.status(200).json({ reset: true, user_id, key });
});

export { usageRouter };
