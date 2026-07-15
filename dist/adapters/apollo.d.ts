/**
 * Apollo Organization Search 适配器 - 精简版
 */
import type { Adapter, SearchQuery, SearchResult, HealthStatus, AdapterConfig } from './types.js';
export declare class ApolloAdapter implements Adapter {
    readonly code = "apollo";
    readonly channelType: "DIRECTORY";
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
    private normalize;
    private sizeLabel;
    healthCheck(): Promise<HealthStatus>;
}
