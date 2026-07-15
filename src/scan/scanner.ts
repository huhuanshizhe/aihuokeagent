/**
 * 扫描引擎 - 精简版
 * 从 src/lib/radar/scan-engine.ts 提取，去除 Prisma 依赖
 * 使用 SQLite 存储结果
 */

import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { getAdapter, getDefaultDiscoveryAdapterCodes } from '../adapters/registry.js';
import { generateKeywords, type GeneratedKeyword } from './keyword-gen.js';
import type { SearchQuery, NormalizedCandidate } from '../adapters/types.js';
import { buildCandidateIdentity } from '../pipeline/candidate-utils.js';
import { getProviderQueryBudget, normalizeDiscoveryOptions } from './discovery-query.js';
import { qualifyDiscoveredCandidate } from './qualifier.js';
import { buildDiscoveryResourcePlan } from '../resources/planner.js';
import { applyHistoricalPerformance, recordSourceRun } from '../resources/metrics.js';
import type { DiscoveryResourcePlan } from '../resources/types.js';

// ==================== 类型定义 ====================

export interface ScanOptions {
  keywords?: string[];
  countries?: string[];
  industry?: string;
  adapters?: string[];       // 指定适配器，默认全部
  maxResults?: number;       // 每个适配器最多结果
  companyName?: string;      // 用于 AI 关键词生成
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

// ==================== 扫描执行 ====================

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

  // 1. 记录扫描运行
  db.prepare(`
    INSERT INTO scan_runs (id, keywords, countries, industry, status, started_at)
    VALUES (?, ?, ?, ?, 'running', ?)
  `).run(runId, JSON.stringify(options.keywords || []), JSON.stringify(options.countries || []), options.industry || null, new Date().toISOString());

  try {
    // 2. 准备关键词
    let keywords = options.keywords || [];
    if (keywords.length === 0 && options.companyName) {
      console.log('[scanner] No keywords provided, generating with AI...');
      const generated = await generateKeywords(
        { companyName: options.companyName, companyIntro: options.companyIntro, products: options.products, targetIndustries: options.industry ? [options.industry] : undefined },
        options.countries || [],
        { mode: 'initial' }
      );
      keywords = generated.map(k => k.keyword);
      console.log(`[scanner] AI generated ${keywords.length} keywords`);
    }

    if (keywords.length === 0) {
      throw new Error('No keywords provided and AI generation failed');
    }

    resourcePlan = applyHistoricalPerformance(buildDiscoveryResourcePlan({
      countries: options.countries || [],
      industry: options.industry,
      keywords,
      negativeKeywords: options.negativeKeywords,
    }));
    keywords = resourcePlan.keywords.length ? resourcePlan.keywords : keywords;
    options.negativeKeywords = resourcePlan.negativeKeywords;
    db.prepare('UPDATE scan_runs SET keywords = ?, diagnostics = ? WHERE id = ?')
      .run(JSON.stringify(keywords), JSON.stringify({ resourcePlan }), runId);

    // 3. 确定要使用的适配器
    const configuredDefaults = getDefaultDiscoveryAdapterCodes(options.countries);
    const plannedConfigured = resourcePlan.recommendedAdapters.filter(code => configuredDefaults.includes(code));
    const adapterCodes = options.adapters?.length
      ? options.adapters
      : [...plannedConfigured, ...configuredDefaults.filter(code => !plannedConfigured.includes(code))];
    if (adapterCodes.length === 0) {
      throw new Error('No discovery provider is configured. Configure Google Places, Apollo, SerpAPI, Brave Search, or select an official market registry.');
    }

    // 4. 并行执行独立数据源；单个 provider 失败不会中断整个 discovery run。
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
          const upserted = upsertCandidate(runId, adapterCode, item.candidate);
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
            keyword: typeof item.candidate.rawData?.searchKeyword === 'string' ? item.candidate.rawData.searchKeyword : undefined,
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
        recordSourceRun({
          runId, sourceCode: adapterCode, countryCode: resourcePlan?.countryCode, industryPackId: resourcePlan?.industryPackId,
          status: 'completed', fetched: rawFetched, found: selected.length,
          qualified: adapterResults[adapterCode].qualified, review: adapterResults[adapterCode].review,
          rejected: adapterResults[adapterCode].rejected, durationMs: result.metadata.duration,
        });
        console.log(`[scanner] ${adapterCode}: fetched ${rawFetched}, qualified ${adapterResults[adapterCode].qualified}, review ${adapterResults[adapterCode].review}, rejected ${adapterResults[adapterCode].rejected}, deferred ${deferred.length}, new ${newCount}`);
      } catch (e) {
        const errMsg = `[${adapterCode}] ${e instanceof Error ? e.message : String(e)}`;
        errors.push(errMsg);
        adapterResults[adapterCode] = {
          fetched: 0, found: 0, new: 0, rejected: 0,
          qualified: 0, review: 0, deferred: 0, providerFiltered: 0, keywordStats: [], warnings: [],
        };
        recordSourceRun({
          runId, sourceCode: adapterCode, countryCode: resourcePlan?.countryCode, industryPackId: resourcePlan?.industryPackId,
          status: 'failed', fetched: 0, found: 0, qualified: 0, review: 0, rejected: 0,
          durationMs: 0, errorCode: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
        });
        console.error(`[scanner] ${adapterCode} failed:`, e);
      }
    }));

    // 5. 更新运行记录
    const totalFound = Object.values(adapterResults).reduce((sum, r) => sum + r.found, 0);
    const totalFetched = Object.values(adapterResults).reduce((sum, r) => sum + r.fetched, 0);
    const totalNew = Object.values(adapterResults).reduce((sum, r) => sum + r.new, 0);
    const totalRejected = Object.values(adapterResults).reduce((sum, r) => sum + r.rejected, 0);
    const totalQualified = Object.values(adapterResults).reduce((sum, r) => sum + r.qualified, 0);
    const totalReview = Object.values(adapterResults).reduce((sum, r) => sum + r.review, 0);
    const totalDeferred = Object.values(adapterResults).reduce((sum, r) => sum + r.deferred, 0);
    const warnings = Object.entries(adapterResults).flatMap(([adapter, result]) =>
      result.warnings.map(warning => `[${adapter}] ${warning}`)
    );

    db.prepare(`
      UPDATE scan_runs SET status = 'completed', total_fetched = ?, total_found = ?, total_new = ?,
        total_rejected = ?, total_qualified = ?, total_review = ?, total_deferred = ?,
        errors = ?, diagnostics = ?, completed_at = ?
      WHERE id = ?
    `).run(
      totalFetched, totalFound, totalNew, totalRejected, totalQualified, totalReview, totalDeferred,
      JSON.stringify(errors), JSON.stringify({ resourcePlan, adapterResults, warnings, rejectedSamples, reviewSamples }), new Date().toISOString(), runId,
    );
    // API success means the whole discovery run is durable on disk.
    db.flush();

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
    db.prepare(`UPDATE scan_runs SET status = 'failed', errors = ?, completed_at = ? WHERE id = ?`)
      .run(JSON.stringify(errors), new Date().toISOString(), runId);
    db.flush();

    return {
      runId, resourcePlan, totalFetched: 0, totalFound: 0, totalNew: 0, totalRejected: 0,
      totalQualified: 0, totalReview: 0, totalDeferred: 0,
      errors, warnings: [], duration: Date.now() - startTime, adapterResults, rejectedSamples, reviewSamples,
    };
  }
}

// ==================== 候选入库 ====================

function upsertCandidate(runId: string, adapterCode: string, item: NormalizedCandidate): { isNew: boolean; candidateId?: string } {
  const id = randomUUID();
  const externalId = item.externalId || `fallback-${id}`;
  const identityKey = buildCandidateIdentity(item);

  try {
    const existing = db.prepare(`
      SELECT id FROM candidates
      WHERE (adapter_code = ? AND external_id = ?)
         OR (? IS NOT NULL AND identity_key = ?)
      ORDER BY CASE WHEN adapter_code = ? AND external_id = ? THEN 0 ELSE 1 END
      LIMIT 1
    `).get(adapterCode, externalId, identityKey || null, identityKey || null, adapterCode, externalId) as { id: string } | undefined;

    if (existing) {
      db.prepare(`
        UPDATE candidates SET
          description = COALESCE(description, ?), website = COALESCE(website, ?),
          phone = COALESCE(phone, ?), email = COALESCE(email, ?), address = COALESCE(address, ?),
          country = COALESCE(country, ?), city = COALESCE(city, ?), industry = COALESCE(industry, ?),
          business_type = COALESCE(business_type, ?), products = COALESCE(products, ?),
          brands = COALESCE(brands, ?), employees_count = COALESCE(employees_count, ?),
          is_target_customer = MAX(is_target_customer, ?), target_reason = COALESCE(target_reason, ?),
          qualification_tier = CASE WHEN COALESCE(?, 0) >= COALESCE(match_score, 0) THEN ? ELSE qualification_tier END,
          qualification_reasons = CASE WHEN COALESCE(?, 0) >= COALESCE(match_score, 0) THEN ? ELSE qualification_reasons END,
          match_score = MAX(COALESCE(match_score, 0), COALESCE(?, 0)),
          match_explain = COALESCE(match_explain, ?), identity_key = COALESCE(identity_key, ?),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        item.description || null, item.website || null, item.phone || null, item.email || null,
        item.address || null, item.country || null, item.city || null, item.industry || null,
        item.businessType || null, item.products ? JSON.stringify(item.products) : null,
        item.brands ? JSON.stringify(item.brands) : null, item.employeesCount || null,
        item.isTargetCustomer ? 1 : 0, item.targetReason || null,
        item.matchScore ?? null, item.qualificationTier || null,
        item.matchScore ?? null, item.qualificationReasons ? JSON.stringify(item.qualificationReasons) : null,
        item.matchScore ?? null,
        item.matchExplain ? JSON.stringify(item.matchExplain) : null, identityKey || null, existing.id,
      );
      linkCandidateToRun(runId, existing.id, adapterCode);
      saveCandidateSource(existing.id, adapterCode, externalId, item);
      return { isNew: false, candidateId: existing.id };
    }

    const result = db.prepare(`
      INSERT OR IGNORE INTO candidates
        (id, run_id, adapter_code, external_id, display_name, candidate_type, description,
         website, phone, email, address, country, city, industry,
         business_type, products, brands, employees_count, is_target_customer, target_reason,
         qualification_tier, qualification_reasons,
         match_score, match_explain, identity_key, raw_data, source_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, runId, adapterCode, externalId,
      item.displayName, item.candidateType, item.description || null,
      item.website || null, item.phone || null, item.email || null,
      item.address || null, item.country || null, item.city || null,
      item.industry || null,
      item.businessType || null,
      item.products ? JSON.stringify(item.products) : null,
      item.brands ? JSON.stringify(item.brands) : null,
      item.employeesCount || null,
      item.isTargetCustomer ? 1 : 0,
      item.targetReason || null,
      item.qualificationTier || null,
      item.qualificationReasons ? JSON.stringify(item.qualificationReasons) : null,
      item.matchScore || null,
      item.matchExplain ? JSON.stringify(item.matchExplain) : null,
      identityKey || null,
      item.rawData ? JSON.stringify(item.rawData) : null,
      item.sourceUrl || null,
    );

    if (result.changes > 0) {
      linkCandidateToRun(runId, id, adapterCode);
      saveCandidateSource(id, adapterCode, externalId, item);
    }
    return { isNew: result.changes > 0, candidateId: result.changes > 0 ? id : undefined };
  } catch (e) {
    console.error(`[scanner] Failed to insert candidate:`, e);
    return { isNew: false };
  }
}

function linkCandidateToRun(runId: string, candidateId: string, adapterCode: string): void {
  db.prepare(`
    INSERT OR IGNORE INTO scan_run_candidates (run_id, candidate_id, adapter_code)
    VALUES (?, ?, ?)
  `).run(runId, candidateId, adapterCode);
}

function saveCandidateSource(candidateId: string, adapterCode: string, externalId: string, item: NormalizedCandidate): void {
  db.prepare(`
    INSERT OR REPLACE INTO candidate_sources
      (candidate_id, adapter_code, external_id, source_url, raw_data, discovered_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(
    candidateId,
    adapterCode,
    externalId,
    item.sourceUrl || null,
    item.rawData ? JSON.stringify(item.rawData) : null,
  );
}

// ==================== 查询接口 ====================

export function getScanResults(runId: string): NormalizedCandidate[] {
  const rows = db.prepare(`
    SELECT c.* FROM candidates c
    INNER JOIN scan_run_candidates src ON src.candidate_id = c.id
    WHERE src.run_id = ?
    ORDER BY c.match_score DESC, c.display_name ASC
  `).all(runId) as Array<Record<string, unknown>>;

  const uniqueRows = [...new Map(rows.map(row => [
    (row.identity_key as string | undefined) || `id:${row.id as string}`,
    row,
  ])).values()];

  return uniqueRows.map(row => ({
    id: row.id as string,
    externalId: row.external_id as string,
    sourceUrl: row.source_url as string,
    displayName: row.display_name as string,
    candidateType: (row.candidate_type as 'COMPANY' | 'OPPORTUNITY' | 'CONTACT') || 'COMPANY',
    description: row.description as string | undefined,
    website: row.website as string | undefined,
    phone: row.phone as string | undefined,
    email: row.email as string | undefined,
    address: row.address as string | undefined,
    country: row.country as string | undefined,
    city: row.city as string | undefined,
    industry: row.industry as string | undefined,
    businessType: row.business_type as string | undefined,
    products: row.products ? JSON.parse(row.products as string) : undefined,
    brands: row.brands ? JSON.parse(row.brands as string) : undefined,
    employeesCount: row.employees_count as string | undefined,
    isTargetCustomer: (row.is_target_customer as number) === 1,
    targetReason: row.target_reason as string | undefined,
    qualificationTier: row.qualification_tier as NormalizedCandidate['qualificationTier'],
    qualificationReasons: row.qualification_reasons ? JSON.parse(row.qualification_reasons as string) : undefined,
    matchScore: row.match_score as number | undefined,
    matchExplain: row.match_explain ? JSON.parse(row.match_explain as string) : undefined,
    rawData: row.raw_data ? JSON.parse(row.raw_data as string) : undefined,
  }));
}

export function getScanRun(runId: string): Record<string, unknown> | null {
  return db.prepare('SELECT * FROM scan_runs WHERE id = ?').get(runId) as Record<string, unknown> | null;
}

export function listScanRuns(limit = 20): Array<Record<string, unknown>> {
  return db.prepare('SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>;
}
