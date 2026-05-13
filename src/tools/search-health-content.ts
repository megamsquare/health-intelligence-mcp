import { db } from '../db/client.js';
import { searchPubMed } from '../services/pubmed.js';

export async function searchHealthContent(
  query: string,
  limit: number,
  includePubMed: boolean
) {
  const dbResult = await db.query(
    `SELECT source, title, summary, url, published_at, tags,
            ts_rank(to_tsvector('english', title || ' ' || COALESCE(summary, '')),
                    plainto_tsquery('english', $1)) AS rank
     FROM health_articles
     WHERE to_tsvector('english', title || ' ' || COALESCE(summary, ''))
           @@ plainto_tsquery('english', $1)
     ORDER BY rank DESC, published_at DESC NULLS LAST
     LIMIT $2`,
    [query, Math.min(limit, 20)]
  );

  let pubmedArticles: Awaited<ReturnType<typeof searchPubMed>> = [];
  if (includePubMed) {
    try {
      pubmedArticles = await searchPubMed(query, Math.min(limit, 10));
    } catch {
      // PubMed is best-effort; don't fail the whole search
    }
  }

  return {
    stored_articles: dbResult.rows,
    pubmed_articles: pubmedArticles,
    total: dbResult.rows.length + pubmedArticles.length,
    hint:
      dbResult.rows.length === 0 && !includePubMed
        ? 'No stored articles matched. Try include_pubmed: true, or call ingest_health_news first.'
        : undefined,
  };
}
