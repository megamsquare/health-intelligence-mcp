import { z } from 'zod';

export const emergencyTriageArgs = {
  symptoms: z
    .string()
    .describe('Brief description of the symptoms, e.g. "chest pain radiating to left arm, sweating, difficulty breathing"'),
  country: z
    .string()
    .optional()
    .describe('Country or region the patient is in, e.g. "Nigeria", "India", "Brazil". Used to show the correct local emergency number.'),
};

export function buildEmergencyTriagePrompt(args: { symptoms: string; country?: string }) {
  const emergencyNumbers = args.country
    ? `the emergency number for ${args.country} (use 112 if you are unsure of the local number)`
    : '911 (US) / 999 (UK) / 112 (EU, Africa, most of Asia) / or the local emergency number for the patient\'s country';

  return {
    description: `Emergency triage — ${args.symptoms.slice(0, 60)}`,
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `🚨 EMERGENCY TRIAGE REQUEST

Reported symptoms: ${args.symptoms}${args.country ? `\nPatient location: ${args.country}` : ''}

You are an emergency triage assistant. Speed and clarity are critical. Do not ask clarifying questions first — act on the information given.

Respond with exactly these four sections, in this order:

---
**1. CALL EMERGENCY SERVICES NOW IF**
List the specific red flags that mean the patient must call ${emergencyNumbers} immediately, based on the reported symptoms. Be explicit — if these symptoms match a known emergency pattern, say so directly. State the correct emergency number prominently.

---
**2. IMMEDIATE FIRST-AID STEPS**
Numbered, action-by-action steps the patient or bystander should take right now, while waiting for help or deciding on next steps. Be specific and concrete. Lead with the single most important action.

---
**3. DO NOT**
Up to 5 things the patient must NOT do with these symptoms (e.g. "Do not eat or drink anything", "Do not drive yourself").

---
**4. FIND CARE**
Advise on the appropriate level of care (emergency room vs urgent care vs GP) and how to find the nearest facility. ${args.country ? `Use the find_specialists tool with the patient's location in ${args.country}` : 'If the patient provides their location, use the find_specialists tool'} with specialty "emergency room" or "urgent care" to return a real list of nearby options. If the condition may have a regional element (e.g. malaria in sub-Saharan Africa, dengue in South/Southeast Asia or Latin America), note this and suggest the relevant specialist or hospital department.

---
Close with a one-line reminder that this guidance is informational and does not replace calling emergency services or an in-person assessment.`,
        },
      },
    ],
  };
}
