import { getAllAdapterCodes, getAdapter } from '../adapters/registry.js';
export class RequestValidationError extends Error {
    details;
    statusCode = 400;
    code = 'INVALID_REQUEST';
    constructor(message, details = []) {
        super(message);
        this.details = details;
        this.name = 'RequestValidationError';
    }
}
function stringArray(value, field) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new RequestValidationError(`${field} must be an array of strings`);
    }
    const normalized = [...new Set(value.map(item => item.trim()).filter(Boolean))];
    return normalized.length ? normalized : undefined;
}
function boundedInteger(value, fallback, min, max, field) {
    if (value === undefined)
        return fallback;
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new RequestValidationError(`${field} must be an integer between ${min} and ${max}`);
    }
    return value;
}
export function parsePipelineRequest(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new RequestValidationError('Request body must be a JSON object');
    }
    const input = body;
    const keywords = stringArray(input.keywords, 'keywords');
    const products = stringArray(input.products, 'products');
    const countries = stringArray(input.countries, 'countries');
    const adapters = stringArray(input.adapters, 'adapters');
    const negativeKeywords = stringArray(input.negativeKeywords, 'negativeKeywords');
    const companyName = typeof input.companyName === 'string' ? input.companyName.trim() : undefined;
    if (!keywords?.length && !companyName) {
        throw new RequestValidationError('Provide keywords or companyName so discovery can build a search strategy');
    }
    if (adapters?.length) {
        const known = new Set(getAllAdapterCodes());
        const unknown = adapters.filter(code => !known.has(code));
        const unsupported = adapters.filter(code => known.has(code) && !getAdapter(code).features.supportsKeywordSearch);
        const details = [
            ...unknown.map(code => `Unknown adapter: ${code}`),
            ...unsupported.map(code => `Adapter does not support discovery search: ${code}`),
        ];
        if (details.length)
            throw new RequestValidationError('Invalid discovery adapters', details);
    }
    return {
        keywords,
        countries,
        adapters,
        products,
        negativeKeywords,
        companyName,
        companyIntro: typeof input.companyIntro === 'string' ? input.companyIntro.trim() : undefined,
        industry: typeof input.industry === 'string' ? input.industry.trim() : undefined,
        maxResults: boundedInteger(input.maxResults, 25, 1, 100, 'maxResults'),
        enrichTopN: boundedInteger(input.enrichTopN, 10, 1, 50, 'enrichTopN'),
        enrichmentConcurrency: boundedInteger(input.enrichmentConcurrency, 3, 1, 8, 'enrichmentConcurrency'),
        skipDecisionMakers: input.skipDecisionMakers === true,
    };
}
//# sourceMappingURL=validation.js.map