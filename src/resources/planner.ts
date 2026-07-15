import { normalizeCountryCode } from '../lib/country-utils.js';
import { resourceRegistry } from './registry.js';
import type { DiscoveryPlanInput, DiscoveryResourcePlan, PlannedSource, SourceCatalogEntry } from './types.js';

export function buildDiscoveryResourcePlan(input: DiscoveryPlanInput): DiscoveryResourcePlan {
  const rawCountry = input.countries[0];
  const market = resourceRegistry.findMarket(rawCountry);
  const countryCode = normalizeCountryCode(rawCountry) || market?.countryCode;
  const industry = resourceRegistry.findIndustry(input.industry, input.keywords || []);
  const warnings: string[] = [];
  if (rawCountry && !market) warnings.push(`No active Market Pack exists for ${rawCountry}; global sources will be used`);
  if ((input.industry || input.keywords?.length) && !industry) warnings.push('No Industry Pack matched this intent; only supplied keywords will be used');

  const suppliedKeywords = unique(input.keywords || []);
  const baseKeywords = suppliedKeywords.length ? suppliedKeywords : (industry?.keywords || []);
  const localTerms = countryCode && industry ? industry.localTerms[countryCode] || [] : [];
  const keywords = unique([...baseKeywords, ...localTerms]).slice(0, 20);
  const negativeKeywords = unique([...(input.negativeKeywords || []), ...(industry?.negativeKeywords || [])]).slice(0, 30);
  const sources = resourceRegistry.listSources()
    .filter(source => source.status !== 'disabled')
    .filter(source => appliesToCountry(source, countryCode))
    .filter(source => appliesToIndustry(source, industry?.id))
    .map(source => scoreSource(source, market?.sourceCodes || [], industry?.sourceTypes || []))
    .sort((a, b) => b.score - a.score || a.sourceCode.localeCompare(b.sourceCode));
  const recommendedAdapters = unique(sources.filter(source => source.status === 'active').map(source => source.adapterCode).filter(Boolean) as string[]);

  return {
    version: '1.0',
    countryCode: countryCode || undefined,
    marketPackId: market?.id,
    marketPackVersion: market?.version,
    industryPackId: industry?.id,
    industryPackVersion: industry?.version,
    keywords,
    negativeKeywords,
    recommendedAdapters,
    sources,
    clusters: market?.clusters || [],
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

function appliesToCountry(source: SourceCatalogEntry, countryCode?: string): boolean {
  return source.countries.includes('*') || Boolean(countryCode && source.countries.includes(countryCode));
}

function appliesToIndustry(source: SourceCatalogEntry, industryId?: string): boolean {
  return source.industries.includes('*') || Boolean(industryId && source.industries.includes(industryId));
}

function scoreSource(source: SourceCatalogEntry, marketSources: string[], sourceTypes: string[]): PlannedSource {
  let score = source.qualityBaseline;
  const reasons = [`baseline_quality:${source.qualityBaseline.toFixed(2)}`, `authority:${source.authority}`];
  if (marketSources.includes(source.code)) { score += 0.15; reasons.push('market_pack_preferred'); }
  if (sourceTypes.includes(source.sourceType)) { score += 0.1; reasons.push('industry_source_type_match'); }
  if (source.authority === 'official') { score += 0.08; reasons.push('official_source'); }
  if (!source.requiresApiKey) { score += 0.03; reasons.push('no_api_key_required'); }
  return { sourceCode: source.code, adapterCode: source.adapterCode, score: Math.min(1, Math.round(score * 100) / 100), reasons, status: source.status };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}
