export interface GeoPoint {
    latitude: number;
    longitude: number;
}
export interface GeoViewport {
    low: GeoPoint;
    high: GeoPoint;
}
export interface MarketClusterResource {
    id: string;
    name: string;
    localName: string;
    viewport: GeoViewport;
    tags?: string[];
}
export interface MarketPack {
    id: string;
    version: string;
    status: 'active' | 'draft' | 'deprecated';
    countryCode: string;
    countryName: string;
    region: string;
    aliases: string[];
    languages: Array<{
        code: string;
        name: string;
        priority: number;
    }>;
    viewport: GeoViewport;
    clusters: MarketClusterResource[];
    localization: {
        phrases: Array<{
            pattern: string;
            value: string;
            language: string;
        }>;
    };
    sourceCodes: string[];
    updatedAt: string;
}
export interface IndustryPack {
    id: string;
    version: string;
    status: 'active' | 'draft' | 'deprecated';
    name: string;
    aliases: string[];
    entityType: string;
    keywords: string[];
    negativeKeywords: string[];
    localTerms: Record<string, string[]>;
    sourceTypes: string[];
    qualificationSignals: string[];
    updatedAt: string;
}
export interface SourceCatalogEntry {
    code: string;
    version: string;
    name: string;
    status: 'active' | 'research' | 'disabled';
    adapterCode?: string;
    sourceType: string;
    authority: 'official' | 'commercial' | 'open_web' | 'association';
    countries: string[];
    industries: string[];
    fields: string[];
    requiresApiKey: boolean;
    costModel: string;
    refreshPolicy: string;
    cachePolicy: string;
    qualityBaseline: number;
    termsUrl?: string;
    notes?: string;
}
export interface DiscoveryPlanInput {
    countries: string[];
    industry?: string;
    keywords?: string[];
    negativeKeywords?: string[];
}
export interface PlannedSource {
    sourceCode: string;
    adapterCode?: string;
    score: number;
    reasons: string[];
    status: SourceCatalogEntry['status'];
}
export interface DiscoveryResourcePlan {
    version: string;
    countryCode?: string;
    marketPackId?: string;
    marketPackVersion?: string;
    industryPackId?: string;
    industryPackVersion?: string;
    keywords: string[];
    negativeKeywords: string[];
    recommendedAdapters: string[];
    sources: PlannedSource[];
    clusters: MarketClusterResource[];
    warnings: string[];
    generatedAt: string;
}
