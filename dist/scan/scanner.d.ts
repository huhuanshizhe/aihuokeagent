/**
 * 扫描引擎 - 精简版
 * 从 src/lib/radar/scan-engine.ts 提取，去除 Prisma 依赖
 * 使用 SQLite 存储结果
 */
import type { NormalizedCandidate } from '../adapters/types.js';
import type { DiscoveryResourcePlan } from '../resources/types.js';
export interface ScanOptions {
    keywords?: string[];
    countries?: string[];
    industry?: string;
    adapters?: string[];
    maxResults?: number;
    companyName?: string;
    companyIntro?: string;
    products?: string[];
    negativeKeywords?: string[];
}
export interface RejectedCandidateSummary {
    name: string;
    source: string;
    score: number;
    reasons: string[];
}
export interface ReviewCandidateSummary extends RejectedCandidateSummary {
    keyword?: string;
}
export interface ScanResult {
    runId: string;
    resourcePlan?: DiscoveryResourcePlan;
    totalFound: number;
    totalFetched: number;
    totalNew: number;
    totalRejected: number;
    totalQualified: number;
    totalReview: number;
    totalDeferred: number;
    errors: string[];
    warnings: string[];
    duration: number;
    adapterResults: Record<string, {
        fetched: number;
        found: number;
        new: number;
        rejected: number;
        qualified: number;
        review: number;
        deferred: number;
        providerFiltered: number;
        keywordStats: Array<{
            keyword: string;
            fetched: number;
        }>;
        warnings: string[];
    }>;
    rejectedSamples: RejectedCandidateSummary[];
    reviewSamples: ReviewCandidateSummary[];
}
export declare function runScan(options: ScanOptions): Promise<ScanResult>;
export declare function getScanResults(runId: string): NormalizedCandidate[];
export declare function getScanRun(runId: string): Record<string, unknown> | null;
export declare function listScanRuns(limit?: number): Array<Record<string, unknown>>;
