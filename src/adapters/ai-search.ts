/**
 * AI Search 适配器 - 精简版
 * SerpAPI + Brave Search + AI 解析
 */

import type { Adapter, SearchQuery, SearchResult, NormalizedCandidate, HealthStatus, AdapterConfig } from './types.js';
import { chatCompletion, parseAIJson } from '../ai/client.js';
import { config } from '../config.js';
import { getCountryDisplayName, normalizeCountryCode } from '../lib/country-utils.js';

interface WebSearchResult {
  title: string;
  snippet: string;
  link: string;
  searchKeyword: string;
}

interface PlannedSearchQuery {
  lang: string;
  query: string;
  region?: string;
  sourceKeyword: string;
}

const BRAVE_SEARCH_COUNTRIES = new Set([
  'AR','AU','AT','BE','BR','CA','CL','DK','FI','FR','DE','HK','IN','ID','IT','JP','KR','MY','MX',
  'NL','NZ','NO','CN','PL','PT','PH','RU','SA','ZA','ES','SE','CH','TW','TR','GB','US',
]);

export class AISearchAdapter implements Adapter {
  readonly code = 'ai_search';
  readonly channelType = 'SEARCH' as const;
  readonly features = {
    supportsKeywordSearch: true,
    supportsRegionFilter: true,
    supportsPagination: false,
    supportsDetails: false,
    maxResultsPerQuery: 20,
  };

  private timeout: number;

  constructor(cfg: AdapterConfig) {
    this.timeout = cfg.timeout || 30000;
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    const startTime = Date.now();

    // Step 1: AI 生成搜索查询
    const queries = (await this.generateQueries(query)).slice(0, query.maxQueries || Number.POSITIVE_INFINITY);

    // Step 2: 执行搜索
    const searchExecution = await this.executeSearches(queries, query);

    // Step 3: AI 解析结果
    const parsing = await this.parseResults(searchExecution.results, query);
    const candidates = parsing.candidates;

    return {
      items: candidates,
      total: candidates.length,
      hasMore: false,
      metadata: {
        source: this.code,
        query,
        fetchedAt: new Date(),
        duration: Date.now() - startTime,
        keywordStats: searchExecution.keywordStats,
        warnings: [...searchExecution.warnings, ...parsing.warnings],
        rawFetched: searchExecution.results.length,
      },
    };
  }

  private async generateQueries(query: SearchQuery): Promise<PlannedSearchQuery[]> {
    const targetCountries = (query.countries || []).map(country => getCountryDisplayName(country) || country);
    const exclusions = query.excludeKeywords || [];
    const keywords = query.keywords?.length ? query.keywords : [query.industry || 'company'];
    return keywords.map(keyword => ({
        lang: 'en',
        sourceKeyword: keyword,
        query: this.applySearchConstraints(`${keyword} company`, targetCountries, exclusions),
        region: normalizeCountryCode(query.countries?.[0]) || undefined,
      }));
  }

  private applySearchConstraints(rawQuery: string, countries: string[], exclusions: string[]): string {
    const parts = [rawQuery.trim()];
    for (const country of countries) {
      if (country && !rawQuery.toLowerCase().includes(country.toLowerCase())) parts.push(country);
    }
    for (const exclusion of exclusions.slice(0, 8)) {
      const safe = exclusion.trim().replace(/["']/g, '');
      if (safe) parts.push(safe.includes(' ') ? `-"${safe}"` : `-${safe}`);
    }
    return parts.filter(Boolean).join(' ');
  }

  private async executeSearches(
    queries: PlannedSearchQuery[],
    _originalQuery: SearchQuery
  ): Promise<{ results: WebSearchResult[]; keywordStats: Array<{ keyword: string; fetched: number }>; warnings: string[] }> {
    const allResults: WebSearchResult[] = [];
    const warnings: string[] = [];
    const perQueryLimit = Math.min(10, Math.max(3, Math.ceil((_originalQuery.maxResults || 20) / Math.max(1, queries.length))));

    const resultsArrays = await mapWithConcurrency(queries, 2, async (q) => {
      const results: WebSearchResult[] = [];

      // SerpAPI
      if (config.serpapi.apiKey) {
        try {
          const params = new URLSearchParams({
            q: q.query,
            api_key: config.serpapi.apiKey,
            engine: 'google',
            num: String(perQueryLimit),
            hl: 'en',
          });
          if (q.region) params.set('gl', q.region.toLowerCase());
          const res = await fetch(`https://serpapi.com/search?${params}`, { signal: AbortSignal.timeout(this.timeout) });
          if (res.ok) {
            const data = await res.json() as { organic_results?: Array<{ title: string; snippet: string; link: string }> };
            results.push(...(data.organic_results || []).map(r => ({ title: r.title, snippet: r.snippet, link: r.link, searchKeyword: q.sourceKeyword })));
          } else warnings.push(`${q.sourceKeyword}: SerpAPI HTTP ${res.status}`);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          warnings.push(`${q.sourceKeyword}: SerpAPI ${message}`);
          console.error('[AI Search] SerpAPI error:', e);
        }
      }

      // Brave Search
      if (config.brave.apiKey) {
        try {
          const braveSupportsCountry = Boolean(q.region && BRAVE_SEARCH_COUNTRIES.has(q.region.toUpperCase()));
          const braveQuery = q.region && !braveSupportsCountry
            ? `${q.query} loc:${q.region.toLowerCase()}`
            : q.query;
          const params = new URLSearchParams({ q: braveQuery, count: String(perQueryLimit), extra_snippets: 'true' });
          const braveCountry = braveSupportsCountry ? q.region!.toUpperCase() : 'ALL';
          params.set('country', braveCountry);
          params.set('search_lang', 'en');
          const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
            headers: { 'Accept': 'application/json', 'X-Subscription-Token': config.brave.apiKey },
            signal: AbortSignal.timeout(this.timeout),
          });
          if (res.ok) {
            const data = await res.json() as { web?: { results?: Array<{ title: string; description: string; url: string }> } };
            results.push(...(data.web?.results || []).map(r => ({ title: r.title, snippet: r.description, link: r.url, searchKeyword: q.sourceKeyword })));
          } else {
            const body = await res.text().catch(() => '');
            warnings.push(`${q.sourceKeyword}: Brave HTTP ${res.status} ${body.slice(0, 120)}`.trim());
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          warnings.push(`${q.sourceKeyword}: Brave ${message}`);
          console.error('[AI Search] Brave error:', e);
        }
      }

      return results.slice(0, perQueryLimit);
    });

    const seen = new Set<string>();
    const maxLength = Math.max(0, ...resultsArrays.map(results => results.length));
    for (let index = 0; index < maxLength; index++) {
      for (const arr of resultsArrays) {
        const item = arr[index];
        if (!item) continue;
        if (!seen.has(item.link)) {
          seen.add(item.link);
          allResults.push(item);
        }
      }
    }

    return {
      results: allResults,
      keywordStats: queries.map((queryItem, index) => ({ keyword: queryItem.sourceKeyword, fetched: resultsArrays[index]?.length || 0 })),
      warnings,
    };
  }

  private async parseResults(
    results: WebSearchResult[],
    query: SearchQuery
  ): Promise<{ candidates: NormalizedCandidate[]; warnings: string[] }> {
    if (results.length === 0) return { candidates: [], warnings: [] };

    const systemPrompt = `你是严格的 B2B 企业识别器。只保留真实企业或商业组织，不得把文章、产品页、论文、百科、论坛、数据集或个人页面当成企业。
企业必须与关键词商业意图相关，并有目标国家证据。website 必须是企业官网，sourceUrl 是支持判断的原始搜索结果。
输出 JSON: {"companies": [{"name":"...","country":"TH","website":"...","sourceUrl":"...","description":"...","isCompany":true,"relevanceScore":0.0,"relevanceReason":"..."}]}`;

    const userPrompt = `搜索结果：\n${JSON.stringify(results.slice(0, 60), null, 2)}

关键词: ${query.keywords?.join(', ') || '(无)'}
目标国家: ${(query.countries || []).map(country => getCountryDisplayName(country) || country).join(', ') || '全球'}
行业: ${query.industry || '(未指定)'}
排除词: ${query.excludeKeywords?.join(', ') || '(无)'}`;

    try {
      const result = await chatCompletion(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        { temperature: 0.2, maxTokens: 2048 }
      );
      const parsed = await parseAIJson<{ companies?: Array<{
        name: string; country?: string; website?: string; sourceUrl?: string; description?: string;
        isCompany?: boolean; relevanceScore?: number; relevanceReason?: string;
      }> }>(result.content);

      const candidates = (parsed.companies || [])
        .filter(company => company.isCompany === true && (company.relevanceScore ?? 0) >= 0.5 && company.name && company.website)
        .slice(0, query.maxResults || 20)
        .map((c, idx) => ({
        externalId: `ai_${idx}_${this.hashStr(c.website || c.name)}`,
        sourceUrl: c.sourceUrl || c.website || '',
        displayName: c.name,
        candidateType: 'COMPANY' as const,
        description: c.description,
        website: c.website,
        country: c.country,
        matchScore: c.relevanceScore,
        matchExplain: { channel: 'ai_search', reasons: ['AI-validated company', c.relevanceReason || ''].filter(Boolean) },
        rawData: { source: 'ai_search', searchKeywords: query.keywords, relevanceReason: c.relevanceReason },
      }));
      return { candidates, warnings: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        candidates: this.parseFallbackCompanies(results, query),
        warnings: [`AI company extraction failed; deterministic safety fallback used: ${message}`],
      };
    }
  }

  private parseFallbackCompanies(results: WebSearchResult[], query: SearchQuery): NormalizedCandidate[] {
    const blockedHosts = [
      'wikipedia.org', 'reddit.com', 'nature.com', 'nih.gov', 'pubmed.ncbi.nlm.nih.gov',
      'researchgate.net', 'amazonaws.com', 'ensun.io', 'dnb.com', 'coatingsworld.com', 'gmiresearch.com',
      'mdpi.com', 'pcimag.com', 'fact-link.com.vn',
      'b-company.jp',
    ];
    const documentPattern = /\b(article|journal|protocol|assay|research|study|dataset|wikipedia|reddit|market size|market outlook|market report|market analysis|directory of companies|list of companies|company list|top \d+|exhibition|trade show|conference|magazine)\b/i;
    const sourcePagePattern = /\b(an overview of|find .{0,40} companies|companies in .{0,40}(?:report|directory)|how to find|suppliers? lists?|guide|findings from|market competition|growth potential)\b/i;
    const targetCodes = (query.countries || []).map(country => normalizeCountryCode(country)).filter(Boolean);
    const targetNames = targetCodes.map(code => getCountryDisplayName(code)?.toLowerCase()).filter(Boolean) as string[];
    const seenHosts = new Set<string>();
    const candidates: NormalizedCandidate[] = [];

    for (const item of results) {
      let url: URL;
      try { url = new URL(item.link); } catch { continue; }
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (seenHosts.has(host) || blockedHosts.some(blocked => host === blocked || host.endsWith(`.${blocked}`))) continue;
      if (documentPattern.test(`${item.title} ${item.snippet}`) || sourcePagePattern.test(`${item.title} ${item.snippet}`)) continue;

      const evidence = `${item.title} ${item.snippet} ${item.link}`.toLowerCase();
      const countryMatched = targetCodes.length === 0 || targetCodes.some(code => host.endsWith(`.${code?.toLowerCase()}`)) || targetNames.some(name => evidence.includes(name));
      if (!countryMatched) continue;

      const titleParts = item.title.split(/\s+[|–—-]\s+/).map(part => part.trim()).filter(Boolean);
      const hostToken = host.split('.')[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
      const matchingTitlePart = titleParts.find(part => {
        const normalized = part.replace(/[^a-z0-9]/gi, '').toLowerCase();
        return normalized.length >= 4 && hostToken.length >= 4 && (normalized.includes(hostToken) || hostToken.includes(normalized));
      });
      if (!matchingTitlePart) continue;

      seenHosts.add(host);
      candidates.push({
        externalId: `ai_fallback_${this.hashStr(host)}`,
        sourceUrl: item.link,
        displayName: matchingTitlePart,
        candidateType: 'COMPANY',
        description: item.snippet,
        website: url.origin,
        country: targetCodes.length === 1 ? targetCodes[0] || undefined : undefined,
        matchExplain: { channel: 'ai_search', reasons: ['Deterministic company fallback', 'Target-country evidence'] },
        rawData: { source: 'ai_search', fallback: true, sourceTitle: item.title, searchKeyword: item.searchKeyword },
      });
      if (candidates.length >= (query.maxResults || 10)) break;
    }
    return candidates;
  }

  private hashStr(s: string): string {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash) + s.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  async healthCheck(): Promise<HealthStatus> {
    const hasSerp = !!config.serpapi.apiKey;
    const hasBrave = !!config.brave.apiKey;
    return {
      healthy: hasSerp || hasBrave,
      latency: 0,
      error: (hasSerp || hasBrave) ? undefined : 'No search API key configured',
    };
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
