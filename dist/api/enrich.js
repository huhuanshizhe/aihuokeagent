/**
 * ENRICH API 路由
 * POST /api/enrich - 执行情报补全
 * GET /api/enrich/results - 查询补全结果
 */
import { Router } from 'express';
import { runEnrich, getEnrichment, listEnrichments, getEnrichmentsByCandidate } from '../enrich/contact-engine.js';
export const enrichRouter = Router();
// POST /api/enrich - 执行情报补全
enrichRouter.post('/', async (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            res.status(400).json({ success: false, error: 'Request body must be a JSON object' });
            return;
        }
        for (const field of ['companyName', 'domain', 'country', 'industry']) {
            if (req.body[field] !== undefined && typeof req.body[field] !== 'string') {
                res.status(400).json({ success: false, error: `${field} must be a string` });
                return;
            }
            if (typeof req.body[field] === 'string' && req.body[field].length > (field === 'domain' ? 500 : 200)) {
                res.status(400).json({ success: false, error: `${field} is too long` });
                return;
            }
        }
        if (req.body.candidateIds !== undefined && (!Array.isArray(req.body.candidateIds) || req.body.candidateIds.some((id) => typeof id !== 'string'))) {
            res.status(400).json({ success: false, error: 'candidateIds must be an array of strings' });
            return;
        }
        const candidateIds = req.body.candidateIds
            ? [...new Set(req.body.candidateIds.map(id => id.trim()).filter(Boolean))]
            : undefined;
        if ((candidateIds?.length || 0) > 50) {
            res.status(400).json({ success: false, error: 'A batch supports at most 50 candidateIds' });
            return;
        }
        const concurrency = req.body.concurrency === undefined ? 3 : req.body.concurrency;
        if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
            res.status(400).json({ success: false, error: 'concurrency must be an integer between 1 and 8' });
            return;
        }
        const depth = req.body.depth === undefined ? 'standard' : req.body.depth;
        if (!['standard', 'deep'].includes(depth)) {
            res.status(400).json({ success: false, error: 'depth must be standard or deep' });
            return;
        }
        const options = {
            candidateIds,
            companyName: req.body.companyName,
            domain: req.body.domain,
            country: req.body.country,
            industry: req.body.industry,
            skipDecisionMakers: req.body.skipDecisionMakers,
            concurrency,
            depth,
        };
        if (!options.candidateIds?.length && !options.companyName) {
            res.status(400).json({ success: false, error: 'candidateIds or companyName is required' });
            return;
        }
        console.log('[api/enrich] Starting enrichment:', JSON.stringify(options, null, 2));
        const results = await runEnrich(options);
        res.json({
            success: true,
            data: results,
        });
    }
    catch (error) {
        console.error('[api/enrich] Error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
// GET /api/enrich/results?enrichmentId=xxx - 查询单个补全结果
enrichRouter.get('/results', (req, res) => {
    try {
        const { enrichmentId, candidateId, limit } = req.query;
        if (enrichmentId) {
            const result = getEnrichment(enrichmentId);
            if (!result) {
                res.status(404).json({ success: false, error: 'Enrichment not found' });
                return;
            }
            res.json({ success: true, data: result });
            return;
        }
        if (candidateId) {
            const results = getEnrichmentsByCandidate(candidateId);
            res.json({ success: true, data: results });
            return;
        }
        // 列出所有
        const allResults = listEnrichments(parseInt(limit, 10) || 50);
        res.json({ success: true, data: allResults });
    }
    catch (error) {
        console.error('[api/enrich] Error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
//# sourceMappingURL=enrich.js.map