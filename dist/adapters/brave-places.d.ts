import type { Adapter, AdapterConfig, HealthStatus, SearchQuery, SearchResult } from './types.js';
export interface BravePlacePlan {
    sourceKeyword: string;
    query: string;
    location: string;
    country: string;
    language: string;
    marketSegment: string;
}
export declare class BravePlacesAdapter implements Adapter {
    readonly code = "brave_places";
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
    private searchPlan;
    healthCheck(): Promise<HealthStatus>;
}
export declare function buildBravePlacePlans(query: SearchQuery): BravePlacePlan[];
