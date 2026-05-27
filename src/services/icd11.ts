import { TtlCache } from '../lib/cache.js';

const TOKEN_URL = 'https://icdaccessmanagement.who.int/connect/token';
const API_BASE  = 'https://id.who.int/icd/release/11/2024-01/mms';

export interface Icd11Result {
  code: string;
  title: string;
  description: string | null;
}

// Cache results for 1 hour — ICD codes don't change between requests.
const resultCache = new TtlCache<string, Icd11Result | null>(60 * 60_000);
let tokenCache: { token: string; expires: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expires) return tokenCache.token;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.ICD11_CLIENT_ID!,
      client_secret: process.env.ICD11_CLIENT_SECRET!,
      scope:         'icdapi_access',
      grant_type:    'client_credentials',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`ICD-11 token request failed: ${res.status}`);

  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 };
  return tokenCache.token;
}

// Returns null silently when credentials are not configured or the lookup fails —
// the assessment continues without ICD enrichment rather than erroring.
export async function lookupIcd11(condition: string): Promise<Icd11Result | null> {
  if (!process.env.ICD11_CLIENT_ID || !process.env.ICD11_CLIENT_SECRET) return null;

  const key = condition.toLowerCase().trim();
  const cached = resultCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const token = await getToken();
    const res = await fetch(
      `${API_BASE}/search?q=${encodeURIComponent(condition)}&flatResults=true&useFlexisearch=false`,
      {
        headers: {
          Authorization:   `Bearer ${token}`,
          Accept:          'application/json',
          'API-Version':   'v2',
          'Accept-Language': 'en',
        },
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!res.ok) { resultCache.set(key, null); return null; }

    const data = await res.json() as {
      destinationEntities?: Array<{ theCode?: string; title?: string; definition?: string }>;
    };

    const top = data.destinationEntities?.[0];
    if (!top) { resultCache.set(key, null); return null; }

    const result: Icd11Result = {
      code:        top.theCode ?? '',
      title:       top.title ?? condition,
      description: top.definition ?? null,
    };
    resultCache.set(key, result);
    return result;
  } catch {
    resultCache.set(key, null);
    return null;
  }
}
