import { Router } from 'express';
import type { Request, Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';

export const orgsRouter = Router();

function generateApiKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const rawKey = randomBytes(32).toString('hex');
  return {
    rawKey,
    keyHash: createHash('sha256').update(rawKey).digest('hex'),
    keyPrefix: rawKey.slice(0, 8),
  };
}

// ── POST /orgs ────────────────────────────────────────────────────────────────

orgsRouter.post('/orgs', authMiddleware, async (req: Request, res: Response) => {
  const { name, plan, seat_limit, calls_per_day, sessions_per_day, expires_at } =
    req.body as Record<string, unknown>;

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name must be a non-empty string' });
    return;
  }
  if (typeof plan !== 'string' || !plan.trim()) {
    res.status(400).json({ error: 'plan must be a non-empty string' });
    return;
  }
  if (typeof calls_per_day !== 'number' || typeof sessions_per_day !== 'number') {
    res.status(400).json({ error: 'calls_per_day and sessions_per_day must be numbers' });
    return;
  }

  const ownerId = req.user!.sub;
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const { rows: orgRows } = await client.query<{ id: string; created_at: string }>(
      `INSERT INTO organizations (name, owner_id, plan, seat_limit)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [name.trim(), ownerId, plan.trim(), typeof seat_limit === 'number' ? seat_limit : 5],
    );
    const org = orgRows[0];

    await client.query(
      `INSERT INTO subscriptions (user_id, org_id, plan, status, calls_per_day, sessions_per_day, expires_at)
       VALUES ($1, $2, $3, 'active', $4, $5, $6)`,
      [ownerId, org.id, plan.trim(), calls_per_day, sessions_per_day, expires_at ?? null],
    );

    await client.query('COMMIT');
    res.status(201).json({ id: org.id, name: name.trim(), owner_id: ownerId, plan: plan.trim(), created_at: org.created_at });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ── POST /orgs/:id/members ────────────────────────────────────────────────────

orgsRouter.post('/orgs/:id/members', authMiddleware, async (req: Request, res: Response) => {
  const orgId = req.params.id;
  const callerId = req.user!.sub;
  const { user_id, key_name } = req.body as { user_id?: unknown; key_name?: unknown };

  if (typeof user_id !== 'string' || !user_id.trim()) {
    res.status(400).json({ error: 'user_id must be a non-empty string' });
    return;
  }

  const { rows: orgRows } = await db.query<{ owner_id: string }>(
    'SELECT owner_id FROM organizations WHERE id = $1',
    [orgId],
  );
  if (!orgRows.length) {
    res.status(404).json({ error: 'Organization not found' });
    return;
  }
  if (orgRows[0].owner_id !== callerId) {
    res.status(403).json({ error: 'Only the organization owner can add members' });
    return;
  }

  const resolvedKeyName =
    typeof key_name === 'string' && key_name.trim() ? key_name.trim() : `org-key-${user_id.trim()}`;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO org_members (org_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (org_id, user_id) DO NOTHING`,
      [orgId, user_id.trim()],
    );

    const { rawKey, keyHash, keyPrefix } = generateApiKey();
    const { rows: keyRows } = await client.query<{ id: string; created_at: string }>(
      `INSERT INTO api_keys (user_id, org_id, key_hash, key_prefix, name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [user_id.trim(), orgId, keyHash, keyPrefix, resolvedKeyName],
    );

    await client.query('COMMIT');
    res.status(201).json({
      member: { org_id: orgId, user_id: user_id.trim() },
      api_key: {
        id: keyRows[0].id,
        key: rawKey,
        key_prefix: keyPrefix,
        name: resolvedKeyName,
        created_at: keyRows[0].created_at,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ── DELETE /orgs/:id/members/:userId ─────────────────────────────────────────

orgsRouter.delete('/orgs/:id/members/:userId', authMiddleware, async (req: Request, res: Response) => {
  const { id: orgId, userId } = req.params;
  const callerId = req.user!.sub;

  const { rows: orgRows } = await db.query<{ owner_id: string }>(
    'SELECT owner_id FROM organizations WHERE id = $1',
    [orgId],
  );
  if (!orgRows.length) {
    res.status(404).json({ error: 'Organization not found' });
    return;
  }
  if (orgRows[0].owner_id !== callerId) {
    res.status(403).json({ error: 'Only the organization owner can remove members' });
    return;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      'DELETE FROM org_members WHERE org_id = $1 AND user_id = $2',
      [orgId, userId],
    );

    // Revoke all active keys this user holds scoped to this org.
    await client.query(
      `UPDATE api_keys SET revoked = true
       WHERE org_id = $1 AND user_id = $2 AND revoked = false`,
      [orgId, userId],
    );

    await client.query('COMMIT');
    res.json({ message: 'member removed and keys revoked' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
