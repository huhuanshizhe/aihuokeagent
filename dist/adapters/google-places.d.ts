/**
 * Google Places 适配器 - 精简版
 * 从 src/lib/radar/adapters/google-places.ts 提取
 */
import type { Adapter, SearchQuery, SearchResult, HealthStatus, AdapterConfig } from './types.js';
import { type Viewport } from './market-localization.js';
export declare class GooglePlacesAdapter implements Adapter {
    readonly code = "google_places";
    readonly channelType: "MAPS";
    readonly features: {
        supportsKeywordSearch: boolean;
        supportsRegionFilter: boolean;
        supportsPagination: boolean;
        supportsDetails: boolean;
        maxResultsPerQuery: number;
    };
    private apiKey;
    private timeout;
    constructor(cfg: AdapterConfig);
    search(query: SearchQuery): Promise<SearchResult>;
    private textSearch;
    private normalize;
    private inferIndustry;
    getDetails(externalId: string): Promise<{
        externalId: string;
        phone?: string;
        website?: string;
        address?: string;
        description?: string;
        additionalInfo?: Record<string, unknown>;
    } | null>;
    healthCheck(): Promise<HealthStatus>;
}
export interface GoogleSearchPlan {
    sourceKeyword: string;
    searchText: string;
    languageCode: string;
    regionCode?: string;
    viewport?: Viewport;
    marketSegment: string;
}
export declare function buildGoogleSearchPlans(query: SearchQuery): GoogleSearchPlan[];
