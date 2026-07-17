/**
 * SCAN API 路由
 * POST /api/scan - 执行扫描，一次返回摘要 + candidates
 * GET /api/scan/results - 按 runId 回看历史结果（可选）
 * GET /api/scan/runs - 列出扫描历史
 */

import { Router } from 'express';
import { runScan, getScanResults, getScanRun, listScanRuns, type ScanOptions } from '../scan/scanner.js';

export const scanRouter: Router = Router();

// POST /api/scan - 执行扫描（同步，直接返回企业列表）
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
    const candidates = await getScanResults(result.runId);

    res.json({
      success: true,
      data: {
        ...result,
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

// GET /api/scan/results?runId=xxx - 回看某次历史扫描结果
scanRouter.get('/results', async (req, res) => {
  try {
    const runId = req.query.runId as string;
    if (!runId) {
      res.status(400).json({ success: false, error: 'runId is required' });
      return;
    }

    const run = await getScanRun(runId);
    if (!run) {
      res.status(404).json({ success: false, error: 'Scan run not found' });
      return;
    }

    const candidates = await getScanResults(runId);

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
scanRouter.get('/runs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const runs = await listScanRuns(limit);

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
