export interface FdaAlert {
  external_id: string;
  title: string;
  summary: string | null;
  url: string | null;
  published_at: Date | null;
  tags: string[];
}

function parseFdaDate(raw: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(raw).trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

export async function fetchFdaAlerts(query = 'recall', limit = 20): Promise<FdaAlert[]> {
  const key = process.env.OPENFDA_API_KEY ? `&api_key=${process.env.OPENFDA_API_KEY}` : '';
  const res = await fetch(
    `https://api.fda.gov/drug/enforcement.json?search=${encodeURIComponent(query)}&limit=${limit}${key}`,
    { signal: AbortSignal.timeout(10_000) }
  );

  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`OpenFDA returned ${res.status}`);

  const json = (await res.json()) as { results?: any[] };
  return (json.results ?? []).map((r: any) => ({
    external_id: r.recall_number ?? r.event_id ?? `fda-${Date.now()}-${Math.random()}`,
    title: [r.product_description, r.recalling_firm].filter(Boolean).join(' — ').slice(0, 200),
    summary: r.reason_for_recall ? String(r.reason_for_recall).slice(0, 500) : null,
    url: null,
    published_at: r.recall_initiation_date ? parseFdaDate(r.recall_initiation_date) : null,
    tags: ['recall', r.classification].filter(Boolean),
  }));
}
