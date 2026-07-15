/**
 * 联系人情报引擎 - 精简版
 * 从 src/lib/osint/contact-enrichment/enrichment-engine.ts 提取核心逻辑
 */
import { type DecisionMaker } from './decision-maker.js';
import { type FieldConflict, type FieldEvidence } from './evidence.js';
export interface EnrichOptions {
    candidateIds?: string[];
    companyName?: string;
    domain?: string;
    country?: string;
    industry?: string;
    skipDecisionMakers?: boolean;
    concurrency?: number;
    depth?: 'standard' | 'deep';
}
export interface EnrichmentStage {
    status: 'completed' | 'skipped' | 'failed';
    duration: number;
    reason?: string;
}
export interface EnrichResult {
    enrichmentId: string;
    candidateId?: string;
    companyName: string;
    country?: string;
    domain?: string;
    website?: string;
    linkedInUrl?: string;
    emails: string[];
    phones: string[];
    decisionMakers: DecisionMaker[];
    description?: string;
    businessType?: string;
    products?: string[];
    brands?: string[];
    employeesCount?: string;
    isTargetCustomer?: boolean;
    targetReason?: string;
    confidenceScore: number;
    status: 'completed' | 'partial' | 'failed';
    errors: string[];
    stages: Record<string, EnrichmentStage>;
    fieldEvidence: FieldEvidence[];
    conflicts: FieldConflict[];
    informationGaps: string[];
    recommendedChannel: 'email' | 'phone' | 'linkedin' | 'contact_form' | 'research';
}
export declare function runEnrich(options: EnrichOptions): Promise<EnrichResult[]>;
export declare function getEnrichment(enrichmentId: string): Record<string, unknown> | null;
export declare function listEnrichments(limit?: number): Array<Record<string, unknown>>;
export declare function getEnrichmentsByCandidate(candidateId: string): Array<Record<string, unknown>>;
