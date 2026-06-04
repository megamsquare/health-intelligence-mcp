import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { symptomCheckerArgs, buildSymptomCheckerPrompt } from '../prompts/symptom-checker.js';
import { emergencyTriageArgs, buildEmergencyTriagePrompt } from '../prompts/emergency-triage.js';
import { preAppointmentPrepArgs, buildPreAppointmentPrepPrompt } from '../prompts/pre-appointment-prep.js';
import { conditionExplainerArgs, buildConditionExplainerPrompt } from '../prompts/condition-explainer.js';

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'symptom-checker',
    {
      title: 'Guided Symptom Checker',
      description:
        'Opens a structured, one-question-at-a-time symptom assessment with a medical disclaimer. ' +
        'Choose "standard" for a full 6-step clinical history (asks for country to enable region-specific conditions like malaria, dengue, typhoid) ' +
        'or "fast-track" for a 3-question triage. Assessment results include ICD-11 codes and citations from WHO, CDC, NHS, ECDC, PAHO, and Africa CDC.',
      argsSchema: symptomCheckerArgs,
    },
    ({ language, urgency }) => buildSymptomCheckerPrompt({ language, urgency })
  );

  server.registerPrompt(
    'emergency-triage',
    {
      title: 'Emergency Triage',
      description:
        'Fast-path prompt for urgent or potentially life-threatening symptoms. ' +
        'Returns immediate first-aid steps, red flags for calling emergency services (with country-specific emergency numbers), ' +
        'and guidance on finding the nearest appropriate facility. Pass country for region-aware advice.',
      argsSchema: emergencyTriageArgs,
    },
    ({ symptoms, country }) => buildEmergencyTriagePrompt({ symptoms, country })
  );

  server.registerPrompt(
    'pre-appointment-prep',
    {
      title: 'Pre-Appointment Preparation',
      description:
        'Generates a structured checklist to help a patient prepare for a doctor visit: questions to ask, symptoms to track, ' +
        'medications to list, records to bring, and lifestyle context to share. ' +
        'Optionally accepts a completed symptom-check session_id to personalise the output with recorded patient history, ' +
        'including ICD-11 codes and clinical citations from WHO, CDC, NHS, ECDC, PAHO, and Africa CDC.',
      argsSchema: preAppointmentPrepArgs,
    },
    ({ condition, session_id }) => buildPreAppointmentPrepPrompt({ condition, session_id })
  );

  server.registerPrompt(
    'condition-explainer',
    {
      title: 'Condition Explainer',
      description:
        'Plain-language explanation of a medical condition tailored to the intended audience: ' +
        '"patient" (reassuring, jargon-free), "caregiver" (practical support guidance), ' +
        '"child" (simple words and analogies), or "medical student" (clinical depth with pathophysiology).',
      argsSchema: conditionExplainerArgs,
    },
    ({ condition, audience }) => buildConditionExplainerPrompt({ condition, audience })
  );
}
