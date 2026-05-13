import { db } from '../db/client.js';
import { searchPubMed } from '../services/pubmed.js';

export async function searchHealthContent(
  query: string,
  limit: number,
  includePubMed: boolean
) {
  // Primary: full-text search with ts_rank relevance scoring
  let dbResult = await db.query(
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

  // Fallback: ILIKE substring match when FTS returns nothing
  // (catches single-word queries or terms not in the English FTS dictionary)
  if (dbResult.rows.length === 0) {
    const pattern = `%${query.replace(/[%_\\]/g, '\\$&')}%`;
    dbResult = await db.query(
      `SELECT source, title, summary, url, published_at, tags, 0 AS rank
       FROM health_articles
       WHERE title ILIKE $1 OR summary ILIKE $1
       ORDER BY published_at DESC NULLS LAST
       LIMIT $2`,
      [pattern, Math.min(limit, 20)]
    );
  }

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
      dbResult.rows.length === 0
        ? 'No stored articles matched. The database holds current WHO/CDC/NHS/OpenFDA headlines — try keywords from recent news (e.g. "hantavirus", "vaccine", "recall"). Call ingest_health_news to refresh, or set include_pubmed: true for live PubMed research results.'
        : undefined,
  };
}
