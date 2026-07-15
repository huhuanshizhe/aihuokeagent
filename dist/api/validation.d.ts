import type { ScanOptions } from '../scan/scanner.js';
export declare class RequestValidationError extends Error {
    readonly details: string[];
    readonly statusCode = 400;
    readonly code = "INVALID_REQUEST";
    constructor(message: string, details?: string[]);
}
export interface PipelineRequest extends ScanOptions {
    enrichTopN: number;
    enrichmentConcurrency: number;
    skipDecisionMakers?: boolean;
}
export declare function parsePipelineRequest(body: unknown): PipelineRequest;
