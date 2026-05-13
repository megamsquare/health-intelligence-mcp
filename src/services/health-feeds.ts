export interface HealthArticle {
  source: string;
  external_id: string;
  title: string;
  summary: string | null;
  url: string | null;
  published_at: Date | null;
  tags: string[];
}

export async function fetchWhoNews(): Promise<HealthArticle[]> {
  const res = await fetch('https://www.who.int/rss-feeds/news-english.xml', {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`WHO feed returned ${res.status}`);
  return parseRss(await res.text(), 'WHO');
}

export async function fetchCdcNews(): Promise<HealthArticle[]> {
  const res = await fetch('https://tools.cdc.gov/api/v2/resources/media/316422.rss', {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`CDC feed returned ${res.status}`);
  return parseRss(await res.text(), 'CDC');
}

export async function fetchNhsNews(): Promise<HealthArticle[]> {
  const res = await fetch('https://www.nhs.uk/news/feed/', {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`NHS feed returned ${res.status}`);
  return parseRss(await res.text(), 'NHS');
}

function parseRss(xml: string, source: string): HealthArticle[] {
  const items: HealthArticle[] = [];

  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = match[1];
    const title = extractCdata(item, 'title');
    const link = extractCdata(item, 'link');
    const description = extractCdata(item, 'description');
    const pubDate = extractCdata(item, 'pubDate');
    const guid = extractCdata(item, 'guid') ?? link;

    if (!title || !guid) continue;

    items.push({
      source,
      external_id: guid.trim(),
      title: stripHtml(title),
      summary: description ? stripHtml(description).slice(0, 500) : null,
      url: link?.trim() ?? null,
      published_at: pubDate ? new Date(pubDate) : null,
      tags: [],
    });
  }

  return items.slice(0, 20);
}

function extractCdata(xml: string, tag: string): string | null {
  const m = xml.match(
    new RegExp(
      `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`
    )
  );
  return m ? (m[1] ?? m[2] ?? null)?.trim() ?? null : null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
