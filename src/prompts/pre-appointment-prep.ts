import { z } from 'zod';
import { getSession } from '../resources/sessions.js';

export const preAppointmentPrepArgs = {
  condition: z
    .string()
    .describe('The medical condition or concern to prepare for, e.g. "Type 2 diabetes", "hypertension", "recurring migraines"'),
  session_id: z
    .string()
    .uuid()
    .optional()
    .describe('Optional: UUID of a completed symptom-check session. When provided, the patient\'s recorded history is embedded in the prompt.'),
};

export async function buildPreAppointmentPrepPrompt(args: { condition: string; session_id?: string }) {
  let historyBlock = '';

  if (args.session_id) {
    const session = await getSession(args.session_id);
    if (session?.completed_at) {
      const answers = Object.fromEntries(session.turns.map(t => [t.question.split('?')[0].trim(), t.answer]));
      const assessment = session.assessment as Record<string, unknown> | null;
      const likelyConds = Array.isArray(assessment?.likely_conditions)
        ? (assessment.likely_conditions as Array<{ condition: string }>).map(c => c.condition).join(', ')
        : 'not determined';

      historyBlock = `
**Patient symptom history (session ${args.session_id})**
${session.turns.map(t => `- ${t.question}: ${JSON.stringify(t.answer)}`).join('\n')}
Assessment urgency: ${assessment?.urgency ?? 'N/A'}
Likely conditions from assessment: ${likelyConds}

Use this history to make the questions and checklists below more specific to what the patient has already reported.
`;
    } else if (session) {
      historyBlock = `\n(Note: Session ${args.session_id} exists but is not yet completed — history not included.)\n`;
    } else {
      historyBlock = `\n(Note: Session ${args.session_id} was not found — proceeding without patient history.)\n`;
    }
  }

  return {
    description: `Pre-appointment prep for ${args.condition}${args.session_id ? ' (with patient history)' : ''}`,
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `DOCTOR VISIT PREPARATION — ${args.condition}
${historyBlock}
Generate a structured pre-appointment checklist for a patient with **${args.condition}** preparing for a doctor's visit. The goal is to help the patient arrive informed, organised, and able to make the most of limited appointment time.

Produce the following sections:

---
**Questions to ask the doctor** (8–10 questions)
Specific, meaningful questions about ${args.condition} — covering diagnosis confirmation, treatment options, lifestyle impact, monitoring, and prognosis. Prioritise questions the patient is likely to forget under pressure.

---
**Symptoms and changes to track before the appointment**
What the patient should observe and document in the days leading up to the visit (timing, triggers, severity, frequency). Include a simple log format they can fill in.

---
**Medications and supplements to list**
A template for the patient to record their current medications, doses, and frequency — including over-the-counter drugs, vitamins, and herbal supplements. Note which details matter most for ${args.condition}.

---
**Tests and records to bring**
Prior lab results, imaging, referral letters, or specialist reports that are likely relevant to ${args.condition}. Include any home monitoring data (blood pressure readings, blood glucose logs, etc.) if applicable.

---
**Lifestyle information to share**
Relevant personal context the doctor will want to know: diet, alcohol, exercise habits, sleep quality, stress levels, occupation. Be specific to what matters for ${args.condition}.

---
Keep all language clear and accessible. Avoid medical jargon where possible; explain any technical terms used.`,
        },
      },
    ],
  };
}
