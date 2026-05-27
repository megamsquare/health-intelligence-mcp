import { db } from '../db/client.js';
import { QUESTIONS, TOTAL_STEPS, formatQuestion } from '../symptom/questions.js';
import { generateAssessment } from '../symptom/assessment.js';

export async function startSymptomCheck(country?: string) {
  const initialAnswers = country ? JSON.stringify({ country }) : '{}';
  const result = await db.query(
    `INSERT INTO symptom_sessions (current_step, answers) VALUES (0, $1) RETURNING id`,
    [initialAnswers]
  );
  const session_id = result.rows[0].id as string;

  return {
    session_id,
    step: 0,
    total_steps: TOTAL_STEPS,
    question: formatQuestion(QUESTIONS[0]),
    ...(country ? { region_context: `Location recorded: ${country}. Region-specific conditions will be included in your assessment.` } : {}),
  };
}

export async function answerSymptomQuestion(
  session_id: string,
  step: number,
  answer: unknown
) {
  const sessionResult = await db.query(
    `SELECT current_step, answers FROM symptom_sessions
     WHERE id = $1 AND completed_at IS NULL`,
    [session_id]
  );

  if (!sessionResult.rows.length) {
    throw new Error(
      `Session "${session_id}" not found or already completed. Call start_symptom_check to begin a new session.`
    );
  }

  const session = sessionResult.rows[0];
  if (session.current_step !== step) {
    throw new Error(
      `Expected step ${session.current_step} but got ${step}. Submit answers in order.`
    );
  }

  const question = QUESTIONS[step];
  const answers = { ...session.answers, [question.key]: answer };
  const nextStep = step + 1;

  if (nextStep >= TOTAL_STEPS) {
    const assessment = generateAssessment(answers as Parameters<typeof generateAssessment>[0]);

    await db.query(
      `UPDATE symptom_sessions
       SET answers = $1, assessment = $2, current_step = $3, completed_at = NOW()
       WHERE id = $4`,
      [JSON.stringify(answers), JSON.stringify(assessment), nextStep, session_id]
    );

    return {
      done: true as const,
      session_id,
      assessment,
    };
  }

  await db.query(
    `UPDATE symptom_sessions SET answers = $1, current_step = $2 WHERE id = $3`,
    [JSON.stringify(answers), nextStep, session_id]
  );

  return {
    done: false as const,
    step: nextStep,
    total_steps: TOTAL_STEPS,
    question: formatQuestion(QUESTIONS[nextStep]),
  };
}
