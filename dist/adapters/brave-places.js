import { getCountryDisplayName, normalizeCountryCode } from '../lib/country-utils.js';
import { getMarketProfile, localizeIndustrialKeyword } from './market-localization.js';
const BRAVE_PLACE_COUNTRIES = new Set([
    'AR', 'AU', 'AT', 'BE', 'BR', 'CA', 'CL', 'DK', 'FI', 'FR', 'DE', 'GR', 'HK', 'IN', 'ID', 'IT', 'JP', 'KR', 'MY', 'MX',
    'NL', 'NZ', 'NO', 'CN', 'PL', 'PT', 'PH', 'RU', 'SA', 'ZA', 'ES', 'SE', 'CH', 'TW', 'TR', 'GB', 'US',
]);
export class BravePlacesAdapter {
    code = 'brave_places';
    channelType = 'MAPS';
    features = {
        supportsKeywordSearch: true,
        supportsRegionFilter: true,
        supportsPagination: false,
        supportsDetails: false,
        maxResultsPerQuery: 100,
    };
    apiKey;
    timeout;
    constructor(cfg) {
        this.apiKey = cfg.apiKey || '';
        this.timeout = cfg.timeout || 20000;
    }
    async search(query) {
        const startedAt = Date.now();
        if (!this.apiKey)
            throw new Error('Brave Search API key not configured');
        const maxResults = Math.min(query.maxResults || 20, this.features.maxResultsPerQuery);
        const plans = buildBravePlacePlans(query).slice(0, query.maxQueries || Number.POSITIVE_INFINITY);
        const perPlan = Math.min(20, Math.max(3, Math.ceil(maxResults / Math.max(1, plans.length))));
        const groups = await mapWithConcurrency(plans, 2, async (plan) => ({ plan, places: await this.searchPlan(plan, perPlan) }));
        const seen = new Set();
        const items = [];
        for (const group of groups) {
            for (const place of group.places) {
                const id = place.id || `${place.title || ''}:${place.postal_address?.displayAddress || ''}`;
                if (!id || seen.has(id))
                    continue;
                seen.add(id);
                const website = usableWebsite(place.url) ? place.url : undefined;
                items.push({
                    externalId: id,
                    sourceUrl: place.provider_url || place.url || 'https://search.brave.com/',
                    displayName: place.title || 'Unknown business',
                    candidateType: 'COMPANY',
                    description: place.description,
                    website,
                    phone: place.phone,
                    address: place.postal_address?.displayAddress,
                    country: getCountryDisplayName(place.postal_address?.country || group.plan.country) || group.plan.country,
                    city: place.postal_address?.addressLocality,
                    industry: place.categories?.join(', '),
                    matchExplain: { channel: this.code, reasons: ['Brave global place record', `Market segment: ${group.plan.marketSegment}`] },
                    rawData: {
                        source: this.code,
                        searchKeyword: group.plan.sourceKeyword,
                        sourceMatchedKeywords: [group.plan.sourceKeyword],
                        marketSegment: group.plan.marketSegment,
                        rating: place.rating?.ratingValue,
                        reviewCount: place.rating?.reviewCount,
                        lat: place.coordinates?.[0],
                        lng: place.coordinates?.[1],
                    },
                });
            }
        }
        return {
            items,
            total: items.length,
            hasMore: false,
            metadata: {
                source: this.code,
                query,
                fetchedAt: new Date(),
                duration: Date.now() - startedAt,
                rawFetched: groups.reduce((sum, group) => sum + group.places.length, 0),
                keywordStats: aggregateStats(groups.map(group => ({ keyword: group.plan.sourceKeyword, fetched: group.places.length }))),
            },
        };
    }
    async searchPlan(plan, count) {
        const params = new URLSearchParams({
            q: plan.query,
            location: plan.location,
            search_lang: plan.language,
            // Brave's UI locale enum is narrower than its content-language support.
            // Keep response metadata in English while the query itself remains localized.
            ui_lang: 'en-US',
            count: String(count),
            units: 'metric',
        });
        if (BRAVE_PLACE_COUNTRIES.has(plan.country))
            params.set('country', plan.country);
        const response = await fetch(`https://api.search.brave.com/res/v1/local/place_search?${params}`, {
            headers: {
                Accept: 'application/json',
                'X-Subscription-Token': this.apiKey,
                'X-Loc-Country': plan.country,
                'X-Loc-City': plan.location.split(' ')[0],
            },
            signal: AbortSignal.timeout(this.timeout),
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw new Error(`Brave Place Search error: ${response.status} - ${detail.slice(0, 300)}`);
        }
        const data = await response.json();
        return data.results || [];
    }
    async healthCheck() {
        return this.apiKey
            ? { healthy: true, latency: 0, message: 'Brave Place Search key configured' }
            : { healthy: false, latency: 0, error: 'API key not configured' };
    }
}
export function buildBravePlacePlans(query) {
    const keywords = query.keywords?.length ? query.keywords : ['industrial company'];
    const country = query.countries?.[0];
    const code = normalizeCountryCode(country) || 'ALL';
    const countryName = getCountryDisplayName(country) || country || 'United States';
    const profile = getMarketProfile(country);
    return keywords.map((keyword, index) => {
        const cluster = profile?.clusters[index % profile.clusters.length];
        const localized = localizeIndustrialKeyword(keyword, country);
        return {
            sourceKeyword: keyword,
            query: localized || keyword,
            location: cluster ? `${cluster.name} ${countryName}` : countryName,
            country: code,
            language: localized && profile ? profile.languageCode : 'en',
            marketSegment: cluster ? `${countryName}:${cluster.name}` : countryName,
        };
    });
}
function usableWebsite(value) {
    if (!value)
        return false;
    try {
        const host = new URL(value).hostname.replace(/^www\./, '');
        return !['facebook.com', 'instagram.com', 'yelp.com', 'tripadvisor.com'].some(domain => host === domain || host.endsWith(`.${domain}`));
    }
    catch {
        return false;
    }
}
function aggregateStats(stats) {
    const result = new Map();
    for (const stat of stats)
        result.set(stat.keyword, (result.get(stat.keyword) || 0) + stat.fetched);
    return [...result].map(([keyword, fetched]) => ({ keyword, fetched }));
}
async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await mapper(items[index]);
        }
    });
    await Promise.all(workers);
    return results;
}
//# sourceMappingURL=brave-places.js.map