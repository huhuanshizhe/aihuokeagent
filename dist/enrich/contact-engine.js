/**
 * 联系人情报引擎 - 精简版
 * 从 src/lib/osint/contact-enrichment/enrichment-engine.ts 提取核心逻辑
 */
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { enrichWithExa } from './exa-enrich.js';
import { huntDecisionMakers } from './decision-maker.js';
import { config } from '../config.js';
import { chatCompletion, parseAIJson } from '../ai/client.js';
import { scrapeWithFirecrawl } from './firecrawl.js';
import { normalizeDomain } from '../pipeline/candidate-utils.js';
import { crawlCompanyWebsite } from './website-crawler.js';
import { addEvidence, resolveEvidence } from './evidence.js';
// ==================== 主流程 ====================
export async function runEnrich(options) {
    // 如果提供了 candidateIds，从数据库读取
    if (options.candidateIds?.length) {
        const tasks = options.candidateIds.map(candidateId => async () => {
            const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId);
            if (!candidate)
                return undefined;
            return enrichOne({
                candidateId,
                companyName: candidate.display_name,
                domain: candidate.website ? extractDomain(candidate.website) : undefined,
                website: candidate.website,
                email: candidate.email,
                phone: candidate.phone,
                description: candidate.description,
                country: candidate.country,
                industry: candidate.industry,
                businessType: candidate.business_type,
                products: parseStoredStringArray(candidate.products),
                brands: parseStoredStringArray(candidate.brands),
                employeesCount: candidate.employees_count,
                isTargetCustomer: candidate.is_target_customer === 1,
                targetReason: candidate.target_reason,
                skipDecisionMakers: options.skipDecisionMakers,
                depth: options.depth,
            });
        });
        const results = await runWithConcurrency(tasks, options.concurrency || 3);
        const completed = results.filter((result) => Boolean(result));
        // API success means every enrichment and candidate write-back is durable.
        db.flush();
        return completed;
    }
    else if (options.companyName) {
        // 直接传入公司名
        const result = await enrichOne({
            companyName: options.companyName,
            domain: options.domain,
            website: options.domain,
            country: options.country,
            industry: options.industry,
            skipDecisionMakers: options.skipDecisionMakers,
            depth: options.depth,
        });
        db.flush();
        return [result];
    }
    return [];
}
async function runWithConcurrency(tasks, concurrency) {
    const results = new Array(tasks.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(Math.max(1, concurrency), tasks.length) }, async () => {
        while (nextIndex < tasks.length) {
            const index = nextIndex++;
            results[index] = await tasks[index]();
        }
    });
    await Promise.all(workers);
    return results;
}
async function extractCRMProfile(companyName, description, industry) {
    const prompt = `Analyze this company and extract CRM profile information. Return JSON only.

Company: ${companyName}
Industry: ${industry || 'Unknown'}
Description: ${description || 'No description available'}

Return JSON format:
{
  "businessType": "Manufacturer|Distributor|Retailer|Service Provider|Trading Company|Other",
  "products": ["product1", "product2"],
  "brands": ["brand1", "brand2"],
  "employeesCount": "1-10|11-50|51-200|201-500|501-1000|1000+"
}`;
    const response = await chatCompletion([
        { role: 'system', content: 'You are a B2B company analyst. Return only valid JSON and never infer facts without evidence.' },
        { role: 'user', content: prompt },
    ], { temperature: 0.2 });
    return parseAIJson(response.content);
}
// ==================== 单个企业补全 ====================
async function enrichOne(params) {
    const enrichmentId = randomUUID();
    const errors = [];
    const stages = {};
    let exaResult = {};
    let decisionMakers = [];
    const deep = params.depth === 'deep';
    // 1. Identity search and decision-maker discovery can run independently.
    await Promise.all([
        runStage('exa', Boolean(config.exa.apiKey) && (!params.website || deep), stages, async () => {
            exaResult = await enrichWithExa(params.companyName, params.country, params.industry);
        }, errors, params.website && !deep ? 'official website already supplied; deep identity search disabled' : 'EXA_API_KEY not configured'),
        runStage('decisionMakers', deep && !params.skipDecisionMakers && Boolean(config.exa.apiKey) && Boolean(config.ai.apiKey), stages, async () => {
            decisionMakers = await huntDecisionMakers(params.companyName);
        }, errors, !deep ? 'deep enrichment disabled' : params.skipDecisionMakers ? 'disabled by request' : 'Exa or AI key not configured'),
    ]);
    // 2. Preserve discovery evidence, then enrich the resolved company website.
    const emails = params.email ? [params.email] : [];
    if (exaResult.email)
        emails.push(exaResult.email);
    const phones = params.phone ? [params.phone] : [];
    const initialEvidence = [];
    addEvidence(initialEvidence, 'website', params.website, 'discovery', 0.72, params.website);
    addEvidence(initialEvidence, 'website', exaResult.website, 'exa', 0.62, exaResult.website);
    const initialWebsiteResolution = resolveEvidence('website', initialEvidence);
    const website = initialWebsiteResolution.value;
    const domain = params.domain || (website ? extractDomain(website) : undefined);
    let firecrawlResult = {};
    let websiteResult;
    let hunterEmails = [];
    await Promise.all([
        runStage('hunter', Boolean(domain && config.hunter.apiKey), stages, async () => {
            hunterEmails = await hunterDomainSearch(domain);
            for (const e of hunterEmails) {
                addUnique(emails, e);
            }
        }, errors, domain ? 'HUNTER_API_KEY not configured' : 'company domain unavailable'),
        runStage('officialWebsite', Boolean(website), stages, async () => {
            websiteResult = await crawlCompanyWebsite(website, params.companyName);
            for (const email of websiteResult.emails)
                addUnique(emails, email);
            for (const phone of websiteResult.phones)
                addUnique(phones, phone);
        }, errors, 'company website unavailable'),
        runStage('firecrawl', Boolean(deep && website && config.firecrawl.apiKey && config.ai.apiKey), stages, async () => {
            firecrawlResult = await scrapeWithFirecrawl(website);
            for (const email of firecrawlResult.emails || [])
                addUnique(emails, email);
            for (const phone of firecrawlResult.phones || [])
                addUnique(phones, phone);
        }, errors, !deep ? 'deep enrichment disabled' : website ? 'Firecrawl or AI key not configured' : 'company website unavailable'),
    ]);
    // Search-discovered domains are only leads. Do not promote their contacts or
    // persist them as official websites until the website is reachable and the
    // company identity matches. Discovery-supplied websites retain their original evidence.
    const searchedWebsiteVerified = Boolean(websiteResult?.identityMatched);
    if (!params.website && !searchedWebsiteVerified) {
        for (const value of [exaResult.email, ...hunterEmails]) {
            if (!value)
                continue;
            const index = emails.findIndex(email => email.toLowerCase() === value.toLowerCase());
            if (index >= 0)
                emails.splice(index, 1);
        }
    }
    const verifiedWebsite = params.website || (searchedWebsiteVerified ? websiteResult?.website : undefined);
    const verifiedDomain = verifiedWebsite ? extractDomain(verifiedWebsite) : params.domain;
    // 3. AI profile extraction is optional and should not turn a usable lead into a failed lead.
    let crmProfile = {};
    await runStage('aiProfile', Boolean(deep && config.ai.apiKey), stages, async () => {
        crmProfile = await extractCRMProfile(params.companyName, firecrawlResult.description || exaResult.description || params.description, params.industry || undefined);
    }, errors, !deep ? 'deep enrichment disabled' : 'DASHSCOPE_API_KEY not configured');
    // 4. Quality is based on resulting evidence, not on whether every optional provider ran.
    const description = firecrawlResult.description || exaResult.description || params.description;
    const linkedInUrl = websiteResult?.linkedInUrl || exaResult.linkedInUrl || firecrawlResult.socialLinks?.linkedin;
    const fieldEvidence = buildFieldEvidence(params, exaResult, websiteResult, firecrawlResult, hunterEmails, crmProfile, verifiedWebsite, linkedInUrl);
    const conflicts = ['website', 'businessType'].flatMap(field => {
        const conflict = resolveEvidence(field, fieldEvidence).conflict;
        return conflict ? [conflict] : [];
    });
    const finalEmails = dedupeContactValues(emails);
    const finalPhones = dedupeContactValues(phones);
    const informationGaps = [
        !website ? 'official_website' : undefined,
        !finalEmails.length ? 'email' : undefined,
        !finalPhones.length ? 'phone' : undefined,
        !linkedInUrl ? 'linkedin_company' : undefined,
        !decisionMakers.length ? 'decision_maker' : undefined,
    ].filter((value) => Boolean(value));
    const recommendedChannel = finalEmails.length
        ? 'email'
        : finalPhones.length
            ? 'phone'
            : linkedInUrl
                ? 'linkedin'
                : 'research';
    const confidenceScore = calcConfidence({ ...exaResult, website: verifiedWebsite, linkedInUrl, description }, emails, phones, decisionMakers);
    const status = confidenceScore >= 0.6
        ? 'completed'
        : confidenceScore > 0
            ? 'partial'
            : 'failed';
    const result = {
        enrichmentId,
        candidateId: params.candidateId,
        companyName: params.companyName,
        country: params.country || undefined,
        domain: verifiedDomain,
        website: verifiedWebsite,
        linkedInUrl,
        emails: finalEmails,
        phones: finalPhones,
        decisionMakers,
        description,
        // CRM 字段
        businessType: crmProfile.businessType || exaResult.businessType || params.businessType,
        products: firstNonEmptyArray(crmProfile.products, firecrawlResult.products, exaResult.products, params.products),
        brands: firstNonEmptyArray(crmProfile.brands, exaResult.brands, params.brands),
        employeesCount: crmProfile.employeesCount || exaResult.employeesCount || params.employeesCount,
        isTargetCustomer: params.isTargetCustomer,
        targetReason: params.targetReason,
        confidenceScore,
        status,
        errors,
        stages,
        fieldEvidence,
        conflicts,
        informationGaps,
        recommendedChannel,
    };
    // 6. 入库
    saveEnrichment(enrichmentId, result);
    return result;
}
// ==================== Hunter 域名搜索 ====================
async function hunterDomainSearch(domain) {
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${config.hunter.apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok)
        return [];
    const data = await res.json();
    return (data.data?.emails || []).map(e => e.value).slice(0, 5);
}
// ==================== 工具函数 ====================
function extractDomain(url) {
    return normalizeDomain(url);
}
function calcConfidence(exa, emails, phones, dm) {
    let score = 0;
    if (exa.website)
        score += 0.25;
    if (exa.linkedInUrl)
        score += 0.15;
    if (emails.length > 0)
        score += 0.25;
    if (phones.length > 0)
        score += 0.1;
    if (dm.length > 0)
        score += 0.15;
    if (exa.description)
        score += 0.1;
    return Math.round(score * 100) / 100;
}
async function runStage(name, enabled, stages, operation, errors, skipReason) {
    const startedAt = Date.now();
    if (!enabled) {
        stages[name] = { status: 'skipped', duration: 0, reason: skipReason };
        return;
    }
    try {
        await operation();
        stages[name] = { status: 'completed', duration: Date.now() - startedAt };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${name}: ${message}`);
        stages[name] = { status: 'failed', duration: Date.now() - startedAt, reason: message };
    }
}
function addUnique(values, value) {
    const normalized = value.trim();
    if (normalized && !values.some(existing => existing.toLowerCase() === normalized.toLowerCase()))
        values.push(normalized);
}
function dedupeContactValues(values) {
    const result = [];
    for (const value of values)
        addUnique(result, value);
    return result;
}
function firstNonEmptyArray(...values) {
    return values.find(value => value && value.length > 0);
}
function parseStoredStringArray(value) {
    if (Array.isArray(value))
        return value.filter((item) => typeof item === 'string');
    if (typeof value !== 'string' || !value)
        return undefined;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : undefined;
    }
    catch {
        return undefined;
    }
}
function buildFieldEvidence(params, exa, websiteResult, firecrawl, hunterEmails, crm, website, linkedInUrl) {
    const evidence = [];
    addEvidence(evidence, 'website', params.website, 'discovery', 0.72, params.website);
    addEvidence(evidence, 'email', params.email, 'discovery', 0.6, params.website);
    addEvidence(evidence, 'phone', params.phone, 'discovery', 0.62, params.website);
    addEvidence(evidence, 'description', params.description, 'discovery', 0.55, params.website);
    addEvidence(evidence, 'website', exa.website, 'exa', 0.62, exa.website);
    addEvidence(evidence, 'email', exa.email, 'exa', 0.58, exa.website);
    addEvidence(evidence, 'linkedinUrl', exa.linkedInUrl, 'exa', 0.72, exa.linkedInUrl);
    if (websiteResult) {
        addEvidence(evidence, 'website', websiteResult.website, 'official_website', websiteResult.identityConfidence, websiteResult.website);
        for (const email of websiteResult.emails)
            addEvidence(evidence, 'email', email, 'official_website', 0.95, websiteResult.website);
        for (const phone of websiteResult.phones)
            addEvidence(evidence, 'phone', phone, 'official_website', 0.92, websiteResult.website);
        addEvidence(evidence, 'linkedinUrl', websiteResult.linkedInUrl, 'official_website', 0.94, websiteResult.website);
        addEvidence(evidence, 'description', websiteResult.description, 'official_website', 0.88, websiteResult.website);
    }
    for (const email of hunterEmails)
        addEvidence(evidence, 'email', email, 'hunter', 0.82, website);
    for (const email of firecrawl.emails || [])
        addEvidence(evidence, 'email', email, 'firecrawl', 0.84, website);
    for (const phone of firecrawl.phones || [])
        addEvidence(evidence, 'phone', phone, 'firecrawl', 0.82, website);
    addEvidence(evidence, 'businessType', crm.businessType, 'ai_profile', 0.5, website);
    addEvidence(evidence, 'businessType', params.businessType, 'discovery', 0.55, params.website);
    addEvidence(evidence, 'linkedinUrl', linkedInUrl, websiteResult?.linkedInUrl ? 'official_website' : 'exa', websiteResult?.linkedInUrl ? 0.94 : 0.72, website);
    return evidence;
}
function saveEnrichment(id, result) {
    db.prepare(`
    INSERT OR REPLACE INTO enrichments
      (id, candidate_id, company_name, domain, country, linkedin_url, official_url,
       emails, phones, decision_makers,
       business_type, products, brands, employees_count, is_target_customer, target_reason,
       enrichment_status, confidence_score, recommended_channel, information_gaps,
       field_evidence, conflicts, raw_snapshot, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(id, result.candidateId || null, result.companyName, result.domain || null, result.country || null, result.linkedInUrl || null, result.website || null, JSON.stringify(result.emails), JSON.stringify(result.phones), JSON.stringify(result.decisionMakers), result.businessType || null, result.products ? JSON.stringify(result.products) : null, result.brands ? JSON.stringify(result.brands) : null, result.employeesCount || null, result.isTargetCustomer === undefined ? null : result.isTargetCustomer ? 1 : 0, result.targetReason || null, result.status, result.confidenceScore, result.recommendedChannel, JSON.stringify(result.informationGaps), JSON.stringify(result.fieldEvidence), JSON.stringify(result.conflicts), JSON.stringify({ description: result.description, errors: result.errors, stages: result.stages }));
    if (result.candidateId) {
        db.prepare(`
      UPDATE candidates SET
        website = COALESCE(?, website), email = COALESCE(?, email), phone = COALESCE(?, phone),
        description = COALESCE(?, description), business_type = COALESCE(?, business_type),
        products = COALESCE(?, products), brands = COALESCE(?, brands), employees_count = COALESCE(?, employees_count),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(result.website || null, result.emails[0] || null, result.phones[0] || null, result.description || null, result.businessType || null, result.products?.length ? JSON.stringify(result.products) : null, result.brands?.length ? JSON.stringify(result.brands) : null, result.employeesCount || null, result.candidateId);
    }
}
// ==================== 查询接口 ====================
export function getEnrichment(enrichmentId) {
    return db.prepare('SELECT * FROM enrichments WHERE id = ?').get(enrichmentId);
}
export function listEnrichments(limit = 50) {
    return db.prepare('SELECT * FROM enrichments ORDER BY created_at DESC LIMIT ?').all(limit);
}
export function getEnrichmentsByCandidate(candidateId) {
    return db.prepare('SELECT * FROM enrichments WHERE candidate_id = ? ORDER BY created_at DESC').all(candidateId);
}
//# sourceMappingURL=contact-engine.js.map