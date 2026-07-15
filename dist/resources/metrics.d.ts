import type { DiscoveryResourcePlan } from './types.js';
export interface SourceRunMetricInput {
    runId: string;
    sourceCode: string;
    countryCode?: string;
    industryPackId?: string;
    status: 'completed' | 'failed';
    fetched: number;
    found: number;
    qualified: number;
    review: number;
    rejected: number;
    durationMs: number;
    errorCode?: string;
}
export interface SourceQualityMetric {
    sourceCode: string;
    countryCode?: string;
    industryPackId?: string;
    runs: number;
    fetched: number;
    found: number;
    qualified: number;
    review: number;
    rejected: number;
    avgDurationMs: number;
    qualificationRate: number;
    retentionRate: number;
}
export declare function recordSourceRun(input: SourceRunMetricInput): void;
export declare function getSourceQualityMetrics(filters?: {
    countryCode?: string;
    industryPackId?: string;
}): SourceQualityMetric[];
export declare function applyHistoricalPerformance(plan: DiscoveryResourcePlan): DiscoveryResourcePlan;
