/**
 * Hunter.io 适配器 - 精简版
 * 邮箱域名搜索 + 验证
 */
import type { Adapter, SearchQuery, SearchResult, HealthStatus, AdapterConfig } from './types.js';
export declare class HunterAdapter implements Adapter {
    readonly code = "hunter";
    readonly channelType: "DIRECTORY";
    readonly features: {
        supportsKeywordSearch: boolean;
        supportsRegionFilter: boolean;
        supportsPagination: boolean;
        supportsDetails: boolean;
        maxResultsPerQuery: number;
    };
    private apiKey;
    private baseUrl;
    private timeout;
    constructor(cfg: AdapterConfig);
    search(query: SearchQuery): Promise<SearchResult>;
    verifyEmail(email: string): Promise<{
        valid: boolean;
        status: string;
        score: number;
    }>;
    private normalize;
    healthCheck(): Promise<HealthStatus>;
}
