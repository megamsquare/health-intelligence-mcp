import { db } from '../db/client.js';
import {
  fetchWhoNews, fetchCdcNews, fetchNhsNews,
  fetchEcdcNews, fetchPahoNews, fetchAfricaCdcNews,
  type HealthArticle,
} from '../services/health-feeds.js';
import { fetchFdaAlerts } from '../services/openfda.js';

export type Source = 'WHO' | 'CDC' | 'NHS' | 'OpenFDA' | 'ECDC' | 'PAHO' | 'AfricaCDC';

const FETCHERS: Record<Source, () => Promise<HealthArticle[]>> = {
  WHO:       fetchWhoNews,
  CDC:       fetchCdcNews,
  NHS:       fetchNhsNews,
  ECDC:      fetchEcdcNews,
  PAHO:      fetchPahoNews,
  AfricaCDC: fetchAfricaCdcNews,
  OpenFDA: async () => {
    const alerts = await fetchFdaAlerts('recall', 20);
    return alerts.map(a => ({ ...a, source: 'OpenFDA' as const }));
  },
};

export async function ingestHealthNews(
  sources: Source[]
): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  // Fetch all sources in parallel.
  const settled = await Promise.allSettled(
    sources.map(source =>
      FETCHERS[source]().then(
        articles => articles,
        err => {
          throw new Error(`${source}: ${err instanceof Error ? err.message : String(err)}`);
        }
      )
    )
  );

  const errors: string[] = [];
  const allArticles: HealthArticle[] = [];

  for (const result of settled) {
    if (result.status === 'rejected') {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    } else {
      allArticles.push(...result.value);
    }
  }

  if (allArticles.length === 0) {
    return { ingested: 0, skipped: 0, errors };
  }

  // Batch insert: single round trip instead of one query per article.
  const params: unknown[] = [];
  const placeholders = allArticles
    .map((a, i) => {
      const b = i * 7;
      params.push(a.source, a.external_id, a.title, a.summary, a.url, a.published_at, a.tags);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
    })
    .join(', ');

  const result = await db.query(
    `INSERT INTO health_articles (source, external_id, title, summary, url, published_at, tags)
     VALUES ${placeholders}
     ON CONFLICT (source, external_id) DO NOTHING`,
    params
  );

  const ingested = result.rowCount ?? 0;
  const skipped = allArticles.length - ingested;

  return { ingested, skipped, errors };
}
