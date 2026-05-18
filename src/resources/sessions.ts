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

export async function getSession(sessionId: string): Promise<SessionDetail | null> {
  const result = await db.query(
    `SELECT id, created_at, completed_at, answers, assessment
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
  };
}
