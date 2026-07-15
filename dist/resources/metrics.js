import { db } from '../db.js';
export function recordSourceRun(input) {
    db.prepare(`
    INSERT OR REPLACE INTO discovery_source_runs
      (run_id, source_code, country_code, industry_pack_id, status, fetched, found, qualified, review, rejected, duration_ms, error_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(input.runId, input.sourceCode, input.countryCode || null, input.industryPackId || null, input.status, input.fetched, input.found, input.qualified, input.review, input.rejected, input.durationMs, input.errorCode || null);
}
export function getSourceQualityMetrics(filters = {}) {
    const conditions = [];
    const params = [];
    if (filters.countryCode) {
        conditions.push('country_code = ?');
        params.push(filters.countryCode);
    }
    if (filters.industryPackId) {
        conditions.push('industry_pack_id = ?');
        params.push(filters.industryPackId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.prepare(`
    SELECT source_code, country_code, industry_pack_id, COUNT(*) runs,
      SUM(fetched) fetched, SUM(found) found, SUM(qualified) qualified,
      SUM(review) review, SUM(rejected) rejected, AVG(duration_ms) avg_duration_ms
    FROM discovery_source_runs ${where}
    GROUP BY source_code, country_code, industry_pack_id
    ORDER BY runs DESC, qualified DESC
  `).all(...params);
    return rows.map(row => {
        const found = Number(row.found || 0);
        const fetched = Number(row.fetched || 0);
        return {
            sourceCode: String(row.source_code),
            countryCode: row.country_code ? String(row.country_code) : undefined,
            industryPackId: row.industry_pack_id ? String(row.industry_pack_id) : undefined,
            runs: Number(row.runs || 0), fetched, found,
            qualified: Number(row.qualified || 0), review: Number(row.review || 0), rejected: Number(row.rejected || 0),
            avgDurationMs: Math.round(Number(row.avg_duration_ms || 0)),
            qualificationRate: found ? Math.round(Number(row.qualified || 0) / found * 1000) / 1000 : 0,
            retentionRate: fetched ? Math.round(found / fetched * 1000) / 1000 : 0,
        };
    });
}
export function applyHistoricalPerformance(plan) {
    const metrics = getSourceQualityMetrics({ countryCode: plan.countryCode, industryPackId: plan.industryPackId });
    const byAdapter = new Map(metrics.map(metric => [metric.sourceCode, metric]));
    const sources = plan.sources.map(source => {
        const metric = source.adapterCode ? byAdapter.get(source.adapterCode) : undefined;
        if (!metric || metric.runs < 2)
            return source;
        const confidence = Math.min(1, metric.runs / 10);
        const performanceAdjustment = (metric.qualificationRate - 0.4) * 0.25 * confidence;
        return {
            ...source,
            score: Math.max(0, Math.min(1, Math.round((source.score + performanceAdjustment) * 100) / 100)),
            reasons: [...source.reasons, `historical_runs:${metric.runs}`, `qualification_rate:${metric.qualificationRate.toFixed(3)}`],
        };
    }).sort((a, b) => b.score - a.score);
    return { ...plan, sources, recommendedAdapters: [...new Set(sources.filter(source => source.status === 'active').map(source => source.adapterCode).filter(Boolean))] };
}
//# sourceMappingURL=metrics.js.map