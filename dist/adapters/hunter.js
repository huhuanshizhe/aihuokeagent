/**
 * Hunter.io 适配器 - 精简版
 * 邮箱域名搜索 + 验证
 */
export class HunterAdapter {
    code = 'hunter';
    channelType = 'DIRECTORY';
    features = {
        supportsKeywordSearch: false,
        supportsRegionFilter: false,
        supportsPagination: true,
        supportsDetails: true,
        maxResultsPerQuery: 100,
    };
    apiKey;
    baseUrl = 'https://api.hunter.io/v2';
    timeout;
    constructor(cfg) {
        this.apiKey = cfg.apiKey || '';
        this.timeout = cfg.timeout || 30000;
    }
    async search(query) {
        const startTime = Date.now();
        if (!this.apiKey)
            throw new Error('Hunter API key not configured');
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
        if (!response.ok)
            throw new Error(`Hunter API error: ${response.status}`);
        const data = await response.json();
        const items = data.data.emails.map(email => this.normalize(email, domain));
        return {
            items,
            total: data.data.meta.results,
            hasMore: items.length >= (query.pageSize || 20),
            metadata: { source: this.code, query, fetchedAt: new Date(), duration: Date.now() - startTime, rawFetched: items.length },
        };
    }
    async verifyEmail(email) {
        if (!this.apiKey)
            throw new Error('Hunter API key not configured');
        const params = new URLSearchParams({ email, api_key: this.apiKey });
        const response = await fetch(`${this.baseUrl}/email-verifier?${params}`, { signal: AbortSignal.timeout(this.timeout) });
        if (!response.ok)
            throw new Error(`Hunter API error: ${response.status}`);
        const data = await response.json();
        return { valid: data.data.status === 'valid', status: data.data.status, score: data.data.score };
    }
    normalize(email, domain) {
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
    async healthCheck() {
        if (!this.apiKey)
            return { healthy: false, latency: 0, error: 'API key not configured' };
        const start = Date.now();
        try {
            const res = await fetch(`${this.baseUrl}/account?api_key=${this.apiKey}`, { signal: AbortSignal.timeout(10000) });
            return { healthy: res.ok, latency: Date.now() - start, error: res.ok ? undefined : `HTTP ${res.status}` };
        }
        catch (e) {
            return { healthy: false, latency: Date.now() - start, error: e instanceof Error ? e.message : 'Unknown' };
        }
    }
}
//# sourceMappingURL=hunter.js.map