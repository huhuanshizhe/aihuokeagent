/**
 * 扫描引擎
 * Neon PostgreSQL + Drizzle
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { db } from '../db.js';
import {
  candidates,
  candidateSources,
  scanRunCandidates,
  scanRuns,
} from '../db/schema.js';
import { getAdapter, getDefaultDiscoveryAdapterCodes } from '../adapters/registry.js';
import { generateKeywords } from './keyword-gen.js';
import type { SearchQuery, NormalizedCandidate } from '../adapters/types.js';
import { buildCandidateIdentity } from '../pipeline/candidate-utils.js';
import { getProviderQueryBudget, normalizeDiscoveryOptions } from './discovery-query.js';
import { qualifyDiscoveredCandidate } from './qualifier.js';
import { buildDiscoveryResourcePlan } from '../resources/planner.js';
import { applyHistoricalPerformanceAsync, recordSourceRun } from '../resources/metrics.js';
import type { DiscoveryResourcePlan } from '../resources/types.js';

export interface ScanOptions {
  keywords?: string[];
  countries?: string[];
  industry?: string;
  adapters?: string[];
  maxResults?: number;
  companyName?: string;
  companyIntro?: string;
  products?: string[];
  negativeKeywords?: string[];
}

export interface RejectedCandidateSummary {
  name: string;
  source: string;
  score: number;
  reasons: string[];
}

export interface ReviewCandidateSummary extends RejectedCandidateSummary {
  keyword?: string;
}

export interface ScanResult {
  runId: string;
  resourcePlan?: DiscoveryResourcePlan;
  totalFound: number;
  totalFetched: number;
  totalNew: number;
  totalRejected: number;
  totalQualified: number;
  totalReview: number;
  totalDeferred: number;
  errors: string[];
  warnings: string[];
  duration: number;
  adapterResults: Record<string, {
    fetched: number; found: number; new: number; rejected: number;
    qualified: number; review: number; deferred: number;
    providerFiltered: number;
    keywordStats: Array<{ keyword: string; fetched: number }>;
    warnings: string[];
  }>;
  rejectedSamples: RejectedCandidateSummary[];
  reviewSamples: ReviewCandidateSummary[];
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function runScan(options: ScanOptions): Promise<ScanResult> {
  options = normalizeDiscoveryOptions(options);
  const runId = randomUUID();
  const startTime = Date.now();
  const errors: string[] = [];
  const adapterResults: ScanResult['adapterResults'] = {};
  const rejectedSamples: RejectedCandidateSummary[] = [];
  const reviewSamples: ReviewCandidateSummary[] = [];
  let resourcePlan: DiscoveryResourcePlan | undefined;

  if ((options.keywords?.length || 0) > 20) {
    throw new Error('A discovery run supports at most 20 keywords. Split larger strategies into multiple runs.');
  }

  await db.insert(scanRuns).values({
    id: runId,
    keywords: JSON.stringify(options.keywords || []),
    countries: JSON.stringify(options.countries || []),
    industry: options.industry || null,
    status: 'running',
    startedAt: nowIso(),
  });

  try {
    let keywords = options.keywords || [];
    if (keywords.length === 0 && options.companyName) {
      console.log('[scanner] No keywords provided, generating with AI...');
      const generated = await generateKeywords(
        {
          companyName: options.companyName,
          companyIntro: options.companyIntro,
          products: options.products,
          targetIndustries: options.industry ? [options.industry] : undefined,
        },
        options.countries || [],
        { mode: 'initial' },
      );
      keywords = generated.map(k => k.keyword);
      console.log(`[scanner] AI generated ${keywords.length} keywords`);
    }

    if (keywords.length === 0) {
      throw new Error('No keywords provided and AI generation failed');
    }

    resourcePlan = await applyHistoricalPerformanceAsync(buildDiscoveryResourcePlan({
      countries: options.countries || [],
      industry: options.industry,
      keywords,
      negativeKeywords: options.negativeKeywords,
    }));
    keywords = resourcePlan.keywords.length ? resourcePlan.keywords : keywords;
    options.negativeKeywords = resourcePlan.negativeKeywords;

    await db.update(scanRuns).set({
      keywords: JSON.stringify(keywords),
      diagnostics: JSON.stringify({ resourcePlan }),
    }).where(eq(scanRuns.id, runId));

    const configuredDefaults = getDefaultDiscoveryAdapterCodes(options.countries);
    const plannedConfigured = resourcePlan.recommendedAdapters.filter(code => configuredDefaults.includes(code));
    const adapterCodes = options.adapters?.length
      ? options.adapters
      : [...plannedConfigured, ...configuredDefaults.filter(code => !plannedConfigured.includes(code))];
    if (adapterCodes.length === 0) {
      throw new Error('No discovery provider is configured. Configure Google Places, Apollo, SerpAPI, Brave Search, or select an official market registry.');
    }

    await Promise.all(adapterCodes.map(async adapterCode => {
      try {
        const adapter = getAdapter(adapterCode);
        if (!adapter.features.supportsKeywordSearch) {
          throw new Error('Adapter does not support keyword discovery');
        }
        const query: SearchQuery = {
          keywords,
          countries: options.countries,
          industry: options.industry,
          maxResults: options.maxResults,
          maxQueries: getProviderQueryBudget(options.maxResults, keywords.length),
          excludeKeywords: options.negativeKeywords,
        };

        console.log(`[scanner] Running adapter: ${adapterCode}`);
        const result = await adapter.search(query);

        const items = result.items;
        const rawFetched = result.metadata.rawFetched ?? items.length;
        const providerFiltered = Math.max(0, rawFetched - items.length);
        const qualified = items.map(item => qualifyDiscoveredCandidate(item, query));
        const eligible = qualified
          .filter(item => item.tier !== 'rejected')
          .sort((a, b) => b.score - a.score || a.candidate.displayName.localeCompare(b.candidate.displayName));
        const selected = eligible.slice(0, options.maxResults || adapter.features.maxResultsPerQuery);
        const deferred = eligible.slice(selected.length);
        const rejected = qualified.filter(item => !item.accepted);
        let newCount = 0;
        for (const item of selected) {
          const upserted = await upsertCandidate(runId, adapterCode, item.candidate);
          if (upserted.isNew) newCount++;
        }

        for (const item of rejected.slice(0, 5)) {
          rejectedSamples.push({
            name: item.candidate.displayName,
            source: adapterCode,
            score: item.score,
            reasons: item.rejectionReasons,
          });
        }

        for (const item of selected.filter(item => item.tier === 'review').slice(0, 5)) {
          reviewSamples.push({
            name: item.candidate.displayName,
            source: adapterCode,
            score: item.score,
            reasons: item.candidate.qualificationReasons || [],
            keyword: typeof item.candidate.rawData?.searchKeyword === 'string'
              ? item.candidate.rawData.searchKeyword
              : undefined,
          });
        }

        adapterResults[adapterCode] = {
          fetched: rawFetched,
          found: selected.length,
          new: newCount,
          rejected: rejected.length + providerFiltered,
          qualified: selected.filter(item => item.tier === 'qualified').length,
          review: selected.filter(item => item.tier === 'review').length,
          deferred: deferred.length,
          providerFiltered,
          keywordStats: result.metadata.keywordStats || [],
          warnings: result.metadata.warnings || [],
        };
        await recordSourceRun({
          runId,
          sourceCode: adapterCode,
          countryCode: resourcePlan?.countryCode,
          industryPackId: resourcePlan?.industryPackId,
          status: 'completed',
          fetched: rawFetched,
          found: selected.length,
          qualified: adapterResults[adapterCode].qualified,
          review: adapterResults[adapterCode].review,
          rejected: adapterResults[adapterCode].rejected,
          durationMs: result.metadata.duration,
        });
        console.log(`[scanner] ${adapterCode}: fetched ${rawFetched}, qualified ${adapterResults[adapterCode].qualified}, review ${adapterResults[adapterCode].review}, rejected ${adapterResults[adapterCode].rejected}, deferred ${deferred.length}, new ${newCount}`);
      } catch (e) {
        const errMsg = `[${adapterCode}] ${e instanceof Error ? e.message : String(e)}`;
        errors.push(errMsg);
        adapterResults[adapterCode] = {
          fetched: 0, found: 0, new: 0, rejected: 0,
          qualified: 0, review: 0, deferred: 0, providerFiltered: 0, keywordStats: [], warnings: [],
        };
        await recordSourceRun({
          runId,
          sourceCode: adapterCode,
          countryCode: resourcePlan?.countryCode,
          industryPackId: resourcePlan?.industryPackId,
          status: 'failed',
          fetched: 0,
          found: 0,
          qualified: 0,
          review: 0,
          rejected: 0,
          durationMs: 0,
          errorCode: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
        });
        console.error(`[scanner] ${adapterCode} failed:`, e);
      }
    }));

    const totalFound = Object.values(adapterResults).reduce((sum, r) => sum + r.found, 0);
    const totalFetched = Object.values(adapterResults).reduce((sum, r) => sum + r.fetched, 0);
    const totalNew = Object.values(adapterResults).reduce((sum, r) => sum + r.new, 0);
    const totalRejected = Object.values(adapterResults).reduce((sum, r) => sum + r.rejected, 0);
    const totalQualified = Object.values(adapterResults).reduce((sum, r) => sum + r.qualified, 0);
    const totalReview = Object.values(adapterResults).reduce((sum, r) => sum + r.review, 0);
    const totalDeferred = Object.values(adapterResults).reduce((sum, r) => sum + r.deferred, 0);
    const warnings = Object.entries(adapterResults).flatMap(([adapter, result]) =>
      result.warnings.map(warning => `[${adapter}] ${warning}`),
    );

    await db.update(scanRuns).set({
      status: 'completed',
      totalFetched,
      totalFound,
      totalNew,
      totalRejected,
      totalQualified,
      totalReview,
      totalDeferred,
      errors: JSON.stringify(errors),
      diagnostics: JSON.stringify({ resourcePlan, adapterResults, warnings, rejectedSamples, reviewSamples }),
      completedAt: nowIso(),
    }).where(eq(scanRuns.id, runId));

    return {
      runId,
      resourcePlan,
      totalFetched,
      totalFound,
      totalNew,
      totalRejected,
      totalQualified,
      totalReview,
      totalDeferred,
      errors,
      warnings,
      duration: Date.now() - startTime,
      adapterResults,
      rejectedSamples,
      reviewSamples,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    errors.push(errMsg);
    await db.update(scanRuns).set({
      status: 'failed',
      errors: JSON.stringify(errors),
      completedAt: nowIso(),
    }).where(eq(scanRuns.id, runId));

    return {
      runId,
      resourcePlan,
      totalFetched: 0,
      totalFound: 0,
      totalNew: 0,
      totalRejected: 0,
      totalQualified: 0,
      totalReview: 0,
      totalDeferred: 0,
      errors,
      warnings: [],
      duration: Date.now() - startTime,
      adapterResults,
      rejectedSamples,
      reviewSamples,
    };
  }
}

async function upsertCandidate(
  runId: string,
  adapterCode: string,
  item: NormalizedCandidate,
): Promise<{ isNew: boolean; candidateId?: string }> {
  const id = randomUUID();
  const externalId = item.externalId || `fallback-${id}`;
  const identityKey = buildCandidateIdentity(item);
  const stamp = nowIso();

  try {
    const existingRows = await db
      .select({ id: candidates.id, matchScore: candidates.matchScore })
      .from(candidates)
      .where(
        or(
          and(eq(candidates.adapterCode, adapterCode), eq(candidates.externalId, externalId)),
          identityKey ? eq(candidates.identityKey, identityKey) : sql`false`,
        ),
      )
      .orderBy(
        sql`CASE WHEN ${candidates.adapterCode} = ${adapterCode} AND ${candidates.externalId} = ${externalId} THEN 0 ELSE 1 END`,
      )
      .limit(1);

    const existing = existingRows[0];
    if (existing) {
      const current = await db.select().from(candidates).where(eq(candidates.id, existing.id)).limit(1);
      const row = current[0];
      if (!row) return { isNew: false };

      const nextScore = item.matchScore ?? 0;
      const prevScore = row.matchScore ?? 0;
      const takeQualification = nextScore >= prevScore;

      await db.update(candidates).set({
        description: row.description || item.description || null,
        website: row.website || item.website || null,
        phone: row.phone || item.phone || null,
        email: row.email || item.email || null,
        address: row.address || item.address || null,
        country: row.country || item.country || null,
        city: row.city || item.city || null,
        industry: row.industry || item.industry || null,
        businessType: row.businessType || item.businessType || null,
        products: row.products || (item.products ? JSON.stringify(item.products) : null),
        brands: row.brands || (item.brands ? JSON.stringify(item.brands) : null),
        employeesCount: row.employeesCount || item.employeesCount || null,
        isTargetCustomer: Boolean(row.isTargetCustomer) || Boolean(item.isTargetCustomer),
        targetReason: row.targetReason || item.targetReason || null,
        qualificationTier: takeQualification
          ? (item.qualificationTier || row.qualificationTier || null)
          : (row.qualificationTier || null),
        qualificationReasons: takeQualification
          ? (item.qualificationReasons
            ? JSON.stringify(item.qualificationReasons)
            : row.qualificationReasons || null)
          : (row.qualificationReasons || null),
        matchScore: Math.max(prevScore, nextScore),
        matchExplain: row.matchExplain || (item.matchExplain ? JSON.stringify(item.matchExplain) : null),
        identityKey: row.identityKey || identityKey || null,
        updatedAt: stamp,
      }).where(eq(candidates.id, existing.id));

      await linkCandidateToRun(runId, existing.id, adapterCode);
      await saveCandidateSource(existing.id, adapterCode, externalId, item);
      return { isNew: false, candidateId: existing.id };
    }

    await db.insert(candidates).values({
      id,
      runId,
      adapterCode,
      externalId,
      displayName: item.displayName,
      candidateType: item.candidateType || 'COMPANY',
      description: item.description || null,
      website: item.website || null,
      phone: item.phone || null,
      email: item.email || null,
      address: item.address || null,
      country: item.country || null,
      city: item.city || null,
      industry: item.industry || null,
      businessType: item.businessType || null,
      products: item.products ? JSON.stringify(item.products) : null,
      brands: item.brands ? JSON.stringify(item.brands) : null,
      employeesCount: item.employeesCount || null,
      isTargetCustomer: Boolean(item.isTargetCustomer),
      targetReason: item.targetReason || null,
      qualificationTier: item.qualificationTier || null,
      qualificationReasons: item.qualificationReasons ? JSON.stringify(item.qualificationReasons) : null,
      matchScore: item.matchScore ?? null,
      matchExplain: item.matchExplain ? JSON.stringify(item.matchExplain) : null,
      identityKey: identityKey || null,
      rawData: item.rawData ? JSON.stringify(item.rawData) : null,
      sourceUrl: item.sourceUrl || null,
      createdAt: stamp,
      updatedAt: stamp,
    }).onConflictDoNothing();

    // Confirm insert succeeded (unique conflict may no-op)
    const inserted = await db.select({ id: candidates.id }).from(candidates)
      .where(and(eq(candidates.adapterCode, adapterCode), eq(candidates.externalId, externalId)))
      .limit(1);
    const candidateId = inserted[0]?.id;
    if (candidateId) {
      await linkCandidateToRun(runId, candidateId, adapterCode);
      await saveCandidateSource(candidateId, adapterCode, externalId, item);
      return { isNew: candidateId === id, candidateId };
    }
    return { isNew: false };
  } catch (e) {
    console.error('[scanner] Failed to insert candidate:', e);
    return { isNew: false };
  }
}

async function linkCandidateToRun(runId: string, candidateId: string, adapterCode: string): Promise<void> {
  await db.insert(scanRunCandidates).values({
    runId,
    candidateId,
    adapterCode,
    discoveredAt: nowIso(),
  }).onConflictDoNothing();
}

async function saveCandidateSource(
  candidateId: string,
  adapterCode: string,
  externalId: string,
  item: NormalizedCandidate,
): Promise<void> {
  await db.insert(candidateSources).values({
    candidateId,
    adapterCode,
    externalId,
    sourceUrl: item.sourceUrl || null,
    rawData: item.rawData ? JSON.stringify(item.rawData) : null,
    discoveredAt: nowIso(),
  }).onConflictDoUpdate({
    target: [candidateSources.candidateId, candidateSources.adapterCode, candidateSources.externalId],
    set: {
      sourceUrl: item.sourceUrl || null,
      rawData: item.rawData ? JSON.stringify(item.rawData) : null,
      discoveredAt: nowIso(),
    },
  });
}

function mapCandidateRow(row: typeof candidates.$inferSelect): NormalizedCandidate {
  return {
    id: row.id,
    externalId: row.externalId,
    sourceUrl: row.sourceUrl || '',
    displayName: row.displayName,
    candidateType: (row.candidateType as NormalizedCandidate['candidateType']) || 'COMPANY',
    description: row.description || undefined,
    website: row.website || undefined,
    phone: row.phone || undefined,
    email: row.email || undefined,
    address: row.address || undefined,
    country: row.country || undefined,
    city: row.city || undefined,
    industry: row.industry || undefined,
    businessType: row.businessType || undefined,
    products: row.products ? JSON.parse(row.products) : undefined,
    brands: row.brands ? JSON.parse(row.brands) : undefined,
    employeesCount: row.employeesCount || undefined,
    isTargetCustomer: Boolean(row.isTargetCustomer),
    targetReason: row.targetReason || undefined,
    qualificationTier: (row.qualificationTier as NormalizedCandidate['qualificationTier']) || undefined,
    qualificationReasons: row.qualificationReasons ? JSON.parse(row.qualificationReasons) : undefined,
    matchScore: row.matchScore ?? undefined,
    matchExplain: row.matchExplain ? JSON.parse(row.matchExplain) : undefined,
    rawData: row.rawData ? JSON.parse(row.rawData) : undefined,
  };
}

export async function getScanResults(runId: string): Promise<NormalizedCandidate[]> {
  const rows = await db
    .select({ candidate: candidates })
    .from(candidates)
    .innerJoin(scanRunCandidates, eq(scanRunCandidates.candidateId, candidates.id))
    .where(eq(scanRunCandidates.runId, runId))
    .orderBy(desc(candidates.matchScore), candidates.displayName);

  const uniqueRows = [...new Map(rows.map(({ candidate }) => [
    candidate.identityKey || `id:${candidate.id}`,
    candidate,
  ])).values()];

  return uniqueRows.map(mapCandidateRow);
}

export async function getScanRun(runId: string): Promise<Record<string, unknown> | null> {
  const rows = await db.select().from(scanRuns).where(eq(scanRuns.id, runId)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    keywords: row.keywords,
    countries: row.countries,
    industry: row.industry,
    adapter_code: row.adapterCode,
    status: row.status,
    total_fetched: row.totalFetched,
    total_found: row.totalFound,
    total_new: row.totalNew,
    total_rejected: row.totalRejected,
    total_qualified: row.totalQualified,
    total_review: row.totalReview,
    total_deferred: row.totalDeferred,
    errors: row.errors,
    diagnostics: row.diagnostics,
    started_at: row.startedAt,
    completed_at: row.completedAt,
  };
}

export async function listScanRuns(limit = 20): Promise<Array<Record<string, unknown>>> {
  const rows = await db.select().from(scanRuns).orderBy(desc(scanRuns.startedAt)).limit(limit);
  return rows.map(row => ({
    id: row.id,
    keywords: row.keywords,
    countries: row.countries,
    industry: row.industry,
    adapter_code: row.adapterCode,
    status: row.status,
    total_fetched: row.totalFetched,
    total_found: row.totalFound,
    total_new: row.totalNew,
    total_rejected: row.totalRejected,
    total_qualified: row.totalQualified,
    total_review: row.totalReview,
    total_deferred: row.totalDeferred,
    errors: row.errors,
    diagnostics: row.diagnostics,
    started_at: row.startedAt,
    completed_at: row.completedAt,
  }));
}
