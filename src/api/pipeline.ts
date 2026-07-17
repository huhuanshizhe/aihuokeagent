/**
 * Pipeline API 路由
 * POST /api/pipeline/run - SCAN → ENRICH 一键全流程
 */

import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { runScan, getScanResults } from '../scan/scanner.js';
import { runEnrich, type EnrichResult } from '../enrich/contact-engine.js';
import { db } from '../db.js';
import { enrichments } from '../db/schema.js';
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
    const candidates = await getScanResults(scanResult.runId);
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

function parseJsonArray(value: unknown): string[] {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

// GET /api/pipeline/crm/:runId - 导出 CRM 格式数据
pipelineRouter.get('/crm/:runId', async (req, res) => {
  try {
    const { runId } = req.params;

    const candidateList = await getScanResults(runId);
    if (candidateList.length === 0) {
      res.json({ success: false, error: 'No candidates found for this run' });
      return;
    }

    const crmRecords: CRMRecord[] = [];

    for (const c of candidateList) {
      const enrichmentRows = c.id
        ? await db.select().from(enrichments)
          .where(eq(enrichments.candidateId, c.id))
          .orderBy(desc(enrichments.createdAt))
          .limit(1)
        : [];
      const enrichment = enrichmentRows[0];

      const record: CRMRecord = {
        companyName: c.displayName,
        country: c.country || null,
        city: c.city || null,
        website: enrichment?.officialUrl || c.website || null,
        businessType: enrichment?.businessType || c.businessType || null,
        industry: c.industry || null,
        products: enrichment?.products ? parseJsonArray(enrichment.products) : c.products || [],
        brands: enrichment?.brands ? parseJsonArray(enrichment.brands) : c.brands || [],
        employeesCount: enrichment?.employeesCount || c.employeesCount || null,
        email: enrichment?.emails ? parseJsonArray(enrichment.emails)[0] || null : c.email || null,
        phone: enrichment?.phones ? parseJsonArray(enrichment.phones)[0] || null : c.phone || null,
        isTargetCustomer: enrichment?.isTargetCustomer === true || c.isTargetCustomer || false,
        targetReason: enrichment?.targetReason || c.targetReason || null,
        score: Math.round((c.matchScore || 0) * 100),
      };

      crmRecords.push(record);
    }

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
