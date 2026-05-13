import { db } from '../db/client.js';
import { fetchWhoNews, fetchCdcNews, fetchNhsNews, type HealthArticle } from '../services/health-feeds.js';
import { fetchFdaAlerts } from '../services/openfda.js';

type Source = 'WHO' | 'CDC' | 'NHS' | 'OpenFDA';

const FETCHERS: Record<Source, () => Promise<HealthArticle[]>> = {
  WHO: fetchWhoNews,
  CDC: fetchCdcNews,
  NHS: fetchNhsNews,
  OpenFDA: async () => {
    const alerts = await fetchFdaAlerts('recall', 20);
    return alerts.map(a => ({ ...a, source: 'OpenFDA' as const }));
  },
};

export async function ingestHealthNews(
  sources: Source[]
): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  let ingested = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const source of sources) {
    try {
      const articles = await FETCHERS[source]();
      for (const article of articles) {
        const result = await db.query(
          `INSERT INTO health_articles (source, external_id, title, summary, url, published_at, tags)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (source, external_id) DO NOTHING`,
          [
            article.source,
            article.external_id,
            article.title,
            article.summary,
            article.url,
            article.published_at,
            article.tags,
          ]
        );
        if ((result.rowCount ?? 0) > 0) ingested++;
        else skipped++;
      }
    } catch (err) {
      errors.push(`${source}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { ingested, skipped, errors };
}
