/**
 * Hunter.io 适配器 - 精简版
 * 邮箱域名搜索 + 验证
 */

import type { Adapter, SearchQuery, SearchResult, NormalizedCandidate, HealthStatus, AdapterConfig } from './types.js';

interface HunterEmail {
  value: string;
  type: string;
  confidence: number;
  first_name: string;
  last_name: string;
  position?: string;
  phone_number?: string;
  linkedin?: string;
}

export class HunterAdapter implements Adapter {
  readonly code = 'hunter';
  readonly channelType = 'DIRECTORY' as const;
  readonly features = {
    supportsKeywordSearch: false,
    supportsRegionFilter: false,
    supportsPagination: true,
    supportsDetails: true,
    maxResultsPerQuery: 100,
  };

  private apiKey: string;
  private baseUrl = 'https://api.hunter.io/v2';
  private timeout: number;

  constructor(cfg: AdapterConfig) {
    this.apiKey = cfg.apiKey || '';
    this.timeout = cfg.timeout || 30000;
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    const startTime = Date.now();
    if (!this.apiKey) throw new Error('Hunter API key not configured');

    const domain = query.keywords?.[0] || '';
    if (!domain) {
      return { items: [], total: 0, hasMore: false, metadata: { source: this.code, query, fetchedAt: new Date(), duration: 0 } };
    }

    const params = new URLSearchParams({
      domain,
      api_key: this.apiKey,
      limit: String(Math.min(query.pageSize || 20, 100)),
    });

    const response = await fetch(`${this.baseUrl}/domain-search?${params}`, {
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) throw new Error(`Hunter API error: ${response.status}`);

    const data = await response.json() as {
      data: { emails: HunterEmail[]; meta: { results: number } };
    };

    const items = data.data.emails.map(email => this.normalize(email, domain));

    return {
      items,
      total: data.data.meta.results,
      hasMore: items.length >= (query.pageSize || 20),
      metadata: { source: this.code, query, fetchedAt: new Date(), duration: Date.now() - startTime, rawFetched: items.length },
    };
  }

  async verifyEmail(email: string): Promise<{ valid: boolean; status: string; score: number }> {
    if (!this.apiKey) throw new Error('Hunter API key not configured');
    const params = new URLSearchParams({ email, api_key: this.apiKey });
    const response = await fetch(`${this.baseUrl}/email-verifier?${params}`, { signal: AbortSignal.timeout(this.timeout) });
    if (!response.ok) throw new Error(`Hunter API error: ${response.status}`);
    const data = await response.json() as { data: { status: string; score: number } };
    return { valid: data.data.status === 'valid', status: data.data.status, score: data.data.score };
  }

  private normalize(email: HunterEmail, domain: string): NormalizedCandidate {
    return {
      externalId: `hunter-${email.value}`,
      sourceUrl: `https://hunter.io/verify/${email.value}`,
      displayName: `${email.first_name} ${email.last_name}`.trim() || email.value,
      candidateType: 'CONTACT',
      email: email.value,
      phone: email.phone_number,
      matchScore: email.confidence / 100,
      matchExplain: { channel: 'hunter', reasons: [`Confidence: ${email.confidence}%`] },
      rawData: { source: 'hunter', domain, position: email.position, linkedin: email.linkedin },
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.apiKey) return { healthy: false, latency: 0, error: 'API key not configured' };
    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/account?api_key=${this.apiKey}`, { signal: AbortSignal.timeout(10000) });
      return { healthy: res.ok, latency: Date.now() - start, error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (e) {
      return { healthy: false, latency: Date.now() - start, error: e instanceof Error ? e.message : 'Unknown' };
    }
  }
}
