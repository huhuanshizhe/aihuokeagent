/**
 * SCAN API 路由
 * POST /api/scan - 执行扫描
 * GET /api/scan/results - 查询扫描结果
 * GET /api/scan/runs - 列出扫描历史
 */

import { Router } from 'express';
import { runScan, getScanResults, getScanRun, listScanRuns, type ScanOptions } from '../scan/scanner.js';

export const scanRouter: Router = Router();

// POST /api/scan - 执行扫描
scanRouter.post('/', async (req, res) => {
  try {
    const options: ScanOptions = {
      keywords: req.body.keywords,
      countries: req.body.countries,
      industry: req.body.industry,
      adapters: req.body.adapters,
      maxResults: req.body.maxResults,
      companyName: req.body.companyName,
      companyIntro: req.body.companyIntro,
      products: req.body.products,
      negativeKeywords: req.body.negativeKeywords,
    };

    console.log('[api/scan] Starting scan with options:', JSON.stringify(options, null, 2));
    const result = await runScan(options);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[api/scan] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// GET /api/scan/results?runId=xxx - 查询某次扫描结果
scanRouter.get('/results', (req, res) => {
  try {
    const runId = req.query.runId as string;
    if (!runId) {
      res.status(400).json({ success: false, error: 'runId is required' });
      return;
    }

    const run = getScanRun(runId);
    if (!run) {
      res.status(404).json({ success: false, error: 'Scan run not found' });
      return;
    }

    const candidates = getScanResults(runId);

    res.json({
      success: true,
      data: {
        run,
        candidates,
      },
    });
  } catch (error) {
    console.error('[api/scan] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// GET /api/scan/runs - 列出扫描历史
scanRouter.get('/runs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const runs = listScanRuns(limit);

    res.json({
      success: true,
      data: runs,
    });
  } catch (error) {
    console.error('[api/scan] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
