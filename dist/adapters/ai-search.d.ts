/**
 * AI Search 适配器 - 精简版
 * SerpAPI + Brave Search + AI 解析
 */
import type { Adapter, SearchQuery, SearchResult, HealthStatus, AdapterConfig } from './types.js';
export declare class AISearchAdapter implements Adapter {
    readonly code = "ai_search";
    readonly channelType: "SEARCH";
    readonly features: {
        supportsKeywordSearch: boolean;
        supportsRegionFilter: boolean;
        supportsPagination: boolean;
        supportsDetails: boolean;
        maxResultsPerQuery: number;
    };
    private timeout;
    constructor(cfg: AdapterConfig);
    search(query: SearchQuery): Promise<SearchResult>;
    private generateQueries;
    private applySearchConstraints;
    private executeSearches;
    private parseResults;
    private parseFallbackCompanies;
    private hashStr;
    healthCheck(): Promise<HealthStatus>;
}
