import { Router } from 'express';
import type { Request, Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';

export const keysRouter = Router();

// ── POST /mcp/keys ────────────────────────────────────────────────────────────

keysRouter.post('/mcp/keys', authMiddleware, async (req: Request, res: Response) => {
  const { name } = req.body as { name?: unknown };
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name must be a non-empty string' });
    return;
  }

  const rawKey = randomBytes(32).toString('hex');
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 8);
  const userId = req.user!.sub;

  const { rows } = await db.query<{ id: string; created_at: string }>(
    `INSERT INTO api_keys (user_id, key_hash, key_prefix, name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [userId, keyHash, keyPrefix, name.trim()],
  );

  res.status(201).json({
    id: rows[0].id,
    key: rawKey,
    key_prefix: keyPrefix,
    name: name.trim(),
    created_at: rows[0].created_at,
  });
});

// ── GET /mcp/keys ─────────────────────────────────────────────────────────────

keysRouter.get('/mcp/keys', authMiddleware, async (req: Request, res: Response) => {
  const { rows } = await db.query(
    `SELECT id, key_prefix, name, last_used_at
     FROM api_keys
     WHERE user_id = $1 AND revoked = false
     ORDER BY created_at DESC`,
    [req.user!.sub],
  );
  res.json(rows);
});

// ── DELETE /mcp/keys/:id ──────────────────────────────────────────────────────

keysRouter.delete('/mcp/keys/:id', authMiddleware, async (req: Request, res: Response) => {
  const { rowCount } = await db.query(
    `UPDATE api_keys SET revoked = true
     WHERE id = $1 AND user_id = $2 AND revoked = false`,
    [req.params.id, req.user!.sub],
  );
  if (!rowCount) {
    res.status(404).json({ error: 'Key not found' });
    return;
  }
  res.json({ message: 'key revoked' });
});

// ── POST /mcp/keys/:id/regenerate ────────────────────────────────────────────
// Revokes the existing key and issues a fresh one with the same name + org scope.

keysRouter.post('/mcp/keys/:id/regenerate', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.sub;

  const { rows: existing } = await db.query<{ name: string; org_id: string | null }>(
    `SELECT name, org_id FROM api_keys
     WHERE id = $1 AND user_id = $2 AND revoked = false`,
    [req.params.id, userId],
  );
  if (!existing.length) {
    res.status(404).json({ error: 'Key not found' });
    return;
  }

  const { name, org_id } = existing[0];
  const rawKey = randomBytes(32).toString('hex');
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 8);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE api_keys SET revoked = true WHERE id = $1`,
      [req.params.id],
    );
    const { rows } = await client.query<{ id: string; created_at: string }>(
      `INSERT INTO api_keys (user_id, org_id, key_hash, key_prefix, name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [userId, org_id, keyHash, keyPrefix, name],
    );
    await client.query('COMMIT');
    res.json({
      id: rows[0].id,
      key: rawKey,
      key_prefix: keyPrefix,
      name,
      created_at: rows[0].created_at,
      message: 'Previous key revoked. Store this new key — it will not be shown again.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
