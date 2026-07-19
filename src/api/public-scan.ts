/**
 * Public scan API.
 * POST /api/public/scan — single keyword + country; auto adapters; maxResults=20.
 * GET  /api/public/scan/logs — paginated call audit list (slim projection).
 * GET  /api/public/scan/logs/:id — call audit detail.
 */

import { Router } from 'express';
import { getScanResults, runScan } from '../scan/scanner.js';
import {
  parsePublicScanRequest,
  publicScanToScanOptions,
  RequestValidationError,
} from './validation.js';
import {
  getPublicScanLogById,
  listPublicScanLogs,
  safeRecordPublicScanCall,
} from './public-scan-logs.js';

export const publicScanRouter: Router = Router();

publicScanRouter.get('/logs', async (req, res) => {
  try {
    const page = req.query.page ? Number(req.query.page) : 1;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20;
    const data = await listPublicScanLogs({
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 20,
      keyword: typeof req.query.keyword === 'string' ? req.query.keyword : undefined,
      country: typeof req.query.country === 'string' ? req.query.country : undefined,
      user: typeof req.query.user === 'string' ? req.query.user : undefined,
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('[api/public/scan/logs] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

publicScanRouter.get('/logs/:id', async (req, res) => {
  try {
    const row = await getPublicScanLogById(req.params.id);
    if (!row) {
      res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
      return;
    }
    res.json({ success: true, data: row });
  } catch (error) {
    console.error('[api/public/scan/logs/:id] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

publicScanRouter.post('/', async (req, res) => {
  let parsedKeyword = '';
  let parsedCountry = '';
  let parsedCountryCode = '';
  let clientContext: Record<string, unknown> | undefined;

  try {
    const parsed = parsePublicScanRequest(req.body);
    parsedKeyword = parsed.keyword;
    parsedCountry = parsed.country;
    parsedCountryCode = parsed.countryCode;
    clientContext = parsed.clientContext;

    const options = publicScanToScanOptions(parsed);
    console.log('[api/public/scan] Starting scan:', JSON.stringify({
      keyword: parsed.keyword,
      country: parsed.country,
      countryCode: parsed.countryCode,
      maxResults: parsed.maxResults,
      hasClientContext: Boolean(parsed.clientContext),
      clientApp: parsed.clientContext?.clientApp,
      userId: parsed.clientContext?.userId,
      discoveryRunId: parsed.clientContext?.discoveryRunId,
    }));
    const result = await runScan(options);
    const candidates = await getScanResults(result.runId);

    await safeRecordPublicScanCall({
      runId: result.runId,
      keyword: parsed.keyword,
      country: parsed.country,
      countryCode: parsed.countryCode,
      resultCount: candidates.length,
      totalQualified: result.totalQualified,
      totalReview: result.totalReview,
      durationMs: result.duration,
      success: true,
      clientContext: parsed.clientContext,
    });

    res.json({
      success: true,
      data: {
        runId: result.runId,
        duration: result.duration,
        totalFetched: result.totalFetched,
        totalFound: result.totalFound,
        totalNew: result.totalNew,
        totalQualified: result.totalQualified,
        totalReview: result.totalReview,
        totalRejected: result.totalRejected,
        errors: result.errors,
        warnings: result.warnings,
        candidates,
        acceptedClientContext: Boolean(parsed.clientContext),
      },
    });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
        code: error.code,
        details: error.details.length ? error.details : undefined,
      });
      return;
    }

    if (parsedKeyword || parsedCountry) {
      await safeRecordPublicScanCall({
        keyword: parsedKeyword || '(unknown)',
        country: parsedCountry || '(unknown)',
        countryCode: parsedCountryCode || null,
        resultCount: 0,
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        clientContext,
      });
    }

    console.error('[api/public/scan] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
