export type EvidenceSource = 'discovery' | 'official_website' | 'exa' | 'hunter' | 'firecrawl' | 'ai_profile';
export interface FieldEvidence {
    field: string;
    value: string;
    source: EvidenceSource;
    sourceUrl?: string;
    confidence: number;
    observedAt: string;
}
export interface FieldConflict {
    field: string;
    values: Array<{
        value: string;
        sources: EvidenceSource[];
        confidence: number;
    }>;
    resolvedValue: string;
    reason: string;
}
export declare function addEvidence(target: FieldEvidence[], field: string, value: string | undefined, source: EvidenceSource, confidence: number, sourceUrl?: string): void;
export declare function resolveEvidence(field: string, evidence: FieldEvidence[]): {
    value?: string;
    conflict?: FieldConflict;
};
