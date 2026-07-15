/**
 * Apollo Organization Search 适配器 - 精简版
 */

import type { Adapter, SearchQuery, SearchResult, NormalizedCandidate, HealthStatus, AdapterConfig } from './types.js';
import { getCountryDisplayName } from '../lib/country-utils.js';

interface ApolloOrg {
  id: string;
  name: string;
  website_url?: string;
  primary_domain?: string;
  industry?: string;
  estimated_num_employees?: number;
  city?: string;
  country?: string;
  linkedin_url?: string;
  short_description?: string;
  keywords?: string[];
  annual_revenue_printed?: string;
}

export class ApolloAdapter implements Adapter {
  readonly code = 'apollo';
  readonly channelType = 'DIRECTORY' as const;
  readonly features = {
    supportsKeywordSearch: true,
    supportsRegionFilter: true,
    supportsPagination: true,
    supportsDetails: false,
    maxResultsPerQuery: 100,
  };

  private apiKey: string;
  private timeout: number;

  constructor(cfg: AdapterConfig) {
    this.apiKey = cfg.apiKey || '';
    this.timeout = cfg.timeout || 30000;
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    const startTime = Date.now();
    if (!this.apiKey) {
      return { items: [], total: 0, hasMore: false, metadata: { source: this.code, query, fetchedAt: new Date(), duration: 0 } };
    }

    const page = query.page || 1;
    const perPage = Math.min(query.pageSize || 25, 100);

    const body: Record<string, unknown> = { page, per_page: perPage };

    // Keywords
    const keywords = [...(query.keywords || []), ...(query.targetIndustries || [])].filter(Boolean);
    if (keywords.length > 0) body.q_organization_keyword_tags = keywords;

    // Countries
    if (query.countries?.length) {
      const locations = query.countries.map(c => getCountryDisplayName(c) || c).filter(Boolean);
      if (locations.length > 0) body.organization_locations = locations;
    }

    const response = await fetch('https://api.apollo.io/api/v1/mixed_companies/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Apollo API error ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = await response.json() as {
      organizations?: ApolloOrg[];
      pagination?: { page: number; per_page: number; total_entries: number; total_pages: number };
    };

    const orgs = data.organizations || [];
    const items = orgs.map(org => this.normalize(org, query));
    const totalPages = data.pagination?.total_pages || 1;
    const hasMore = page < totalPages && page < 500;

    return {
      items,
      total: data.pagination?.total_entries || items.length,
      hasMore,
      metadata: { source: this.code, query, fetchedAt: new Date(), duration: Date.now() - startTime, rawFetched: items.length },
    };
  }

  private normalize(org: ApolloOrg, query: SearchQuery): NormalizedCandidate {
    const website = org.website_url || (org.primary_domain ? `https://${org.primary_domain}` : undefined);
    const keywords = query.keywords || [];
    const searchText = `${org.name} ${org.industry || ''} ${org.short_description || ''} ${(org.keywords || []).join(' ')}`.toLowerCase();
    const matchedCount = keywords.filter(kw => searchText.includes(kw.toLowerCase())).length;
    const matchScore = keywords.length > 0 ? Math.min(1, 0.4 + (matchedCount / keywords.length) * 0.6) : 0.5;

    return {
      externalId: `apollo_${org.id}`,
      sourceUrl: org.linkedin_url || website || `https://app.apollo.io/#/organizations/${org.id}`,
      displayName: org.name,
      candidateType: 'COMPANY',
      website,
      description: org.short_description,
      country: org.country,
      city: org.city,
      industry: org.industry,
      companySize: org.estimated_num_employees ? this.sizeLabel(org.estimated_num_employees) : undefined,
      matchScore: Math.round(matchScore * 100) / 100,
      matchExplain: {
        channel: 'apollo',
        reasons: ['Apollo structured data', org.website_url ? 'Has website' : undefined, org.linkedin_url ? 'Has LinkedIn' : undefined].filter(Boolean) as string[],
        matchedKeywords: org.keywords?.slice(0, 5),
      },
      rawData: {
        source: 'apollo',
        apolloId: org.id,
        employeeCount: org.estimated_num_employees,
        annualRevenue: org.annual_revenue_printed,
        linkedinUrl: org.linkedin_url,
      },
    };
  }

  private sizeLabel(count: number): string {
    if (count <= 10) return '1-10';
    if (count <= 50) return '11-50';
    if (count <= 200) return '51-200';
    if (count <= 1000) return '201-1000';
    if (count <= 10000) return '1001-10000';
    return '10000+';
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.apiKey) return { healthy: false, latency: 0, error: 'API key not configured' };
    const start = Date.now();
    try {
      const res = await fetch('https://api.apollo.io/api/v1/mixed_companies/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey },
        body: JSON.stringify({ q_organization_keyword_tags: ['tech'], per_page: 1, page: 1 }),
        signal: AbortSignal.timeout(5000),
      });
      return { healthy: res.ok, latency: Date.now() - start, error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (e) {
      return { healthy: false, latency: Date.now() - start, error: e instanceof Error ? e.message : 'Unknown' };
    }
  }
}
