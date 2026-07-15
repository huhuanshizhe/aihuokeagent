import type { ScanOptions } from './scanner.js';
export declare function normalizeDiscoveryOptions(options: ScanOptions): ScanOptions;
/** Keep resource-pack keyword expansion useful without multiplying paid API calls. */
export declare function getProviderQueryBudget(maxResults?: number, keywordCount?: number): number;
