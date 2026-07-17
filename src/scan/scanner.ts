/**
 * 扫描引擎
 * Neon PostgreSQL + Drizzle
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
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
        const newCount = await persistCandidates(runId, adapterCode, selected.map(item => item.candidate));

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

async function persistCandidates(
  runId: string,
  adapterCode: string,
  items: NormalizedCandidate[],
): Promise<number> {
  if (items.length === 0) return 0;

  const stamp = nowIso();
  const prepared = items.map(item => {
    const id = randomUUID();
    return {
      id,
      item,
      externalId: item.externalId || `fallback-${id}`,
      identityKey: buildCandidateIdentity(item),
    };
  });

  try {
    const externalIds = [...new Set(prepared.map(p => p.externalId))];
    const identityKeys = [...new Set(prepared.map(p => p.identityKey).filter((k): k is string => Boolean(k)))];

    const existingRows = await db
      .select()
      .from(candidates)
      .where(
        or(
          and(eq(candidates.adapterCode, adapterCode), inArray(candidates.externalId, externalIds)),
          identityKeys.length ? inArray(candidates.identityKey, identityKeys) : sql`false`,
        ),
      );

    const byAdapterExternal = new Map(
      existingRows
        .filter(row => row.adapterCode === adapterCode)
        .map(row => [`${row.adapterCode}::${row.externalId}`, row] as const),
    );
    const byIdentity = new Map(
      existingRows
        .filter(row => row.identityKey)
        .map(row => [row.identityKey as string, row] as const),
    );

    const toInsert: Array<typeof candidates.$inferInsert> = [];
    const toUpdate: Array<{ id: string; values: Partial<typeof candidates.$inferInsert> }> = [];
    const resolved: Array<{ candidateId: string; isNew: boolean; externalId: string; item: NormalizedCandidate }> = [];

    for (const prep of prepared) {
      const existing =
        byAdapterExternal.get(`${adapterCode}::${prep.externalId}`)
        || (prep.identityKey ? byIdentity.get(prep.identityKey) : undefined);

      if (existing) {
        const nextScore = prep.item.matchScore ?? 0;
        const prevScore = existing.matchScore ?? 0;
        const takeQualification = nextScore >= prevScore;
        const values: Partial<typeof candidates.$inferInsert> = {
          description: existing.description || prep.item.description || null,
          website: existing.website || prep.item.website || null,
          phone: existing.phone || prep.item.phone || null,
          email: existing.email || prep.item.email || null,
          address: existing.address || prep.item.address || null,
          country: existing.country || prep.item.country || null,
          city: existing.city || prep.item.city || null,
          industry: existing.industry || prep.item.industry || null,
          businessType: existing.businessType || prep.item.businessType || null,
          products: existing.products || (prep.item.products ? JSON.stringify(prep.item.products) : null),
          brands: existing.brands || (prep.item.brands ? JSON.stringify(prep.item.brands) : null),
          employeesCount: existing.employeesCount || prep.item.employeesCount || null,
          isTargetCustomer: Boolean(existing.isTargetCustomer) || Boolean(prep.item.isTargetCustomer),
          targetReason: existing.targetReason || prep.item.targetReason || null,
          qualificationTier: takeQualification
            ? (prep.item.qualificationTier || existing.qualificationTier || null)
            : (existing.qualificationTier || null),
          qualificationReasons: takeQualification
            ? (prep.item.qualificationReasons
              ? JSON.stringify(prep.item.qualificationReasons)
              : existing.qualificationReasons || null)
            : (existing.qualificationReasons || null),
          matchScore: Math.max(prevScore, nextScore),
          matchExplain: existing.matchExplain
            || (prep.item.matchExplain ? JSON.stringify(prep.item.matchExplain) : null),
          identityKey: existing.identityKey || prep.identityKey || null,
          updatedAt: stamp,
        };
        toUpdate.push({ id: existing.id, values });
        resolved.push({
          candidateId: existing.id,
          isNew: false,
          externalId: prep.externalId,
          item: prep.item,
        });
        // Keep maps fresh for later duplicates in same batch
        byAdapterExternal.set(`${adapterCode}::${prep.externalId}`, { ...existing, ...values, id: existing.id } as typeof existing);
        if (values.identityKey) {
          byIdentity.set(values.identityKey, { ...existing, ...values, id: existing.id } as typeof existing);
        }
        continue;
      }

      const row: typeof candidates.$inferInsert = {
        id: prep.id,
        runId,
        adapterCode,
        externalId: prep.externalId,
        displayName: prep.item.displayName,
        candidateType: prep.item.candidateType || 'COMPANY',
        description: prep.item.description || null,
        website: prep.item.website || null,
        phone: prep.item.phone || null,
        email: prep.item.email || null,
        address: prep.item.address || null,
        country: prep.item.country || null,
        city: prep.item.city || null,
        industry: prep.item.industry || null,
        businessType: prep.item.businessType || null,
        products: prep.item.products ? JSON.stringify(prep.item.products) : null,
        brands: prep.item.brands ? JSON.stringify(prep.item.brands) : null,
        employeesCount: prep.item.employeesCount || null,
        isTargetCustomer: Boolean(prep.item.isTargetCustomer),
        targetReason: prep.item.targetReason || null,
        qualificationTier: prep.item.qualificationTier || null,
        qualificationReasons: prep.item.qualificationReasons
          ? JSON.stringify(prep.item.qualificationReasons)
          : null,
        matchScore: prep.item.matchScore ?? null,
        matchExplain: prep.item.matchExplain ? JSON.stringify(prep.item.matchExplain) : null,
        identityKey: prep.identityKey || null,
        rawData: prep.item.rawData ? JSON.stringify(prep.item.rawData) : null,
        sourceUrl: prep.item.sourceUrl || null,
        createdAt: stamp,
        updatedAt: stamp,
      };
      toInsert.push(row);
      resolved.push({
        candidateId: prep.id,
        isNew: true,
        externalId: prep.externalId,
        item: prep.item,
      });
      byAdapterExternal.set(`${adapterCode}::${prep.externalId}`, row as typeof existingRows[number]);
      if (prep.identityKey) {
        byIdentity.set(prep.identityKey, row as typeof existingRows[number]);
      }
    }

    if (toInsert.length) {
      await db.insert(candidates).values(toInsert).onConflictDoNothing();
      // Conflicts may no-op; resolve actual ids for this adapter+externalId set
      const insertedExt = toInsert.map(r => r.externalId);
      const confirmed = await db
        .select({ id: candidates.id, externalId: candidates.externalId })
        .from(candidates)
        .where(and(eq(candidates.adapterCode, adapterCode), inArray(candidates.externalId, insertedExt)));
      const confirmedByExt = new Map(confirmed.map(r => [r.externalId, r.id]));
      for (const entry of resolved) {
        if (!entry.isNew) continue;
        const actualId = confirmedByExt.get(entry.externalId);
        if (actualId) {
          entry.isNew = actualId === entry.candidateId;
          entry.candidateId = actualId;
        }
      }
    }

    if (toUpdate.length) {
      // Parallel updates share the pool; still far fewer RTT waves than per-candidate 5-step chain
      await Promise.all(
        toUpdate.map(({ id, values }) => db.update(candidates).set(values).where(eq(candidates.id, id))),
      );
    }

    const links = resolved.map(entry => ({
      runId,
      candidateId: entry.candidateId,
      adapterCode,
      discoveredAt: stamp,
    }));
    if (links.length) {
      await db.insert(scanRunCandidates).values(links).onConflictDoNothing();
    }

    const sources = resolved.map(entry => ({
      candidateId: entry.candidateId,
      adapterCode,
      externalId: entry.externalId,
      sourceUrl: entry.item.sourceUrl || null,
      rawData: entry.item.rawData ? JSON.stringify(entry.item.rawData) : null,
      discoveredAt: stamp,
    }));
    if (sources.length) {
      await db.insert(candidateSources).values(sources).onConflictDoUpdate({
        target: [candidateSources.candidateId, candidateSources.adapterCode, candidateSources.externalId],
        set: {
          sourceUrl: sql`excluded.source_url`,
          rawData: sql`excluded.raw_data`,
          discoveredAt: sql`excluded.discovered_at`,
        },
      });
    }

    return resolved.filter(entry => entry.isNew).length;
  } catch (e) {
    console.error('[scanner] Failed to persist candidates batch:', e);
    return 0;
  }
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
