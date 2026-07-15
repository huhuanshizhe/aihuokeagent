import { normalizeCountryCode } from '../lib/country-utils.js';
import type { ScanOptions } from './scanner.js';

const DEFAULT_EXCLUSIONS = [
  'wikipedia',
  'reddit',
  'research paper',
  'journal article',
  'definition',
  'tutorial',
  'jobs',
];

function uniqueStrings(values?: string[]): string[] {
  return [...new Set((values || []).map(value => value.trim()).filter(Boolean))];
}

export function normalizeDiscoveryOptions(options: ScanOptions): ScanOptions {
  return {
    ...options,
    keywords: uniqueStrings(options.keywords),
    products: uniqueStrings(options.products),
    countries: uniqueStrings(options.countries).map(country => normalizeCountryCode(country) || country),
    adapters: uniqueStrings(options.adapters),
    negativeKeywords: uniqueStrings([...DEFAULT_EXCLUSIONS, ...(options.negativeKeywords || [])]),
  };
}

/** Keep resource-pack keyword expansion useful without multiplying paid API calls. */
export function getProviderQueryBudget(maxResults = 20, keywordCount = 1): number {
  const safeResults = Number.isFinite(maxResults) ? Math.max(1, Math.floor(maxResults)) : 20;
  const safeKeywords = Number.isFinite(keywordCount) ? Math.max(1, Math.floor(keywordCount)) : 1;
  return Math.min(6, safeResults, safeKeywords);
}
