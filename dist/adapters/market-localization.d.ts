import type { GeoViewport } from '../resources/types.js';
export type Viewport = GeoViewport;
export interface MarketCluster {
    name: string;
    localName: string;
    viewport: Viewport;
}
export interface MarketProfile {
    code: string;
    countryName: string;
    languageCode: string;
    uiLanguage: string;
    viewport: Viewport;
    clusters: MarketCluster[];
}
export declare function getMarketProfile(country?: string): MarketProfile | undefined;
export declare function localizeIndustrialKeyword(keyword: string, country?: string): string | undefined;
export declare function isSoutheastAsiaFocus(country?: string): boolean;
