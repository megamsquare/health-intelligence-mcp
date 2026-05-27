export type UrgencyLevel = 'EMERGENCY' | 'URGENT' | 'SOON' | 'ROUTINE';

export interface ConditionSource {
  source: string;
  title: string;
  url: string | null;
}

export interface LikelyCondition {
  condition: string;
  notes: string;
  icd_code?: string;
  sources?: ConditionSource[];
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
  country?: string;
}

const DISCLAIMER =
  'This assessment is for informational purposes only and does NOT constitute a medical diagnosis. ' +
  'It does not replace professional medical advice, examination, or treatment. ' +
  'Always consult a qualified healthcare provider for medical concerns.';

// ── Region risk profiles ──────────────────────────────────────────────────────

const HIGH_MALARIA = new Set([
  // West Africa
  'nigeria','ghana','senegal','guinea','sierra leone','liberia','ivory coast',
  "côte d'ivoire",'mali','burkina faso','niger','benin','togo','cameroon',
  'gambia','guinea-bissau',
  // Central Africa
  'democratic republic of congo','drc','congo','central african republic',
  'gabon','equatorial guinea','chad','angola',
  // East Africa
  'kenya','tanzania','uganda','rwanda','burundi','ethiopia','mozambique',
  'malawi','zambia','zimbabwe','madagascar','south sudan','somalia',
  // Asia & Pacific
  'myanmar','papua new guinea','solomon islands','timor-leste',
  // Americas
  'haiti',
]);

const MODERATE_MALARIA = new Set([
  'india','pakistan','afghanistan','bangladesh','indonesia','philippines',
  'cambodia','laos','vietnam','thailand','malaysia',
  'colombia','brazil','peru','bolivia','venezuela','guyana','suriname',
  'panama','costa rica','south africa','namibia','botswana',
  'sudan','eritrea','djibouti','mauritania',
]);

const HIGH_DENGUE = new Set([
  'brazil','indonesia','philippines','india','thailand','vietnam','malaysia',
  'bangladesh','colombia','venezuela','puerto rico','trinidad and tobago',
  'singapore','myanmar','cambodia','laos','pakistan','sri lanka','maldives',
  'nigeria','kenya','tanzania','ghana','senegal',
]);

const HIGH_TYPHOID = new Set([
  'india','pakistan','bangladesh','nepal','indonesia','philippines','vietnam',
  'cambodia','laos','myanmar','afghanistan','iraq','egypt',
  'nigeria','ghana','kenya','tanzania','ethiopia','uganda',
  'democratic republic of congo','south africa','haiti',
]);

interface RegionProfile {
  malariaRisk: 'high' | 'moderate' | 'none';
  dengueRisk: 'high' | 'none';
  typhoidRisk: 'high' | 'none';
}

function getRegionProfile(country?: string): RegionProfile {
  if (!country) return { malariaRisk: 'none', dengueRisk: 'none', typhoidRisk: 'none' };
  const c = country.toLowerCase().trim();
  return {
    malariaRisk: HIGH_MALARIA.has(c) ? 'high' : MODERATE_MALARIA.has(c) ? 'moderate' : 'none',
    dengueRisk:  HIGH_DENGUE.has(c)  ? 'high' : 'none',
    typhoidRisk: HIGH_TYPHOID.has(c) ? 'high' : 'none',
  };
}

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
    const region = getRegionProfile(answers.country);
    const urgency: UrgencyLevel =
      severity >= 7 || medical_history.immunocompromised || associated_symptoms.confusion ||
      region.malariaRisk === 'high'
        ? 'URGENT'
        : 'SOON';

    const likely_conditions: LikelyCondition[] = [];

    // Region-specific conditions listed first so they are not buried
    if (region.malariaRisk === 'high') {
      likely_conditions.push({
        condition: 'Malaria',
        notes:
          `You are in a high-malaria-risk region (${answers.country}). Fever with fatigue is a classic presentation. ` +
          'A rapid diagnostic test (RDT) or blood smear is essential — do not wait for symptoms to worsen. ' +
          'Untreated malaria can become life-threatening within 24–48 hours.',
      });
    } else if (region.malariaRisk === 'moderate') {
      likely_conditions.push({
        condition: 'Malaria (moderate risk)',
        notes: `Malaria transmission occurs in parts of ${answers.country}. Confirm with an RDT or blood smear if you have been in a rural or forested area.`,
      });
    }

    if (region.dengueRisk === 'high') {
      likely_conditions.push({
        condition: 'Dengue fever',
        notes:
          `Dengue is endemic in ${answers.country}. Watch for severe headache, pain behind the eyes, muscle/joint pain, or rash. ` +
          'There is no specific antiviral — avoid NSAIDs (ibuprofen/aspirin) as they increase bleeding risk.',
      });
    }

    if (region.typhoidRisk === 'high' && (answers.duration === '4-7 days' || answers.duration === '1-4 weeks' || answers.duration === 'More than a month')) {
      likely_conditions.push({
        condition: 'Typhoid fever',
        notes: `Typhoid is common in ${answers.country}. Prolonged fever with fatigue and GI symptoms warrants a Widal test or blood culture.`,
      });
    }

    // Always include standard causes
    likely_conditions.push(
      { condition: 'Viral infection (influenza, COVID-19)', notes: 'Common cause of fever globally.' },
      { condition: 'Bacterial infection', notes: associated_symptoms.confusion ? 'Confusion with fever is a red flag — requires urgent evaluation.' : 'Needs clinical assessment.' },
    );

    const malariaAction = region.malariaRisk !== 'none'
      ? `In ${answers.country}, fever must be tested for malaria with an RDT or blood smear before other treatment. `
      : '';

    return {
      urgency,
      urgency_message: urgency === 'URGENT' ? 'Seek care today' : 'See a doctor within a few days',
      likely_conditions,
      recommended_action: medical_history.immunocompromised
        ? `Immunocompromised patients with fever should be seen today — do not wait. ${malariaAction}`
        : `${malariaAction}Rest and stay hydrated. See a doctor if fever exceeds 39.4°C (103°F), persists beyond 3 days, or worsens.`,
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
