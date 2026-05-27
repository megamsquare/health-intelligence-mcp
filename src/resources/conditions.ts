import { db } from '../db/client.js';

export interface ConditionSummary {
  name: string;
  session_count: number;
}

export interface ConditionDetail {
  name: string;
  sessions: Array<{
    session_id: string;
    created_at: string;
    primary_symptom: string;
    urgency: string;
    notes: string;
    icd_code: string | null;
    cited_sources: string[];
  }>;
  related_articles: Array<{
    source: string;
    title: string;
    url: string | null;
    published_at: string | null;
  }>;
}

export async function listConditions(): Promise<ConditionSummary[]> {
  const result = await db.query<{ name: string; session_count: string }>(
    `SELECT c->>'condition' AS name,
            COUNT(*) AS session_count
     FROM symptom_sessions,
          jsonb_array_elements(assessment->'likely_conditions') AS c
     WHERE completed_at IS NOT NULL
       AND assessment IS NOT NULL
     GROUP BY c->>'condition'
     ORDER BY session_count DESC, name`
  );
  return result.rows.map(r => ({ name: r.name, session_count: Number(r.session_count) }));
}

export async function getConditionDetail(name: string): Promise<ConditionDetail> {
  const [sessionsResult, articlesResult] = await Promise.all([
    db.query<{
      session_id: string;
      created_at: string;
      primary_symptom: string;
      urgency: string;
      notes: string;
      icd_code: string | null;
      cited_sources: string[];
    }>(
      `SELECT s.id AS session_id,
              s.created_at,
              s.answers->>'primary_symptom' AS primary_symptom,
              s.assessment->>'urgency' AS urgency,
              c->>'notes' AS notes,
              c->>'icd_code' AS icd_code,
              COALESCE(
                (SELECT jsonb_agg(src->>'source')
                 FROM jsonb_array_elements(c->'sources') AS src),
                '[]'::jsonb
              ) AS cited_sources
       FROM symptom_sessions s,
            jsonb_array_elements(s.assessment->'likely_conditions') AS c
       WHERE s.completed_at IS NOT NULL
         AND s.assessment IS NOT NULL
         AND c->>'condition' ILIKE $1
       ORDER BY s.created_at DESC`,
      [name]
    ),
    db.query<{ source: string; title: string; url: string | null; published_at: string | null }>(
      `SELECT source, title, url, published_at
       FROM health_articles
       WHERE search_vector @@ plainto_tsquery('english', $1)
       ORDER BY published_at DESC NULLS LAST
       LIMIT 5`,
      [name]
    ),
  ]);

  return {
    name,
    sessions: sessionsResult.rows,
    related_articles: articlesResult.rows,
  };
}
