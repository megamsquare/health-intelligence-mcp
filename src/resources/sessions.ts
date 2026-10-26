import { db } from '../db/client.js';
import { QUESTIONS } from '../symptom/questions.js';

export interface SessionTurn {
  step: number;
  question: string;
  answer: unknown;
}

export interface SessionDetail {
  session_id: string;
  created_at: string;
  completed_at: string | null;
  turns: SessionTurn[];
  assessment: unknown | null;
}

// Internal shape used only for the ownership check in register/resources.ts —
// user_id is deliberately left out of SessionDetail, which is the public
// response shape and stays unchanged.
export interface OwnedSessionDetail extends SessionDetail {
  user_id: string | null;
}

export async function getSession(sessionId: string): Promise<OwnedSessionDetail | null> {
  const result = await db.query(
    `SELECT id, created_at, completed_at, answers, assessment, user_id
     FROM symptom_sessions
     WHERE id = $1`,
    [sessionId]
  );

  if (!result.rows.length) return null;

  const row = result.rows[0];
  const answers: Record<string, unknown> = row.answers ?? {};

  const turns: SessionTurn[] = QUESTIONS.map(q => ({
    step: q.step,
    question: q.prompt,
    answer: answers[q.key] ?? null,
  }));

  return {
    session_id: row.id,
    created_at: row.created_at,
    completed_at: row.completed_at ?? null,
    turns,
    assessment: row.assessment ?? null,
    user_id: row.user_id ?? null,
  };
}
