import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
export function extractRequestApiKey(authorization, headerKey) {
    if (headerKey?.trim())
        return headerKey.trim();
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || undefined;
}
export function apiKeyAuth(req, res, next) {
    // Local development remains convenient when SERVICE_API_KEY is unset.
    // Production deployments must configure it (the Docker image enforces this in docs/health checks).
    if (!config.service.apiKey) {
        next();
        return;
    }
    const supplied = extractRequestApiKey(req.header('authorization'), req.header('x-api-key'));
    if (!supplied || !safeEqual(supplied, config.service.apiKey)) {
        res.status(401).json({ success: false, error: 'Unauthorized', code: 'INVALID_API_KEY' });
        return;
    }
    next();
}
function safeEqual(left, right) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}
//# sourceMappingURL=auth.js.map