import { z } from 'zod';

export const symptomCheckerArgs = {
  language: z
    .string()
    .default('English')
    .describe('Language to conduct the assessment in, e.g. "English", "Spanish", "French"'),
  urgency: z
    .enum(['standard', 'fast-track'])
    .default('standard')
    .describe(
      '"standard" = full 6-step clinical history; "fast-track" = 3-question triage for when the user is unwell right now'
    ),
};

export function buildSymptomCheckerPrompt(args: { language: string; urgency: string }) {
  const isFastTrack = args.urgency === 'fast-track';

  const questionFlow = isFastTrack
    ? `Ask exactly 3 questions, in this order:
1. What is your primary symptom right now?
2. How would you rate the severity from 1 (barely noticeable) to 10 (worst imaginable)?
3. Are you experiencing any of these right now: chest pain or pressure, severe difficulty breathing, sudden worst-ever headache, face drooping / arm weakness / slurred speech, loss of consciousness?

After the third answer give an immediate urgency assessment (EMERGENCY / URGENT / SOON / ROUTINE) and a clear recommended action.`
    : `Work through 6 areas in order, one question at a time:
1. Primary symptom — what is bothering the patient most?
2. Duration — how long has this been going on?
3. Severity — rate 1 (barely noticeable) to 10 (worst possible)
4. Associated symptoms — fever, breathlessness, nausea, unusual fatigue, radiating pain, confusion?
5. Relevant medical history — diabetes, hypertension, heart disease, asthma/COPD, weakened immune system?
6. Emergency flags — crushing chest pain, severe breathing difficulty, thunderclap headache, stroke signs, loss of consciousness?

After all 6 answers, summarise the findings, state the urgency level (EMERGENCY / URGENT / SOON / ROUTINE), list likely conditions, and give a clear recommended action.

You also have access to the start_symptom_check and answer_symptom_question tools — use them to formally record the session if the patient wants a shareable report.`;

  return {
    description: `Guided symptom checker in ${args.language} — ${isFastTrack ? 'fast-track 3-question triage' : 'full 6-step clinical history'}`,
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `⚠️ MEDICAL DISCLAIMER: You are an informational assistant only. This is NOT a substitute for professional medical advice, diagnosis, or treatment. If there is any risk to life, stop and advise the patient to call emergency services immediately (911 in the US, 999 in the UK, 112 in the EU).

You are conducting a structured symptom assessment. Conduct the entire conversation in ${args.language}.

RULES:
- Ask ONE question at a time. Do not ask multiple questions in the same message.
- Wait for the patient's full answer before moving to the next question.
- Never provide a diagnosis — only an informational urgency assessment.
- If at any point the patient's answers suggest a life-threatening emergency, stop the flow and tell them to call emergency services immediately.

${questionFlow}

Begin now with your first question in ${args.language}.`,
        },
      },
    ],
  };
}
