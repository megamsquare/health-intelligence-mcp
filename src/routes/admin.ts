import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../db/client.js';
import { cache } from '../cache/index.js';

export const adminRouter = Router();

if (!process.env.SERVER_SECRET) throw new Error('SERVER_SECRET environment variable is required');
const serverSecret: string = process.env.SERVER_SECRET;

function requireAdmin(req: Request, res: Response): boolean {
  if (req.headers['x-server-secret'] !== serverSecret) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

// ── Plan tiers ────────────────────────────────────────────────────────────────

// GET /admin/plan-tiers — list all tiers
adminRouter.get('/admin/plan-tiers', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { rows } = await db.query(`SELECT * FROM plan_tiers ORDER BY name`);
  res.json(rows);
});

// POST /admin/plan-tiers — create or update a tier
// Body: { name, calls_per_day, sessions_per_day, max_duration_days? }
adminRouter.post('/admin/plan-tiers', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { name, calls_per_day, sessions_per_day, max_duration_days } = req.body as Record<string, unknown>;

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name must be a non-empty string' });
    return;
  }
  if (typeof calls_per_day !== 'number' || typeof sessions_per_day !== 'number') {
    res.status(400).json({ error: 'calls_per_day and sessions_per_day must be numbers' });
    return;
  }

  const { rows } = await db.query(
    `INSERT INTO plan_tiers (name, calls_per_day, sessions_per_day, max_duration_days)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO UPDATE SET
       calls_per_day    = EXCLUDED.calls_per_day,
       sessions_per_day = EXCLUDED.sessions_per_day,
       max_duration_days = EXCLUDED.max_duration_days
     RETURNING *`,
    [name.trim(), calls_per_day, sessions_per_day, max_duration_days ?? null],
  );

  // Bust all cached subscriptions on this plan so limits take effect within 1 request.
  cache.clear();
  res.status(200).json(rows[0]);
});

// DELETE /admin/plan-tiers/:name — remove a tier (cannot delete 'free')
adminRouter.delete('/admin/plan-tiers/:name', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  if (req.params.name === 'free') {
    res.status(400).json({ error: 'The "free" tier cannot be deleted.' });
    return;
  }
  const { rowCount } = await db.query(`DELETE FROM plan_tiers WHERE name = $1`, [req.params.name]);
  if (!rowCount) {
    res.status(404).json({ error: 'Plan tier not found' });
    return;
  }
  res.json({ message: `Plan tier "${req.params.name}" deleted` });
});

// ── Subscriptions ─────────────────────────────────────────────────────────────

// GET /admin/subscriptions — list all, optionally filter by user_id or org_id
adminRouter.get('/admin/subscriptions', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { user_id, org_id } = req.query as Record<string, string | undefined>;

  const { rows } = await db.query(
    `SELECT s.*, pt.max_duration_days
     FROM subscriptions s
     LEFT JOIN plan_tiers pt ON pt.name = s.plan
     WHERE ($1::text IS NULL OR s.user_id = $1)
       AND ($2::uuid IS NULL OR s.org_id = $2::uuid)
     ORDER BY s.id DESC`,
    [user_id ?? null, org_id ?? null],
  );
  res.json(rows);
});

// POST /admin/subscriptions — create or update a subscription
// Body: { user_id?, org_id?, plan, expires_at? (ISO date or null), calls_per_day?, sessions_per_day? }
// expires_at null = permanent. If omitted, computed from plan_tiers.max_duration_days.
adminRouter.post('/admin/subscriptions', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { user_id, org_id, plan, expires_at, calls_per_day, sessions_per_day } = req.body as Record<string, unknown>;

  if (!user_id && !org_id) {
    res.status(400).json({ error: 'Either user_id or org_id must be provided' });
    return;
  }
  if (typeof plan !== 'string' || !plan.trim()) {
    res.status(400).json({ error: 'plan must be a non-empty string' });
    return;
  }

  const { rows: tierRows } = await db.query<{
    calls_per_day: number;
    sessions_per_day: number;
    max_duration_days: number | null;
  }>(`SELECT calls_per_day, sessions_per_day, max_duration_days FROM plan_tiers WHERE name = $1`, [plan.trim()]);

  if (!tierRows.length) {
    res.status(400).json({ error: `Plan "${plan}" not found. Create it via POST /admin/plan-tiers first.` });
    return;
  }

  const tier = tierRows[0];
  const resolvedCalls = typeof calls_per_day === 'number' ? calls_per_day : tier.calls_per_day;
  const resolvedSessions = typeof sessions_per_day === 'number' ? sessions_per_day : tier.sessions_per_day;

  // expires_at: explicit value > derived from max_duration_days > null (permanent)
  let resolvedExpiry: string | null = null;
  if (expires_at === null) {
    resolvedExpiry = null; // explicitly permanent
  } else if (typeof expires_at === 'string') {
    resolvedExpiry = expires_at;
  } else if (tier.max_duration_days !== null) {
    const d = new Date();
    d.setDate(d.getDate() + tier.max_duration_days);
    resolvedExpiry = d.toISOString();
  }

  const { rows } = await db.query(
    `INSERT INTO subscriptions (user_id, org_id, plan, status, calls_per_day, sessions_per_day, expires_at)
     VALUES ($1, $2, $3, 'active', $4, $5, $6)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [user_id ?? null, org_id ?? null, plan.trim(), resolvedCalls, resolvedSessions, resolvedExpiry],
  );

  // Bust cached subscription for this user/org.
  cache.delete(`mcp:sub:${org_id ?? user_id}`);

  res.status(201).json(rows[0] ?? { message: 'Subscription already exists — use PATCH to update.' });
});

// PATCH /admin/subscriptions/:id — update plan, limits, or expiry
adminRouter.patch('/admin/subscriptions/:id', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { plan, calls_per_day, sessions_per_day, expires_at, status } = req.body as Record<string, unknown>;

  const { rows: existing } = await db.query<{ user_id: string; org_id: string }>(
    `SELECT user_id, org_id FROM subscriptions WHERE id = $1`,
    [req.params.id],
  );
  if (!existing.length) {
    res.status(404).json({ error: 'Subscription not found' });
    return;
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (typeof plan === 'string')             { setClauses.push(`plan = $${i++}`);             params.push(plan); }
  if (typeof calls_per_day === 'number')    { setClauses.push(`calls_per_day = $${i++}`);    params.push(calls_per_day); }
  if (typeof sessions_per_day === 'number') { setClauses.push(`sessions_per_day = $${i++}`); params.push(sessions_per_day); }
  if ('expires_at' in req.body)             { setClauses.push(`expires_at = $${i++}`);       params.push(expires_at ?? null); }
  if (typeof status === 'string')           { setClauses.push(`status = $${i++}`);           params.push(status); }

  if (!setClauses.length) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  params.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE subscriptions SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`,
    params,
  );

  const { user_id, org_id } = existing[0];
  cache.delete(`mcp:sub:${org_id ?? user_id}`);

  res.json(rows[0]);
});

// DELETE /admin/subscriptions/:id — cancel subscription (reverts user to free)
adminRouter.delete('/admin/subscriptions/:id', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const { rows: existing } = await db.query<{ user_id: string; org_id: string }>(
    `SELECT user_id, org_id FROM subscriptions WHERE id = $1`,
    [req.params.id],
  );
  if (!existing.length) {
    res.status(404).json({ error: 'Subscription not found' });
    return;
  }

  await db.query(`UPDATE subscriptions SET status = 'cancelled' WHERE id = $1`, [req.params.id]);

  const { user_id, org_id } = existing[0];
  cache.delete(`mcp:sub:${org_id ?? user_id}`);

  res.json({ message: 'Subscription cancelled. User/org will revert to free tier.' });
});
