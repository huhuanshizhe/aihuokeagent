import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiscoveryOptions } from '../scan/discovery-query.js';
import { qualifyDiscoveredCandidate } from '../scan/qualifier.js';
import type { NormalizedCandidate, SearchQuery } from '../adapters/types.js';

const query: SearchQuery = {
  keywords: ['painting cell'],
  countries: ['TH'],
  excludeKeywords: ['wikipedia', 'reddit', 'research paper'],
};

function candidate(overrides: Partial<NormalizedCandidate>): NormalizedCandidate {
  return {
    externalId: 'source-1',
    sourceUrl: 'https://maps.google.com/place/1',
    displayName: 'Example Company',
    candidateType: 'COMPANY',
    country: 'Thailand',
    matchExplain: { channel: 'google_places', reasons: [] },
    rawData: { source: 'google_places', types: ['establishment'] },
    ...overrides,
  };
}

test('discovery request normalizes Chinese countries and adds safe exclusions', () => {
  const normalized = normalizeDiscoveryOptions({
    keywords: [' painting cell ', 'painting cell'],
    countries: ['泰国'],
  });
  assert.deepEqual(normalized.keywords, ['painting cell']);
  assert.deepEqual(normalized.countries, ['TH']);
  assert.ok(normalized.negativeKeywords?.includes('wikipedia'));
});

test('industrial paint company passes fast discovery qualification', () => {
  const result = qualifyDiscoveredCandidate(candidate({
    displayName: 'Nippon Paint Decorative Coatings Thailand',
    website: 'https://www.nipponpaintdecor.com',
    phone: '+66 2 462 5299',
  }), query);

  assert.equal(result.accepted, true);
  assert.equal(result.tier, 'qualified');
  assert.ok(result.score >= 0.5);
  assert.ok(result.candidate.matchExplain?.matchedKeywords?.includes('paint'));
});

test('consumer art venue is rejected when it does not match the business intent', () => {
  const result = qualifyDiscoveredCandidate(candidate({
    displayName: 'Art Gallery 36',
    website: 'https://artgallery.example',
    phone: '+66 1 234 5678',
    rawData: { source: 'google_places', types: ['art_gallery', 'museum', 'store'] },
  }), query);

  assert.equal(result.accepted, false);
  assert.equal(result.tier, 'rejected');
  assert.ok(result.rejectionReasons.some(reason => reason.startsWith('business_type_mismatch')));
});

test('article and community domains can never become company leads', () => {
  const article = qualifyDiscoveredCandidate(candidate({
    displayName: 'Cell Painting: a decade of research',
    sourceUrl: 'https://www.nature.com/articles/example',
    website: undefined,
    description: 'A journal article about cell painting assay research.',
    country: undefined,
    matchExplain: { channel: 'ai_search', reasons: [] },
    rawData: { source: 'ai_search' },
  }), query);

  assert.equal(article.accepted, false);
  assert.ok(article.rejectionReasons.some(reason => reason.startsWith('non_lead_domain')));
  assert.ok(article.rejectionReasons.includes('document_or_article_not_company'));
});

test('a company is scored against its best keyword instead of the full keyword pool', () => {
  const multiKeywordQuery: SearchQuery = {
    keywords: [
      'auto parts painting', 'automotive parts painting', 'car parts coating',
      'bumper painting line', 'automotive plastic parts painting', 'motorcycle parts painting',
      'wheel painting line', 'auto parts spray coating', 'automotive paint shop',
      'plastic bumper painting factory',
    ],
    countries: ['TH'],
  };
  const result = qualifyDiscoveredCandidate(candidate({
    displayName: 'KK Auto Parts Coating',
    website: 'https://kkpc.co.th',
    phone: '+66 2 000 0000',
  }), multiKeywordQuery);

  assert.equal(result.tier, 'qualified');
  assert.ok(result.reasons.some(reason => reason.startsWith('best_keyword:')));
  assert.ok(result.reasons.some(reason => reason.startsWith('keyword_coverage:')));
});

test('borderline physical businesses are retained for review', () => {
  const result = qualifyDiscoveredCandidate(candidate({
    displayName: 'Garage Tuan Nam Painting',
    website: undefined,
    phone: '+84 1 234 5678',
    country: 'Vietnam',
  }), { keywords: ['auto parts painting'], countries: ['VN'] });

  assert.equal(result.accepted, true);
  assert.equal(result.tier, 'review');
  assert.ok(result.score >= 0.4);
});

test('social profile is weak evidence for a Maps business, not a hard rejection', () => {
  const result = qualifyDiscoveredCandidate(candidate({
    displayName: 'Autos Only Car Service',
    website: 'https://facebook.com/autosonly',
    description: 'Automotive paint shop and car parts coating service in Vietnam',
    country: 'Vietnam',
  }), { keywords: ['automotive paint shop'], countries: ['VN'] });

  assert.notEqual(result.tier, 'rejected');
  assert.ok(result.reasons.some(reason => reason.startsWith('weak_social_domain')));
});

test('directories, rankings, and market reports are sources, not company leads', () => {
  const directory = qualifyDiscoveredCandidate(candidate({
    displayName: 'Top 21 Paints And Coatings Companies in Thailand',
    website: 'https://ensun.io/search/paint/thailand',
    sourceUrl: 'https://ensun.io/search/paint/thailand',
    description: 'A directory of companies and suppliers.',
    matchExplain: { channel: 'ai_search', reasons: [] },
    rawData: { source: 'ai_search', fallback: true },
  }), { keywords: ['automotive paint shop'], countries: ['TH'] });

  const report = qualifyDiscoveredCandidate(candidate({
    displayName: 'Thailand Paints and Coatings Market Size, Outlook & Report 2032',
    website: 'https://gmiresearch.com/report',
    sourceUrl: 'https://gmiresearch.com/report',
    matchExplain: { channel: 'ai_search', reasons: [] },
    rawData: { source: 'ai_search', fallback: true },
  }), { keywords: ['automotive paint shop'], countries: ['TH'] });

  assert.equal(directory.tier, 'rejected');
  assert.equal(report.tier, 'rejected');
  assert.ok(directory.rejectionReasons.some(reason => reason.startsWith('non_lead_domain')));
  assert.ok(report.rejectionReasons.includes('document_or_article_not_company'));
});
