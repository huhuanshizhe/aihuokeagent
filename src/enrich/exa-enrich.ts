/**
 * Exa 企业补全 - 精简版
 * 从 src/lib/radar/exa-enrich.ts 提取
 */

import { config } from '../config.js';
import { EXA_API_URL } from '../lib/exa-constants.js';

interface ExaResult {
  id: string;
  url: string;
  title: string;
  score: number;
  text?: string;
  highlights?: string[];
}

export interface ExaEnrichResult {
  website?: string;
  email?: string;
  linkedInUrl?: string;
  description?: string;
  // CRM 扩展字段
  businessType?: string;
  products?: string[];
  brands?: string[];
  employeesCount?: string;
}

async function exaSearch(query: string, numResults = 3): Promise<ExaResult[]> {
  if (!config.exa.apiKey) throw new Error('EXA_API_KEY not set');

  const res = await fetch(EXA_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': config.exa.apiKey },
    body: JSON.stringify({ query, numResults, type: 'neural', useAutoprompt: true, contents: { text: { maxCharacters: 800 } } }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Exa search failed: ${res.status} ${err}`);
  }

  const data = await res.json() as { results: ExaResult[] };
  return data.results ?? [];
}

function extractEmail(text: string): string | undefined {
  const m = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return m ? m[0] : undefined;
}

function pickWebsite(results: ExaResult[], companyName: string): string | undefined {
  const excluded = ['linkedin.com','facebook.com','twitter.com','crunchbase.com','bloomberg.com','zoominfo.com','apollo.io'];
  for (const r of results) {
    try {
      const host = new URL(r.url).hostname.replace(/^www\./, '');
      if (excluded.some(e => host.includes(e))) continue;
      const namePart = companyName.toLowerCase().split(/\s+/)[0];
      if (namePart && host.includes(namePart)) return r.url.split(/[?#]/)[0];
    } catch { /* skip */ }
  }
  for (const r of results) {
    try {
      const host = new URL(r.url).hostname;
      if (!excluded.some(e => host.includes(e))) return r.url.split(/[?#]/)[0];
    } catch { /* skip */ }
  }
  return undefined;
}

function pickLinkedIn(results: ExaResult[]): string | undefined {
  for (const r of results) {
    if (r.url.includes('linkedin.com/company/')) return r.url.split(/[?#]/)[0];
  }
  return undefined;
}

export async function enrichWithExa(companyName: string, country?: string | null, industry?: string | null): Promise<ExaEnrichResult> {
  const contactQuery = `${companyName} ${country || ''} ${industry || ''} official website contact email`.trim();
  const linkedInQuery = `site:linkedin.com/company ${companyName} ${country || ''}`.trim();

  const [contactResults, linkedInResults] = await Promise.allSettled([
    exaSearch(contactQuery, 5),
    exaSearch(linkedInQuery, 3),
  ]);

  const contacts = contactResults.status === 'fulfilled' ? contactResults.value : [];
  const linkedIns = linkedInResults.status === 'fulfilled' ? linkedInResults.value : [];

  const result: ExaEnrichResult = {};
  result.website = pickWebsite(contacts, companyName);
  result.linkedInUrl = pickLinkedIn([...linkedIns, ...contacts]);

  for (const r of contacts) {
    const text = r.text ?? r.highlights?.join(' ') ?? '';
    const email = extractEmail(text);
    if (email) { result.email = email; break; }
  }

  if (contacts[0]?.text) {
    result.description = contacts[0].text.slice(0, 400).trim();
  }

  return result;
}
