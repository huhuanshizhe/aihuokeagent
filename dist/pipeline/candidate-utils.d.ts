import type { NormalizedCandidate } from '../adapters/types.js';
export interface CandidateRank {
    candidate: NormalizedCandidate;
    score: number;
    reasons: string[];
}
export interface CandidateSelection {
    selected: CandidateRank[];
    skipped: {
        nonCompany: number;
        missingId: number;
        belowLimit: number;
    };
}
export declare function normalizeDomain(value?: string): string | undefined;
/** Stable cross-provider identity used for conservative company deduplication. */
export declare function buildCandidateIdentity(candidate: Pick<NormalizedCandidate, 'candidateType' | 'website' | 'displayName' | 'country'>): string | undefined;
export declare function rankCandidateForEnrichment(candidate: NormalizedCandidate): CandidateRank;
export declare function selectCandidatesForEnrichment(candidates: NormalizedCandidate[], limit: number): CandidateSelection;
