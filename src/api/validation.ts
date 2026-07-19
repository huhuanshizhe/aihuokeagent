import { getAllAdapterCodes, getAdapter } from '../adapters/registry.js';
import { normalizeCountryCode } from '../lib/country-utils.js';
import type { ScanOptions } from '../scan/scanner.js';

export class RequestValidationError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_REQUEST';
  constructor(message: string, readonly details: string[] = []) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

export interface PipelineRequest extends ScanOptions {
  enrichTopN: number;
  enrichmentConcurrency: number;
  skipDecisionMakers?: boolean;
}

/** Fixed defaults for the public scan contract (vertax / external clients). */
export const PUBLIC_SCAN_MAX_RESULTS = 20;

export interface PublicScanRequest {
  keyword: string;
  country: string;
  /** ISO country code after normalization */
  countryCode: string;
  maxResults: number;
  /** Optional vertax client audit context; ignored for scan logic */
  clientContext?: Record<string, unknown>;
}

function stringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new RequestValidationError(`${field} must be an array of strings`);
  }
  const normalized = [...new Set(value.map(item => item.trim()).filter(Boolean))];
  return normalized.length ? normalized : undefined;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number, field: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new RequestValidationError(`${field} must be an integer between ${min} and ${max}`);
  }
  return value as number;
}

/**
 * Public discover contract: one keyword + one country.
 * Adapters are always auto-planned; maxResults is fixed at PUBLIC_SCAN_MAX_RESULTS.
 */
export function parsePublicScanRequest(body: unknown): PublicScanRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestValidationError('Request body must be a JSON object');
  }
  const input = body as Record<string, unknown>;

  if (typeof input.keyword !== 'string') {
    throw new RequestValidationError('keyword must be a non-empty string');
  }
  const keyword = input.keyword.trim();
  if (!keyword) {
    throw new RequestValidationError('keyword must be a non-empty string');
  }

  if (typeof input.country !== 'string') {
    throw new RequestValidationError('country must be a non-empty string');
  }
  const country = input.country.trim();
  if (!country) {
    throw new RequestValidationError('country must be a non-empty string');
  }
  const countryCode = normalizeCountryCode(country);
  if (!countryCode) {
    throw new RequestValidationError(`Unrecognized country: ${country}`, [
      'Use an ISO code (e.g. TH), English name (e.g. Thailand), or Chinese name (e.g. 泰国)',
    ]);
  }

  let clientContext: Record<string, unknown> | undefined;
  if (input.clientContext !== undefined) {
    if (
      !input.clientContext
      || typeof input.clientContext !== 'object'
      || Array.isArray(input.clientContext)
    ) {
      throw new RequestValidationError('clientContext must be a JSON object when provided');
    }
    clientContext = { ...(input.clientContext as Record<string, unknown>) };
  }

  return {
    keyword,
    country,
    countryCode,
    maxResults: PUBLIC_SCAN_MAX_RESULTS,
    clientContext,
  };
}

export function publicScanToScanOptions(parsed: PublicScanRequest): ScanOptions {
  return {
    keywords: [parsed.keyword],
    countries: [parsed.countryCode],
    maxResults: parsed.maxResults,
    // adapters omitted → automatic resource planning
    clientContext: parsed.clientContext,
  };
}

export function parsePipelineRequest(body: unknown): PipelineRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestValidationError('Request body must be a JSON object');
  }
  const input = body as Record<string, unknown>;
  const keywords = stringArray(input.keywords, 'keywords');
  const products = stringArray(input.products, 'products');
  const countries = stringArray(input.countries, 'countries');
  const adapters = stringArray(input.adapters, 'adapters');
  const negativeKeywords = stringArray(input.negativeKeywords, 'negativeKeywords');
  const companyName = typeof input.companyName === 'string' ? input.companyName.trim() : undefined;

  if (!keywords?.length && !companyName) {
    throw new RequestValidationError('Provide keywords or companyName so discovery can build a search strategy');
  }

  if (adapters?.length) {
    const known = new Set(getAllAdapterCodes());
    const unknown = adapters.filter(code => !known.has(code));
    const unsupported = adapters.filter(code => known.has(code) && !getAdapter(code).features.supportsKeywordSearch);
    const details = [
      ...unknown.map(code => `Unknown adapter: ${code}`),
      ...unsupported.map(code => `Adapter does not support discovery search: ${code}`),
    ];
    if (details.length) throw new RequestValidationError('Invalid discovery adapters', details);
  }

  return {
    keywords,
    countries,
    adapters,
    products,
    negativeKeywords,
    companyName,
    companyIntro: typeof input.companyIntro === 'string' ? input.companyIntro.trim() : undefined,
    industry: typeof input.industry === 'string' ? input.industry.trim() : undefined,
    maxResults: boundedInteger(input.maxResults, 25, 1, 100, 'maxResults'),
    enrichTopN: boundedInteger(input.enrichTopN, 10, 1, 50, 'enrichTopN'),
    enrichmentConcurrency: boundedInteger(input.enrichmentConcurrency, 3, 1, 8, 'enrichmentConcurrency'),
    skipDecisionMakers: input.skipDecisionMakers === true,
  };
}
