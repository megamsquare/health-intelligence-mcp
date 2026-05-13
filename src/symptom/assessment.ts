export type UrgencyLevel = 'EMERGENCY' | 'URGENT' | 'SOON' | 'ROUTINE';

export interface LikelyCondition {
  condition: string;
  notes: string;
}

export interface Assessment {
  urgency: UrgencyLevel;
  urgency_message: string;
  likely_conditions: LikelyCondition[];
  recommended_action: string;
  disclaimer: string;
}

interface Answers {
  primary_symptom: string;
  duration: string;
  severity: number;
  associated_symptoms: Record<string, boolean>;
  medical_history: Record<string, boolean>;
  emergency_flags: Record<string, boolean>;
}

const DISCLAIMER =
  'This assessment is for informational purposes only and does NOT constitute a medical diagnosis. ' +
  'It does not replace professional medical advice, examination, or treatment. ' +
  'Always consult a qualified healthcare provider for medical concerns.';

export function generateAssessment(answers: Answers): Assessment {
  const { primary_symptom, severity, associated_symptoms, medical_history, emergency_flags } =
    answers;

  // Emergency flags override everything
  if (Object.values(emergency_flags).some(Boolean)) {
    return {
      urgency: 'EMERGENCY',
      urgency_message: 'Seek emergency care immediately',
      likely_conditions: [
        {
          condition: 'Potential medical emergency',
          notes: 'One or more emergency warning signs are present. Do not wait.',
        },
      ],
      recommended_action:
        'Call 911 (US), 999 (UK), 112 (EU), or your local emergency number immediately. Do not drive yourself.',
      disclaimer: DISCLAIMER,
    };
  }

  if (primary_symptom === 'Chest pain') {
    const isHighRisk =
      associated_symptoms.shortness_of_breath ||
      associated_symptoms.pain_radiating ||
      severity >= 7 ||
      medical_history.heart_disease;
    return {
      urgency: isHighRisk ? 'URGENT' : 'SOON',
      urgency_message: isHighRisk ? 'Seek care today' : 'See a doctor within a few days',
      likely_conditions: [
        {
          condition: 'Cardiac event (angina, heart attack)',
          notes: isHighRisk ? 'High-risk features present — requires same-day evaluation.' : '',
        },
        { condition: 'Pulmonary embolism', notes: associated_symptoms.shortness_of_breath ? 'Shortness of breath noted.' : '' },
        { condition: 'Musculoskeletal chest pain or GERD', notes: 'More likely without radiating pain or breathlessness.' },
      ].filter(c => c.condition),
      recommended_action: isHighRisk
        ? 'Go to an emergency room or call 911. Do not delay.'
        : 'Contact your doctor today for an urgent appointment.',
      disclaimer: DISCLAIMER,
    };
  }

  if (primary_symptom === 'Headache') {
    const isUrgent =
      (associated_symptoms.fever && answers.duration === 'Less than 24 hours') ||
      associated_symptoms.confusion ||
      severity >= 8;
    return {
      urgency: isUrgent ? 'URGENT' : 'ROUTINE',
      urgency_message: isUrgent ? 'Seek care today' : 'Schedule an appointment when convenient',
      likely_conditions: isUrgent
        ? [
            { condition: 'Meningitis', notes: 'Headache + fever with rapid onset. Stiff neck is a red flag — go to ER immediately.' },
            { condition: 'Severe migraine', notes: 'Possible if recurring pattern.' },
          ]
        : [
            { condition: 'Tension headache', notes: 'Most common cause.' },
            { condition: 'Migraine', notes: 'Especially if recurring or with light/sound sensitivity.' },
            { condition: 'Dehydration or stress', notes: 'Common triggers.' },
          ],
      recommended_action: isUrgent
        ? 'See a doctor today. If a stiff neck develops, go to the ER immediately.'
        : 'Rest, stay hydrated. See your doctor if headaches are recurring, worsening, or disrupting daily life.',
      disclaimer: DISCLAIMER,
    };
  }

  if (primary_symptom === 'Shortness of breath') {
    const urgency: UrgencyLevel = severity >= 6 || medical_history.heart_disease ? 'URGENT' : 'SOON';
    return {
      urgency,
      urgency_message: urgency === 'URGENT' ? 'Seek care today' : 'See a doctor within a few days',
      likely_conditions: [
        { condition: 'Asthma or COPD exacerbation', notes: medical_history.asthma_copd ? 'Known history increases likelihood.' : '' },
        { condition: 'Anxiety or panic attack', notes: 'Common cause of acute breathlessness without exertion.' },
        { condition: 'Respiratory infection', notes: associated_symptoms.fever ? 'Fever supports this.' : 'Possible if accompanied by cough.' },
        { condition: 'Cardiac cause', notes: 'Should be excluded, especially with chest discomfort.' },
      ],
      recommended_action: urgency === 'URGENT'
        ? 'See a doctor today. Go to the ER if breathing worsens rapidly.'
        : 'Schedule an appointment. Monitor whether breathlessness worsens with exertion.',
      disclaimer: DISCLAIMER,
    };
  }

  if (primary_symptom === 'Fever') {
    const urgency: UrgencyLevel =
      severity >= 7 || medical_history.immunocompromised || associated_symptoms.confusion
        ? 'URGENT'
        : 'SOON';
    return {
      urgency,
      urgency_message: urgency === 'URGENT' ? 'Seek care today' : 'See a doctor within a few days',
      likely_conditions: [
        { condition: 'Viral infection (influenza, COVID-19)', notes: 'Most common cause of fever in adults.' },
        { condition: 'Bacterial infection', notes: associated_symptoms.confusion ? 'Confusion with fever is a red flag — requires urgent evaluation.' : 'Needs clinical assessment.' },
        { condition: 'Inflammatory condition', notes: 'Consider if persistent or recurrent.' },
      ],
      recommended_action: medical_history.immunocompromised
        ? 'Immunocompromised patients with fever should be seen today — do not wait.'
        : 'Rest and stay hydrated. See a doctor if fever exceeds 39.4°C (103°F), persists beyond 3 days, or worsens.',
      disclaimer: DISCLAIMER,
    };
  }

  // Default for all other primary symptoms
  const urgency: UrgencyLevel = severity >= 7 ? 'SOON' : 'ROUTINE';
  return {
    urgency,
    urgency_message:
      urgency === 'SOON' ? 'See a doctor within a few days' : 'Schedule a routine appointment',
    likely_conditions: [
      {
        condition: `${primary_symptom} — cause undetermined without physical examination`,
        notes: 'Multiple possible causes. In-person assessment is required for a diagnosis.',
      },
    ],
    recommended_action:
      urgency === 'SOON'
        ? 'Contact your primary care doctor to schedule an appointment within the next few days.'
        : 'Monitor your symptoms. Schedule a routine appointment if they persist or worsen.',
    disclaimer: DISCLAIMER,
  };
}
