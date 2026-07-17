/**
 * Public scan API for external clients (e.g. vertax-local).
 * POST /api/public/scan — single keyword + country; auto adapters; maxResults=20.
 *
 * Response is a slim summary. Fetch companies via GET /api/scan/results?runId=...
 * immediately after success (scan is synchronous; no polling).
 */

import { Router } from 'express';
import { runScan } from '../scan/scanner.js';
import {
  parsePublicScanRequest,
  publicScanToScanOptions,
  RequestValidationError,
} from './validation.js';

export const publicScanRouter: Router = Router();

publicScanRouter.post('/', async (req, res) => {
  try {
    const parsed = parsePublicScanRequest(req.body);
    const options = publicScanToScanOptions(parsed);
    console.log('[api/public/scan] Starting scan:', JSON.stringify({
      keyword: parsed.keyword,
      country: parsed.country,
      countryCode: parsed.countryCode,
      maxResults: parsed.maxResults,
    }));
    const result = await runScan(options);
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
    console.error('[api/public/scan] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
