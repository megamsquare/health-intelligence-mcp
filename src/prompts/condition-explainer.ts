import { z } from 'zod';

export const conditionExplainerArgs = {
  condition: z
    .string()
    .describe('Medical condition to explain, e.g. "Type 2 diabetes", "atrial fibrillation", "Crohn\'s disease"'),
  audience: z
    .enum(['patient', 'caregiver', 'child', 'medical student'])
    .describe(
      '"patient" = plain language for the person diagnosed; "caregiver" = practical guidance for family/carer; "child" = simple words and analogies for a young person; "medical student" = clinical depth with pathophysiology'
    ),
};

const AUDIENCE_GUIDANCE: Record<string, string> = {
  patient: `Write for the person who has just received this diagnosis. Use plain, reassuring language. Define any medical terms the first time they appear. Focus on what the patient can do, not just what is happening to their body. Avoid unnecessary alarm — be honest but constructive.`,

  caregiver: `Write for a family member or carer supporting someone with this condition. Cover: what the condition means day-to-day, how to recognise a flare-up or emergency, practical ways to help without overstepping, and emotional support considerations. Include a clear section on when to seek urgent care on the patient's behalf.`,

  child: `Write for a child or young person (assume age 8–14 unless otherwise stated). Use simple words, short sentences, and at least one relatable analogy (e.g. comparing the body to something familiar). Avoid frightening language. The tone should be calm, curious, and empowering. If something is complex, say "your doctor or grown-up can explain more about this part."`,

  'medical student': `Write for a medical student who wants clinical depth. Include: pathophysiology, epidemiology, diagnostic criteria (with relevant classification systems or scoring tools where applicable), first-line and second-line treatment protocols, monitoring parameters, and common complications. Use standard medical terminology. Cite guideline bodies (e.g. NICE, AHA, WHO, CDC, ECDC) where relevant. Include the WHO ICD-11 code for this condition where known (e.g. "ICD-11: CA40 — Malaria") to enable clinical record linkage.`,
};

export function buildConditionExplainerPrompt(args: { condition: string; audience: string }) {
  const audienceGuidance = AUDIENCE_GUIDANCE[args.audience] ?? AUDIENCE_GUIDANCE.patient;

  return {
    description: `Explain ${args.condition} for a ${args.audience}`,
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `CONDITION EXPLANATION REQUEST
Condition: ${args.condition}
Audience: ${args.audience}

Audience guidance: ${audienceGuidance}

Where a WHO ICD-11 code exists for ${args.condition}, state it at the top of your response (e.g. "ICD-11: CA40 — Malaria") so the patient or clinician can reference the official clinical classification. Where WHO, CDC, NHS, ECDC, PAHO, or Africa CDC guidelines are directly relevant, cite them by name.

Explain **${args.condition}** covering all of the following sections. Adjust the depth, vocabulary, and tone for a **${args.audience}** throughout:

---
**What it is**
A clear definition. Use an analogy if it will help this audience understand.

---
**Common symptoms**
What the condition feels like from the inside and what others might observe. Note which symptoms are most distinctive.

---
**How it's diagnosed**
What a doctor typically does to confirm the condition — tests, examinations, criteria. Keep this proportional to the audience's need for detail.

---
**Treatment options**
Common approaches: medication, lifestyle changes, procedures, therapy. For a patient or caregiver audience, explain the goal of treatment in everyday terms. For a medical student, cover first-line protocols and when to escalate.

---
**Day-to-day management**
Practical tips for living with this condition — diet, activity, monitoring, routine, mental health. Make these specific and actionable.

---
**When to seek urgent care**
Specific warning signs or symptoms that mean the patient (or their carer) should call for help or go to an emergency room without delay. Be explicit — list the signs, don't generalise.

---
Close with a brief reminder that this explanation is educational, and the patient or carer should discuss their specific situation with a qualified healthcare provider.`,
        },
      },
    ],
  };
}
