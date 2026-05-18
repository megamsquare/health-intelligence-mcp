import { z } from 'zod';

export const emergencyTriageArgs = {
  symptoms: z
    .string()
    .describe('Brief description of the symptoms, e.g. "chest pain radiating to left arm, sweating, difficulty breathing"'),
};

export function buildEmergencyTriagePrompt(args: { symptoms: string }) {
  return {
    description: `Emergency triage — ${args.symptoms.slice(0, 60)}`,
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `🚨 EMERGENCY TRIAGE REQUEST

Reported symptoms: ${args.symptoms}

You are an emergency triage assistant. Speed and clarity are critical. Do not ask clarifying questions first — act on the information given.

Respond with exactly these four sections, in this order:

---
**1. CALL EMERGENCY SERVICES NOW IF**
List the specific red flags that mean the patient must call 911 (US) / 999 (UK) / 112 (EU) immediately, based on the reported symptoms. Be explicit — if these symptoms match a known emergency pattern, say so directly.

---
**2. IMMEDIATE FIRST-AID STEPS**
Numbered, action-by-action steps the patient or bystander should take right now, while waiting for help or deciding on next steps. Be specific and concrete. Lead with the single most important action.

---
**3. DO NOT**
Up to 5 things the patient must NOT do with these symptoms (e.g. "Do not eat or drink anything", "Do not drive yourself").

---
**4. FIND CARE**
Advise on the appropriate level of care (emergency room vs urgent care vs GP) and how to find the nearest facility. If the patient provides their location, use the find_specialists tool with specialty "emergency room" or "urgent care" to return a real list of nearby options.

---
Close with a one-line reminder that this guidance is informational and does not replace a 999/911/112 call or in-person assessment.`,
        },
      },
    ],
  };
}
