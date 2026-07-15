import type { IndustryPack, MarketPack, SourceCatalogEntry } from './types.js';
export declare class DiscoveryResourceRegistry {
    private rootDir;
    private markets;
    private industries;
    private sources;
    private loadedAt;
    constructor(rootDir?: string);
    reload(): void;
    listMarkets(): MarketPack[];
    listIndustries(): IndustryPack[];
    listSources(): SourceCatalogEntry[];
    getMarket(code: string): MarketPack | undefined;
    getIndustry(id: string): IndustryPack | undefined;
    getSource(code: string): SourceCatalogEntry | undefined;
    getLoadedAt(): string;
    findMarket(value?: string): MarketPack | undefined;
    findIndustry(value?: string, keywords?: string[]): IndustryPack | undefined;
}
export declare const resourceRegistry: DiscoveryResourceRegistry;
