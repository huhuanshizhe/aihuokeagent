import { normalizeCountryCode } from '../lib/country-utils.js';
const DEFAULT_EXCLUSIONS = [
    'wikipedia',
    'reddit',
    'research paper',
    'journal article',
    'definition',
    'tutorial',
    'jobs',
];
function uniqueStrings(values) {
    return [...new Set((values || []).map(value => value.trim()).filter(Boolean))];
}
export function normalizeDiscoveryOptions(options) {
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
export function getProviderQueryBudget(maxResults = 20, keywordCount = 1) {
    const safeResults = Number.isFinite(maxResults) ? Math.max(1, Math.floor(maxResults)) : 20;
    const safeKeywords = Number.isFinite(keywordCount) ? Math.max(1, Math.floor(keywordCount)) : 1;
    return Math.min(6, safeResults, safeKeywords);
}
//# sourceMappingURL=discovery-query.js.map