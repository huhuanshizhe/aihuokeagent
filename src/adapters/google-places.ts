/**
 * Google Places 适配器 - 精简版
 * 从 src/lib/radar/adapters/google-places.ts 提取
 */

import type { Adapter, SearchQuery, SearchResult, NormalizedCandidate, HealthStatus, AdapterConfig } from './types.js';
import { getCountryDisplayName, normalizeCountryCode } from '../lib/country-utils.js';
import { getMarketProfile, localizeIndustrialKeyword, type Viewport } from './market-localization.js';

interface PlaceResult {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  types?: string[];
  primaryType?: string;
  primaryTypeDisplayName?: { text: string };
  businessStatus?: string;
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  googleMapsUri?: string;
  editorialSummary?: { text: string };
  generativeSummary?: {
    overview?: { text: string };
    description?: { text: string };
  };
}

const FIELD_MASK = [
  'places.id','places.displayName','places.formattedAddress','places.location',
  'places.types','places.primaryType','places.primaryTypeDisplayName',
  'places.businessStatus','places.rating','places.userRatingCount',
  'places.websiteUri','places.nationalPhoneNumber','places.internationalPhoneNumber',
  'places.googleMapsUri','places.editorialSummary','places.generativeSummary',
].join(',');

export class GooglePlacesAdapter implements Adapter {
  readonly code = 'google_places';
  readonly channelType = 'MAPS' as const;
  readonly features = {
    supportsKeywordSearch: true,
    supportsRegionFilter: true,
    supportsPagination: true,
    supportsDetails: true,
    maxResultsPerQuery: 60,
  };

  private apiKey: string;
  private timeout: number;

  constructor(cfg: AdapterConfig) {
    this.apiKey = cfg.apiKey || '';
    this.timeout = cfg.timeout || 15000;
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    const startTime = Date.now();
    if (!this.apiKey) throw new Error('Google Maps API key not configured');

    const maxResults = Math.min(query.maxResults || 20, this.features.maxResultsPerQuery);
    const plans = buildGoogleSearchPlans(query).slice(0, query.maxQueries || Number.POSITIVE_INFINITY);
    const perTerm = Math.min(10, Math.max(3, Math.ceil(maxResults / Math.max(1, plans.length))));
    const resultGroups = await mapWithConcurrency(plans, 3, async plan => ({
      plan,
      places: await this.textSearch(plan, perTerm),
    }));
    const seen = new Set<string>();
    const items: NormalizedCandidate[] = [];
    for (const group of resultGroups) {
      for (const place of group.places) {
        if (seen.has(place.id)) continue;
        seen.add(place.id);
        const item = this.normalize(place, { ...query, keywords: [group.plan.sourceKeyword] });
        item.rawData = {
          ...item.rawData,
          searchKeyword: group.plan.sourceKeyword,
          localizedQuery: group.plan.searchText,
          marketSegment: group.plan.marketSegment,
        };
        items.push(item);
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
        duration: Date.now() - startTime,
        keywordStats: aggregateKeywordStats(resultGroups.map(group => ({ keyword: group.plan.sourceKeyword, fetched: group.places.length }))),
        rawFetched: items.length,
      },
    };
  }

  private async textSearch(plan: GoogleSearchPlan, limit: number): Promise<PlaceResult[]> {
    const allResults: PlaceResult[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < 3 && allResults.length < limit; page++) {
      const body: Record<string, unknown> = pageToken
        ? { pageToken }
        : {
            textQuery: plan.searchText,
            languageCode: plan.languageCode,
            pageSize: Math.min(20, limit),
            ...(plan.regionCode ? { regionCode: plan.regionCode } : {}),
            ...(plan.viewport ? { locationRestriction: { rectangle: plan.viewport } } : {}),
          };

      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Google Places API error: ${response.status} - ${errText}`);
      }

      const data = await response.json() as { places?: PlaceResult[]; nextPageToken?: string };
      if (data.places) allResults.push(...data.places);

      pageToken = data.nextPageToken;
      if (!pageToken) break;
      await new Promise(r => setTimeout(r, 300));
    }

    return allResults.slice(0, limit);
  }

  private normalize(place: PlaceResult, query: SearchQuery): NormalizedCandidate {
    const addressParts = place.formattedAddress?.split(', ') || [];
    const countryPart = addressParts.length > 0 ? addressParts[addressParts.length - 1] : undefined;
    const city = addressParts.length > 1 ? addressParts[addressParts.length - 2] : undefined;
    const targetCountry = query.countries?.length === 1 ? getCountryDisplayName(query.countries[0]) : undefined;
    const primaryTypeLabel = place.primaryTypeDisplayName?.text?.trim();
    const description =
      place.editorialSummary?.text?.trim()
      || place.generativeSummary?.overview?.text?.trim()
      || place.generativeSummary?.description?.text?.trim()
      || undefined;

    return {
      externalId: place.id,
      sourceUrl: place.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${place.id}`,
      displayName: place.displayName?.text || 'Unknown',
      candidateType: 'COMPANY',
      description,
      website: place.websiteUri,
      phone: place.internationalPhoneNumber || place.nationalPhoneNumber,
      address: place.formattedAddress,
      country: targetCountry || getCountryDisplayName(countryPart) || countryPart,
      city,
      industry: primaryTypeLabel || this.inferIndustry(place.types || []),
      matchExplain: {
        channel: 'google_places',
        reasons: [
          'Google Maps POI',
          place.rating ? `Rating ${place.rating} (${place.userRatingCount || 0} reviews)` : undefined,
          place.businessStatus === 'OPERATIONAL' ? 'Operational' : undefined,
        ].filter(Boolean) as string[],
      },
      rawData: {
        source: 'google_places',
        place_id: place.id,
        types: place.types,
        primaryType: place.primaryType,
        primaryTypeDisplayName: primaryTypeLabel,
        rating: place.rating,
        userRatingCount: place.userRatingCount,
        lat: place.location?.latitude,
        lng: place.location?.longitude,
      },
    };
  }

  private inferIndustry(types: string[]): string | undefined {
    const map: Record<string, string> = {
      factory: 'Manufacturing', manufacturing: 'Manufacturing', industrial: 'Industrial',
      electronics_store: 'Electronics', hardware_store: 'Hardware', car_dealer: 'Automotive',
      food: 'Food', construction: 'Construction', logistics: 'Logistics', chemical: 'Chemical',
    };
    for (const type of types) {
      const normalized = type.toLowerCase().replace(/_/g, '');
      for (const [key, value] of Object.entries(map)) {
        if (normalized.includes(key)) return value;
      }
    }
    return undefined;
  }

  async getDetails(externalId: string): Promise<{ externalId: string; phone?: string; website?: string; address?: string; description?: string; additionalInfo?: Record<string, unknown> } | null> {
    if (!this.apiKey) return null;
    try {
      const response = await fetch(`https://places.googleapis.com/v1/places/${externalId}`, {
        headers: { 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': 'id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,editorialSummary,rating,userRatingCount,types,businessStatus' },
        signal: AbortSignal.timeout(this.timeout),
      });
      if (!response.ok) return null;
      const place = await response.json() as PlaceResult;
      return {
        externalId,
        phone: place.internationalPhoneNumber || place.nationalPhoneNumber,
        website: place.websiteUri,
        address: place.formattedAddress,
        description: place.editorialSummary?.text,
        additionalInfo: { rating: place.rating, reviewCount: place.userRatingCount, types: place.types },
      };
    } catch { return null; }
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.apiKey) return { healthy: false, latency: 0, error: 'API key not configured' };
    const start = Date.now();
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': 'places.id' },
        body: JSON.stringify({ textQuery: 'test', pageSize: 1 }),
        signal: AbortSignal.timeout(5000),
      });
      return { healthy: res.ok, latency: Date.now() - start, error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (e) {
      return { healthy: false, latency: Date.now() - start, error: e instanceof Error ? e.message : 'Unknown' };
    }
  }
}

export interface GoogleSearchPlan {
  sourceKeyword: string;
  searchText: string;
  languageCode: string;
  regionCode?: string;
  viewport?: Viewport;
  marketSegment: string;
}

export function buildGoogleSearchPlans(query: SearchQuery): GoogleSearchPlan[] {
  const keywords = query.keywords?.length ? query.keywords : ['industrial company'];
  const country = query.countries?.length === 1 ? query.countries[0] : undefined;
  const countryCode = normalizeCountryCode(country) || undefined;
  const countryName = getCountryDisplayName(country) || country;
  const profile = getMarketProfile(country);
  const plans: GoogleSearchPlan[] = [];

  keywords.forEach((keyword, index) => {
    plans.push({
      sourceKeyword: keyword,
      searchText: [keyword, countryName ? `in ${countryName}` : ''].filter(Boolean).join(' '),
      languageCode: 'en',
      regionCode: countryCode,
      viewport: profile?.viewport,
      marketSegment: profile ? `${profile.countryName}:national` : countryName || 'global',
    });

    const localized = localizeIndustrialKeyword(keyword, country);
    if (localized && profile?.clusters.length) {
      const cluster = profile.clusters[index % profile.clusters.length];
      plans.push({
        sourceKeyword: keyword,
        searchText: `${localized} ${cluster.localName}`,
        languageCode: profile.languageCode,
        regionCode: profile.code,
        viewport: cluster.viewport,
        marketSegment: `${profile.countryName}:${cluster.name}`,
      });
    }
  });

  return plans;
}

function aggregateKeywordStats(stats: Array<{ keyword: string; fetched: number }>): Array<{ keyword: string; fetched: number }> {
  const totals = new Map<string, number>();
  for (const stat of stats) totals.set(stat.keyword, (totals.get(stat.keyword) || 0) + stat.fetched);
  return [...totals].map(([keyword, fetched]) => ({ keyword, fetched }));
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
