export interface BooleanField {
  key: string;
  label: string;
}

export type QuestionType = 'enum' | 'integer' | 'flat_booleans';

export interface Question {
  step: number;
  key: string;
  prompt: string;
  type: QuestionType;
  options?: string[];
  min?: number;
  max?: number;
  fields?: BooleanField[];
}

export const QUESTIONS: Question[] = [
  {
    step: 0,
    key: 'primary_symptom',
    prompt: 'What is your primary symptom?',
    type: 'enum',
    options: [
      'Chest pain',
      'Headache',
      'Abdominal pain',
      'Back pain',
      'Shortness of breath',
      'Fever',
      'Fatigue',
      'Nausea or vomiting',
      'Dizziness',
      'Joint pain',
      'Skin rash',
      'Cough',
      'Other',
    ],
  },
  {
    step: 1,
    key: 'duration',
    prompt: 'How long have you had this symptom?',
    type: 'enum',
    options: [
      'Less than 24 hours',
      '1-3 days',
      '4-7 days',
      '1-4 weeks',
      'More than a month',
    ],
  },
  {
    step: 2,
    key: 'severity',
    prompt: 'Rate the severity from 1 (barely noticeable) to 10 (worst possible)',
    type: 'integer',
    min: 1,
    max: 10,
  },
  {
    step: 3,
    key: 'associated_symptoms',
    prompt: 'Do you also have any of these symptoms? Answer yes or no for each.',
    type: 'flat_booleans',
    fields: [
      { key: 'fever', label: 'Fever (>38°C / 100.4°F)' },
      { key: 'shortness_of_breath', label: 'Shortness of breath' },
      { key: 'nausea_vomiting', label: 'Nausea or vomiting' },
      { key: 'unusual_fatigue', label: 'Unusual fatigue or weakness' },
      { key: 'pain_radiating', label: 'Pain spreading or radiating to other areas' },
      { key: 'confusion', label: 'Confusion or difficulty concentrating' },
    ],
  },
  {
    step: 4,
    key: 'medical_history',
    prompt: 'Do you have any of these existing conditions? Answer yes or no for each.',
    type: 'flat_booleans',
    fields: [
      { key: 'diabetes', label: 'Diabetes' },
      { key: 'hypertension', label: 'High blood pressure' },
      { key: 'heart_disease', label: 'Heart disease or prior heart attack' },
      { key: 'asthma_copd', label: 'Asthma or COPD' },
      { key: 'immunocompromised', label: 'Weakened immune system (cancer, HIV, long-term steroids)' },
    ],
  },
  {
    step: 5,
    key: 'emergency_flags',
    prompt: 'IMPORTANT — Are you experiencing any of these right now? Answer yes or no for each.',
    type: 'flat_booleans',
    fields: [
      { key: 'crushing_chest_pain', label: 'Crushing chest pain or pressure' },
      { key: 'severe_breathing', label: 'Severe difficulty breathing at rest' },
      { key: 'thunderclap_headache', label: 'Sudden, extremely severe headache ("worst of my life")' },
      { key: 'stroke_signs', label: 'Face drooping, arm weakness, or slurred speech' },
      { key: 'loss_of_consciousness', label: 'Loss of consciousness or unresponsiveness' },
    ],
  },
];

export const TOTAL_STEPS = QUESTIONS.length;

export function formatQuestion(q: Question): string {
  let text = `Step ${q.step + 1} of ${TOTAL_STEPS}: ${q.prompt}\n\n`;

  if (q.type === 'enum' && q.options) {
    text += q.options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
    text += '\n\nReply with the option number or its exact text.';
  } else if (q.type === 'integer') {
    text += `Enter a whole number from ${q.min} to ${q.max}.`;
  } else if (q.type === 'flat_booleans' && q.fields) {
    text += q.fields.map(f => `- ${f.label}`).join('\n');
    text += '\n\nProvide your answer as a JSON object with true/false for each key.\n';
    text += 'Keys: ' + q.fields.map(f => `"${f.key}"`).join(', ');
    text += '\nExample: {"' + q.fields[0].key + '": true, "' + q.fields[1].key + '": false, ...}';
  }

  return text;
}
