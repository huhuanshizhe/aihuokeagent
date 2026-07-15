import type { NormalizedCandidate, SearchQuery } from '../adapters/types.js';
export interface QualificationResult {
    accepted: boolean;
    tier: 'qualified' | 'review' | 'rejected';
    candidate: NormalizedCandidate;
    score: number;
    reasons: string[];
    rejectionReasons: string[];
}
export declare function qualifyDiscoveredCandidate(candidate: NormalizedCandidate, query: SearchQuery): QualificationResult;
