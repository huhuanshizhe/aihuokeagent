import type { Adapter, HealthStatus, SearchQuery, SearchResult } from './types.js';
export interface ThaiFactoryRecord {
    registrationId: string;
    factoryName: string;
    operatorName: string;
    activity: string;
    address: string;
    district: string;
    province: string;
    postalCode: string;
    isicCode: string;
    totalWorkers?: number;
    latitude?: number;
    longitude?: number;
    estate?: string;
    updatedAt?: string;
}
export interface RankedThaiFactory {
    record: ThaiFactoryRecord;
    score: number;
    matchedKeywords: string[];
    matchedTerms: string[];
}
export declare class ThailandFactoryAdapter implements Adapter {
    readonly code = "thailand_factory";
    readonly channelType: "DIRECTORY";
    readonly features: {
        supportsKeywordSearch: boolean;
        supportsRegionFilter: boolean;
        supportsPagination: boolean;
        supportsDetails: boolean;
        maxResultsPerQuery: number;
    };
    search(query: SearchQuery): Promise<SearchResult>;
    healthCheck(): Promise<HealthStatus>;
}
export declare function parseThaiFactoryCsv(csv: string): ThaiFactoryRecord[];
export declare function rankThaiFactories(records: ThaiFactoryRecord[], keywords: string[]): RankedThaiFactory[];
