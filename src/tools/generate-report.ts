import { db } from '../db/client.js';
import { generateMedicalReport } from '../pdf/report-generator.js';

export async function generateReport(session_id: string): Promise<string> {
  const result = await db.query(
    `SELECT id, created_at, answers, assessment
     FROM symptom_sessions
     WHERE id = $1 AND completed_at IS NOT NULL`,
    [session_id]
  );

  if (!result.rows.length) {
    throw new Error(
      `Session "${session_id}" not found or not yet completed. ` +
        'Finish all symptom questions (done:true from answer_symptom_question) before generating a report.'
    );
  }

  const session = result.rows[0];
  return generateMedicalReport({
    session_id,
    created_at: session.created_at,
    answers: session.answers,
    assessment: session.assessment,
  });
}
