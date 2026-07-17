import { Router } from 'express';
import { normalizeCountryCode } from '../lib/country-utils.js';
import { resourceRegistry } from '../resources/registry.js';
import { buildDiscoveryResourcePlan } from '../resources/planner.js';
import { applyHistoricalPerformance, getSourceQualityMetrics } from '../resources/metrics.js';

export const resourcesRouter: Router = Router();

resourcesRouter.get('/', (_req, res) => {
  res.json({ success: true, data: {
    loadedAt: resourceRegistry.getLoadedAt(),
    markets: resourceRegistry.listMarkets(),
    industries: resourceRegistry.listIndustries(),
    sources: resourceRegistry.listSources(),
  } });
});

resourcesRouter.post('/plan', (req, res) => {
  try {
    const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    const plan = applyHistoricalPerformance(buildDiscoveryResourcePlan({
      countries: strings(req.body.countries),
      industry: typeof req.body.industry === 'string' ? req.body.industry : undefined,
      keywords: strings(req.body.keywords),
      negativeKeywords: strings(req.body.negativeKeywords),
    }));
    res.json({ success: true, data: plan });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

resourcesRouter.get('/metrics', (req, res) => {
  const countryCode = typeof req.query.country === 'string' ? normalizeCountryCode(req.query.country) || undefined : undefined;
  const industryPackId = typeof req.query.industry === 'string' ? req.query.industry : undefined;
  res.json({ success: true, data: getSourceQualityMetrics({ countryCode, industryPackId }) });
});

resourcesRouter.post('/reload', (_req, res) => {
  try {
    resourceRegistry.reload();
    res.json({ success: true, data: { loadedAt: resourceRegistry.getLoadedAt() } });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

resourcesRouter.get('/markets/:code', (req, res) => {
  const code = normalizeCountryCode(req.params.code) || resourceRegistry.findMarket(req.params.code)?.countryCode;
  const market = code ? resourceRegistry.getMarket(code) : undefined;
  if (!market) return res.status(404).json({ success: false, error: 'Market Pack not found' });
  res.json({ success: true, data: market });
});

resourcesRouter.get('/industries/:id', (req, res) => {
  const industry = resourceRegistry.getIndustry(req.params.id);
  if (!industry) return res.status(404).json({ success: false, error: 'Industry Pack not found' });
  res.json({ success: true, data: industry });
});
