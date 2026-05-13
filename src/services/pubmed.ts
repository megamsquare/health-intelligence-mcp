const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

export interface PubMedArticle {
  external_id: string;
  title: string;
  summary: string | null;
  url: string;
  published_at: Date | null;
  tags: string[];
}

export async function searchPubMed(query: string, limit = 10): Promise<PubMedArticle[]> {
  const key = process.env.PUBMED_API_KEY ? `&api_key=${process.env.PUBMED_API_KEY}` : '';

  const searchRes = await fetch(
    `${BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${limit}&retmode=json${key}`,
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!searchRes.ok) throw new Error(`PubMed search returned ${searchRes.status}`);

  const searchJson = (await searchRes.json()) as { esearchresult?: { idlist?: string[] } };
  const ids = searchJson.esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];

  const summaryRes = await fetch(
    `${BASE}/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json${key}`,
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!summaryRes.ok) throw new Error(`PubMed summary returned ${summaryRes.status}`);

  const summaryJson = (await summaryRes.json()) as { result?: Record<string, any> };
  const result = summaryJson.result ?? {};

  return ids
    .map((id): PubMedArticle | null => {
      const a = result[id];
      if (!a || typeof a !== 'object') return null;
      return {
        external_id: id,
        title: a.title ?? 'Untitled',
        summary: a.summary ?? null,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        published_at: a.pubdate ? new Date(a.pubdate) : null,
        tags: Array.isArray(a.meshterms) ? a.meshterms.slice(0, 5) : [],
      };
    })
    .filter((a): a is PubMedArticle => a !== null);
}
