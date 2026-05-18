import { db } from '../db/client.js';
import { searchPubMed, type PubMedArticle } from '../services/pubmed.js';
import { TtlCache } from '../lib/cache.js';

interface SearchResult {
  stored_articles: Record<string, unknown>[];
  pubmed_articles: PubMedArticle[];
  total: number;
  hint?: string;
}

// Cache results for 5 minutes — health headlines don't change that fast.
const cache = new TtlCache<string, SearchResult>(5 * 60_000);

async function dbSearch(query: string, limit: number) {
  // Primary: FTS against the stored search_vector column (computed once at insert).
  let result = await db.query(
    `SELECT source, title, summary, url, published_at, tags,
            ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
     FROM health_articles
     WHERE search_vector @@ plainto_tsquery('english', $1)
     ORDER BY rank DESC, published_at DESC NULLS LAST
     LIMIT $2`,
    [query, limit]
  );

  // Fallback: ILIKE when FTS returns nothing (single-word or non-dictionary terms).
  if (result.rows.length === 0) {
    const pattern = `%${query.replace(/[%_\\]/g, '\\$&')}%`;
    result = await db.query(
      `SELECT source, title, summary, url, published_at, tags, 0 AS rank
       FROM health_articles
       WHERE title ILIKE $1 OR summary ILIKE $1
       ORDER BY published_at DESC NULLS LAST
       LIMIT $2`,
      [pattern, limit]
    );
  }

  return result.rows;
}

export async function searchHealthContent(
  query: string,
  limit: number,
  includePubMed: boolean
): Promise<SearchResult> {
  const cacheKey = `${query.toLowerCase().trim()}:${limit}:${includePubMed}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const cappedLimit = Math.min(limit, 20);

  // Run DB and PubMed in parallel when both are needed.
  const [rows, pubmedArticles] = await Promise.all([
    dbSearch(query, cappedLimit),
    includePubMed
      ? searchPubMed(query, Math.min(limit, 10)).catch(() => [] as Awaited<ReturnType<typeof searchPubMed>>)
      : Promise.resolve([] as Awaited<ReturnType<typeof searchPubMed>>),
  ]);

  const result = {
    stored_articles: rows,
    pubmed_articles: pubmedArticles,
    total: rows.length + pubmedArticles.length,
    hint:
      rows.length === 0
        ? 'No stored articles matched. The database holds current WHO/CDC/NHS/OpenFDA headlines — try keywords from recent news (e.g. "hantavirus", "vaccine", "recall"). Call ingest_health_news to refresh, or set include_pubmed: true for live PubMed research results.'
        : undefined,
  };

  cache.set(cacheKey, result);
  return result;
}
