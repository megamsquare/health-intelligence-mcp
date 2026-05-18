import { db } from '../db/client.js';

export interface RecentArticle {
  id: string;
  source: string;
  title: string;
  summary: string | null;
  url: string | null;
  published_at: string | null;
  ingested_at: string;
  tags: string[];
}

export async function fetchRecentArticles(): Promise<RecentArticle[]> {
  const result = await db.query<RecentArticle>(
    `SELECT id, source, title, summary, url,
            published_at, ingested_at, tags
     FROM health_articles
     ORDER BY ingested_at DESC
     LIMIT 50`
  );
  return result.rows;
}
