/**
 * Pipeline API 路由
 * POST /api/pipeline/run - SCAN → ENRICH 一键全流程
 */

import { Router } from 'express';
import { runScan, getScanResults } from '../scan/scanner.js';
import { runEnrich, type EnrichResult } from '../enrich/contact-engine.js';
import { db } from '../db.js';
import { selectCandidatesForEnrichment } from '../pipeline/candidate-utils.js';
import { parsePipelineRequest, RequestValidationError } from './validation.js';

export const pipelineRouter: Router = Router();

interface PipelineResult {
  scanResult: {
    runId: string;
    totalFetched: number;
    totalFound: number;
    totalNew: number;
    totalRejected: number;
    totalQualified: number;
    totalReview: number;
    errors: string[];
    duration: number;
    uniqueCandidates: number;
  };
  selection: {
    requested: number;
    selected: number;
    skipped: { nonCompany: number; missingId: number; belowLimit: number };
    candidates: Array<{ candidateId: string; companyName: string; score: number; reasons: string[] }>;
  };
  enrichResults: EnrichResult[];
  totalDuration: number;
}

// POST /api/pipeline/run - 全流程执行
pipelineRouter.post('/run', async (req, res) => {
  const startTime = Date.now();

  try {
    const options = parsePipelineRequest(req.body);

    console.log('[api/pipeline] Starting full pipeline...');

    // Step 1: SCAN
    console.log('[api/pipeline] Step 1/2: SCAN');
    const scanResult = await runScan(options);

    if (scanResult.totalFound === 0) {
      res.json({
        success: true,
        data: {
          scanResult: {
            runId: scanResult.runId,
            totalFetched: scanResult.totalFetched,
            totalFound: 0,
            totalNew: 0,
            totalRejected: scanResult.totalRejected,
            totalQualified: scanResult.totalQualified,
            totalReview: scanResult.totalReview,
            errors: scanResult.errors,
            duration: scanResult.duration,
            uniqueCandidates: 0,
          },
          selection: {
            requested: options.enrichTopN,
            selected: 0,
            skipped: { nonCompany: 0, missingId: 0, belowLimit: 0 },
            candidates: [],
          },
          enrichResults: [],
          totalDuration: Date.now() - startTime,
          message: 'Scan completed but no candidates found',
        } satisfies PipelineResult & { message: string },
      });
      return;
    }

    // Step 2: ENRICH (取前 N 个)
    console.log(`[api/pipeline] Step 2/2: ENRICH (top ${options.enrichTopN})`);
    const candidates = getScanResults(scanResult.runId);
    const selection = selectCandidatesForEnrichment(candidates, options.enrichTopN);
    const candidateIds = selection.selected.map(item => item.candidate.id as string);

    const enrichResults = await runEnrich({
      candidateIds,
      skipDecisionMakers: options.skipDecisionMakers,
      concurrency: options.enrichmentConcurrency,
    });

    const result: PipelineResult = {
      scanResult: {
        runId: scanResult.runId,
        totalFetched: scanResult.totalFetched,
        totalFound: scanResult.totalFound,
        totalNew: scanResult.totalNew,
        totalRejected: scanResult.totalRejected,
        totalQualified: scanResult.totalQualified,
        totalReview: scanResult.totalReview,
        errors: scanResult.errors,
        duration: scanResult.duration,
        uniqueCandidates: candidates.length,
      },
      selection: {
        requested: options.enrichTopN,
        selected: candidateIds.length,
        skipped: selection.skipped,
        candidates: selection.selected.map(item => ({
          candidateId: item.candidate.id as string,
          companyName: item.candidate.displayName,
          score: item.score,
          reasons: item.reasons,
        })),
      },
      enrichResults,
      totalDuration: Date.now() - startTime,
    };

    console.log(`[api/pipeline] Completed in ${result.totalDuration}ms`);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[api/pipeline] Error:', error);
    const isValidation = error instanceof RequestValidationError;
    res.status(isValidation ? error.statusCode : 500).json({
      success: false,
      error: {
        code: isValidation ? error.code : 'PIPELINE_FAILED',
        message: error instanceof Error ? error.message : String(error),
        ...(isValidation && error.details.length ? { details: error.details } : {}),
      },
    });
  }
});

// ==================== CRM 导出 ====================

interface CRMRecord {
  companyName: string;
  country: string | null;
  city: string | null;
  website: string | null;
  businessType: string | null;
  industry: string | null;
  products: string[];
  brands: string[];
  employeesCount: string | null;
  email: string | null;
  phone: string | null;
  isTargetCustomer: boolean;
  targetReason: string | null;
  score: number;
}

// GET /api/pipeline/crm/:runId - 导出 CRM 格式数据
pipelineRouter.get('/crm/:runId', (req, res) => {
  try {
    const { runId } = req.params;

    // 获取 candidates
    const candidates = getScanResults(runId);
    if (candidates.length === 0) {
      res.json({ success: false, error: 'No candidates found for this run' });
      return;
    }

    const crmRecords: CRMRecord[] = [];

    for (const c of candidates) {
      // 获取对应的 enrichment 数据
      const enrichment = c.id ? db.prepare(
        'SELECT * FROM enrichments WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(c.id) as Record<string, unknown> | undefined : undefined;

      const record: CRMRecord = {
        companyName: c.displayName,
        country: c.country || null,
        city: c.city || null,
        website: enrichment?.official_url as string || c.website || null,
        businessType: enrichment?.business_type as string || c.businessType || null,
        industry: c.industry || null,
        products: enrichment?.products ? JSON.parse(enrichment.products as string) : c.products || [],
        brands: enrichment?.brands ? JSON.parse(enrichment.brands as string) : c.brands || [],
        employeesCount: enrichment?.employees_count as string || c.employeesCount || null,
        email: enrichment?.emails ? JSON.parse(enrichment.emails as string)[0] || null : c.email || null,
        phone: enrichment?.phones ? JSON.parse(enrichment.phones as string)[0] || null : c.phone || null,
        isTargetCustomer: enrichment?.is_target_customer === 1 || c.isTargetCustomer || false,
        targetReason: enrichment?.target_reason as string || c.targetReason || null,
        score: Math.round((c.matchScore || 0) * 100),
      };

      crmRecords.push(record);
    }

    // 按 score 降序排序
    crmRecords.sort((a, b) => b.score - a.score);

    res.json({
      success: true,
      data: {
        runId,
        totalRecords: crmRecords.length,
        records: crmRecords,
      },
    });
  } catch (error) {
    console.error('[api/pipeline/crm] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
