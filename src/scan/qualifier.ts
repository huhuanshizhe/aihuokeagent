import type { NormalizedCandidate, SearchQuery } from '../adapters/types.js';
import { getCountryDisplayName, normalizeCountryCode } from '../lib/country-utils.js';

export interface QualificationResult {
  accepted: boolean;
  tier: 'qualified' | 'review' | 'rejected';
  candidate: NormalizedCandidate;
  score: number;
  reasons: string[];
  rejectionReasons: string[];
}

const NON_LEAD_HOSTS = [
  'wikipedia.org', 'reddit.com', 'pubmed.ncbi.nlm.nih.gov', 'nature.com',
  'researchgate.net', 'semanticscholar.org', 'sciencedirect.com', 'springer.com',
  'youtube.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com',
  'ensun.io', 'dnb.com', 'coatingsworld.com', 'gmiresearch.com',
  'mdpi.com', 'pcimag.com', 'fact-link.com.vn',
  'b-company.jp',
];

const SOCIAL_HOSTS = ['facebook.com', 'instagram.com', 'x.com', 'twitter.com'];

const DOCUMENT_PATTERNS = [
  /\bjournal\b/i, /\bresearch paper\b/i, /\bprotocols?\b/i, /\bpubmed\b/i,
  /\bwikipedia\b/i, /\bon reddit\b/i, /\bdoi\b/i, /\ba decade of\b/i,
  /\bmarket size\b/i, /\bmarket (?:outlook|report|analysis)\b/i, /\ban overview of\b/i,
  /\btop \d+\b/i, /\b(?:directory|list) of companies\b/i, /\bfind .{0,40} companies\b/i,
  /\bcompany list\b/i, /\b(?:exhibition|trade show|conference)\b/i, /\bhow to find\b/i,
  /\bsuppliers? lists?\b/i, /\bguide\b/i, /\bmagazine\b/i, /\bfindings from\b/i,
  /\bmarket competition\b/i, /\bgrowth potential\b/i,
];

const GENERIC_CONSUMER_TYPES = new Set([
  'art_gallery', 'art_museum', 'museum', 'school', 'educational_institution',
  'cafe', 'restaurant', 'tourist_attraction', 'store',
]);

const TYPE_INTENT_WORDS: Record<string, string[]> = {
  art_gallery: ['art', 'gallery'], art_museum: ['art', 'museum'], museum: ['museum'],
  school: ['school', 'training', 'education'], educational_institution: ['school', 'training', 'education', 'university'],
  cafe: ['cafe', 'coffee'], restaurant: ['restaurant', 'food'], tourist_attraction: ['tourism', 'attraction'],
  store: ['store', 'shop', 'dealer', 'distributor', 'retailer'],
};

function normalizeToken(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\p{L}]+/gu, '')
    .replace(/(ing|ed|es|s)$/i, '');
}

function tokens(values: string[]): string[] {
  return [...new Set(values.flatMap(value => value.split(/[^a-z0-9\p{L}]+/giu)).map(normalizeToken).filter(token => token.length > 1))];
}

function hostOf(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function hasCountryEvidence(candidate: NormalizedCandidate, query: SearchQuery): boolean {
  if (!query.countries?.length) return true;
  const targetCodes = query.countries.map(country => normalizeCountryCode(country)).filter(Boolean);
  const candidateCode = normalizeCountryCode(candidate.country);
  if (candidateCode && targetCodes.includes(candidateCode)) return true;

  const evidence = `${candidate.displayName} ${candidate.description || ''} ${candidate.website || ''} ${candidate.sourceUrl || ''}`.toLowerCase();
  return targetCodes.some(code => {
    const display = getCountryDisplayName(code)?.toLowerCase();
    return Boolean(display && evidence.includes(display)) || evidence.includes(`.${code?.toLowerCase()}`);
  });
}

export function qualifyDiscoveredCandidate(candidate: NormalizedCandidate, query: SearchQuery): QualificationResult {
  const reasons: string[] = [];
  const rejectionReasons: string[] = [];
  const source = candidate.matchExplain?.channel || String(candidate.rawData?.source || 'unknown');
  const host = hostOf(candidate.website || candidate.sourceUrl);
  const isSocialHost = Boolean(host && SOCIAL_HOSTS.some(social => host === social || host.endsWith(`.${social}`)));
  const searchable = [
    candidate.displayName, candidate.description, candidate.industry, candidate.businessType,
    ...(candidate.products || []), ...(candidate.brands || []), host,
  ].filter((value): value is string => Boolean(value)).join(' ').toLowerCase();
  const searchableTokens = new Set(tokens([searchable]));
  const keywordGroups = (query.keywords || []).map(keyword => ({ keyword, tokens: tokens([keyword, query.industry || '']) }));
  if (keywordGroups.length === 0 && query.industry) keywordGroups.push({ keyword: query.industry, tokens: tokens([query.industry]) });
  const matches = keywordGroups.map(group => {
    const matched = group.tokens.filter(token => searchableTokens.has(token));
    return { ...group, matched, coverage: group.tokens.length ? matched.length / group.tokens.length : 0 };
  });
  const bestMatch = matches.sort((a, b) => b.coverage - a.coverage || b.matched.length - a.matched.length)[0];
  const queryTokens = [...new Set(keywordGroups.flatMap(group => group.tokens))];
  const matchedTokens = bestMatch?.matched || [];
  const coverage = bestMatch?.coverage || 0;

  const sourceBaseScore: Record<string, number> = {
    apollo: 0.3,
    google_places: 0.2,
    brave_places: 0.26,
    thailand_factory: 0.38,
    ai_search: 0.12,
  };
  let score = sourceBaseScore[source] ?? 0.12;
  if (candidate.website && !isSocialHost) { score += 0.12; reasons.push('has_website'); }
  if (candidate.website && isSocialHost) { score += 0.03; reasons.push('social_web_presence_only'); }
  if (candidate.phone) { score += 0.05; reasons.push('has_phone'); }
  if (candidate.description) { score += 0.04; reasons.push('has_description'); }
  const sourceMatchedKeywords = Array.isArray(candidate.rawData?.sourceMatchedKeywords)
    ? candidate.rawData.sourceMatchedKeywords.filter((value): value is string => typeof value === 'string')
    : [];
  if (sourceMatchedKeywords.length > 0 && source === 'thailand_factory') {
    score += 0.18;
    reasons.push(`provider_keyword_match:${sourceMatchedKeywords.slice(0, 3).join(',')}`);
  }
  if (coverage > 0) {
    score += coverage * 0.42;
    reasons.push(`best_keyword:${bestMatch?.keyword || ''}`);
    reasons.push(`keyword_coverage:${coverage.toFixed(2)}`);
  }

  const normalizedPhrases = (query.keywords || []).map(keyword => keyword.trim().toLowerCase()).filter(Boolean);
  if (normalizedPhrases.some(phrase => searchable.includes(phrase))) {
    score += 0.12;
    reasons.push('exact_query_phrase');
  }

  if (hasCountryEvidence(candidate, query)) {
    score += 0.08;
    reasons.push('country_match');
  } else if (source === 'ai_search') {
    score -= 0.25;
    rejectionReasons.push('target_country_not_evidenced');
  }

  if (host && NON_LEAD_HOSTS.some(blocked => host === blocked || host.endsWith(`.${blocked}`))) {
    if (source === 'ai_search' || !isSocialHost) rejectionReasons.push(`non_lead_domain:${host}`);
    else reasons.push(`weak_social_domain:${host}`);
  }
  if (source === 'ai_search' && DOCUMENT_PATTERNS.some(pattern => pattern.test(`${candidate.displayName} ${candidate.description || ''}`))) {
    rejectionReasons.push('document_or_article_not_company');
  }

  const negativeMatches = (query.excludeKeywords || []).filter(keyword => searchable.includes(keyword.toLowerCase()));
  if (negativeMatches.length) rejectionReasons.push(`negative_keyword:${negativeMatches.slice(0, 3).join(',')}`);

  const placeTypes = Array.isArray(candidate.rawData?.types)
    ? candidate.rawData.types.filter((type): type is string => typeof type === 'string')
    : [];
  for (const type of placeTypes) {
    if (!GENERIC_CONSUMER_TYPES.has(type)) continue;
    const intended = (TYPE_INTENT_WORDS[type] || []).some(word => queryTokens.includes(normalizeToken(word)));
    if (!intended) {
      score -= 0.22;
      rejectionReasons.push(`business_type_mismatch:${type}`);
      break;
    }
  }

  score = Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
  let tier: QualificationResult['tier'];
  if (rejectionReasons.length > 0) tier = 'rejected';
  else if (score >= 0.6) tier = 'qualified';
  else if (score >= 0.4) tier = 'review';
  else {
    tier = 'rejected';
    rejectionReasons.push('insufficient_relevance_evidence');
  }
  const accepted = tier !== 'rejected';
  const qualificationReasons = accepted ? reasons : rejectionReasons;

  return {
    accepted,
    tier,
    score,
    reasons,
    rejectionReasons,
    candidate: {
      ...candidate,
      matchScore: score,
      isTargetCustomer: tier === 'qualified',
      targetReason: `${tier}: ${qualificationReasons.join('; ')}`,
      qualificationTier: tier,
      qualificationReasons,
      matchExplain: {
        ...candidate.matchExplain,
        reasons: [...(candidate.matchExplain?.reasons || []), ...reasons],
        matchedKeywords: matchedTokens,
      },
    },
  };
}
