import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { discoverySourceRuns } from '../db/schema.js';
import type { DiscoveryResourcePlan } from './types.js';

export interface SourceRunMetricInput {
  runId: string;
  sourceCode: string;
  countryCode?: string;
  industryPackId?: string;
  status: 'completed' | 'failed';
  fetched: number;
  found: number;
  qualified: number;
  review: number;
  rejected: number;
  durationMs: number;
  errorCode?: string;
}

export interface SourceQualityMetric {
  sourceCode: string;
  countryCode?: string;
  industryPackId?: string;
  runs: number;
  fetched: number;
  found: number;
  qualified: number;
  review: number;
  rejected: number;
  avgDurationMs: number;
  qualificationRate: number;
  retentionRate: number;
}

export async function recordSourceRun(input: SourceRunMetricInput): Promise<void> {
  await db.insert(discoverySourceRuns).values({
    runId: input.runId,
    sourceCode: input.sourceCode,
    countryCode: input.countryCode || null,
    industryPackId: input.industryPackId || null,
    status: input.status,
    fetched: input.fetched,
    found: input.found,
    qualified: input.qualified,
    review: input.review,
    rejected: input.rejected,
    durationMs: input.durationMs,
    errorCode: input.errorCode || null,
    createdAt: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: [discoverySourceRuns.runId, discoverySourceRuns.sourceCode],
    set: {
      countryCode: input.countryCode || null,
      industryPackId: input.industryPackId || null,
      status: input.status,
      fetched: input.fetched,
      found: input.found,
      qualified: input.qualified,
      review: input.review,
      rejected: input.rejected,
      durationMs: input.durationMs,
      errorCode: input.errorCode || null,
      createdAt: new Date().toISOString(),
    },
  });
}

export async function getSourceQualityMetrics(
  filters: { countryCode?: string; industryPackId?: string } = {},
): Promise<SourceQualityMetric[]> {
  const conditions = [];
  if (filters.countryCode) conditions.push(eq(discoverySourceRuns.countryCode, filters.countryCode));
  if (filters.industryPackId) conditions.push(eq(discoverySourceRuns.industryPackId, filters.industryPackId));

  const rows = await db
    .select({
      sourceCode: discoverySourceRuns.sourceCode,
      countryCode: discoverySourceRuns.countryCode,
      industryPackId: discoverySourceRuns.industryPackId,
      runs: sql<number>`count(*)::int`,
      fetched: sql<number>`coalesce(sum(${discoverySourceRuns.fetched}), 0)::int`,
      found: sql<number>`coalesce(sum(${discoverySourceRuns.found}), 0)::int`,
      qualified: sql<number>`coalesce(sum(${discoverySourceRuns.qualified}), 0)::int`,
      review: sql<number>`coalesce(sum(${discoverySourceRuns.review}), 0)::int`,
      rejected: sql<number>`coalesce(sum(${discoverySourceRuns.rejected}), 0)::int`,
      avgDurationMs: sql<number>`coalesce(avg(${discoverySourceRuns.durationMs}), 0)`,
    })
    .from(discoverySourceRuns)
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(
      discoverySourceRuns.sourceCode,
      discoverySourceRuns.countryCode,
      discoverySourceRuns.industryPackId,
    )
    .orderBy(desc(sql`count(*)`), desc(sql`coalesce(sum(${discoverySourceRuns.qualified}), 0)`));

  return rows.map(row => {
    const found = Number(row.found || 0);
    const fetched = Number(row.fetched || 0);
    return {
      sourceCode: String(row.sourceCode),
      countryCode: row.countryCode || undefined,
      industryPackId: row.industryPackId || undefined,
      runs: Number(row.runs || 0),
      fetched,
      found,
      qualified: Number(row.qualified || 0),
      review: Number(row.review || 0),
      rejected: Number(row.rejected || 0),
      avgDurationMs: Math.round(Number(row.avgDurationMs || 0)),
      qualificationRate: found ? Math.round(Number(row.qualified || 0) / found * 1000) / 1000 : 0,
      retentionRate: fetched ? Math.round(found / fetched * 1000) / 1000 : 0,
    };
  });
}

export async function applyHistoricalPerformanceAsync(
  plan: DiscoveryResourcePlan,
): Promise<DiscoveryResourcePlan> {
  const metrics = await getSourceQualityMetrics({
    countryCode: plan.countryCode,
    industryPackId: plan.industryPackId,
  });
  const byAdapter = new Map(metrics.map(metric => [metric.sourceCode, metric]));
  const sources = plan.sources.map(source => {
    const metric = source.adapterCode ? byAdapter.get(source.adapterCode) : undefined;
    if (!metric || metric.runs < 2) return source;
    const confidence = Math.min(1, metric.runs / 10);
    const performanceAdjustment = (metric.qualificationRate - 0.4) * 0.25 * confidence;
    return {
      ...source,
      score: Math.max(0, Math.min(1, Math.round((source.score + performanceAdjustment) * 100) / 100)),
      reasons: [
        ...source.reasons,
        `historical_runs:${metric.runs}`,
        `qualification_rate:${metric.qualificationRate.toFixed(3)}`,
      ],
    };
  }).sort((a, b) => b.score - a.score);

  return {
    ...plan,
    sources,
    recommendedAdapters: [
      ...new Set(
        sources
          .filter(source => source.status === 'active')
          .map(source => source.adapterCode)
          .filter(Boolean) as string[],
      ),
    ],
  };
}
