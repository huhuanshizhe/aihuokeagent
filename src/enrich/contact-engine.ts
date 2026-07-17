/**
 * 联系人情报引擎 - 精简版
 * 从 src/lib/osint/contact-enrichment/enrichment-engine.ts 提取核心逻辑
 */

import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db.js';
import { candidates, enrichments } from '../db/schema.js';
import { enrichWithExa, type ExaEnrichResult } from './exa-enrich.js';
import { huntDecisionMakers, type DecisionMaker } from './decision-maker.js';
import { config } from '../config.js';
import { chatCompletion, parseAIJson } from '../ai/client.js';
import { scrapeWithFirecrawl, type FirecrawlResult } from './firecrawl.js';
import { normalizeDomain } from '../pipeline/candidate-utils.js';
import { crawlCompanyWebsite, type WebsiteCrawlResult } from './website-crawler.js';
import { addEvidence, resolveEvidence, type FieldConflict, type FieldEvidence } from './evidence.js';

// ==================== 类型 ====================

export interface EnrichOptions {
  candidateIds?: string[];
  companyName?: string;
  domain?: string;
  country?: string;
  industry?: string;
  skipDecisionMakers?: boolean;
  concurrency?: number;
  depth?: 'standard' | 'deep';
}

export interface EnrichmentStage {
  status: 'completed' | 'skipped' | 'failed';
  duration: number;
  reason?: string;
}

export interface EnrichResult {
  enrichmentId: string;
  candidateId?: string;
  companyName: string;
  country?: string;
  domain?: string;
  website?: string;
  linkedInUrl?: string;
  emails: string[];
  phones: string[];
  decisionMakers: DecisionMaker[];
  description?: string;
  // CRM 扩展字段
  businessType?: string;
  products?: string[];
  brands?: string[];
  employeesCount?: string;
  isTargetCustomer?: boolean;
  targetReason?: string;
  confidenceScore: number;
  status: 'completed' | 'partial' | 'failed';
  errors: string[];
  stages: Record<string, EnrichmentStage>;
  fieldEvidence: FieldEvidence[];
  conflicts: FieldConflict[];
  informationGaps: string[];
  recommendedChannel: 'email' | 'phone' | 'linkedin' | 'contact_form' | 'research';
}

// ==================== 主流程 ====================

export async function runEnrich(options: EnrichOptions): Promise<EnrichResult[]> {
  // 如果提供了 candidateIds，从数据库读取
  if (options.candidateIds?.length) {
    const tasks = options.candidateIds.map(candidateId => async () => {
      const rows = await db.select().from(candidates).where(eq(candidates.id, candidateId)).limit(1);
      const candidate = rows[0];
      if (!candidate) return undefined;

      return enrichOne({
        candidateId,
        companyName: candidate.displayName,
        domain: candidate.website ? extractDomain(candidate.website) : undefined,
        website: candidate.website || undefined,
        email: candidate.email || undefined,
        phone: candidate.phone || undefined,
        description: candidate.description || undefined,
        country: candidate.country || undefined,
        industry: candidate.industry || undefined,
        businessType: candidate.businessType || undefined,
        products: parseStoredStringArray(candidate.products),
        brands: parseStoredStringArray(candidate.brands),
        employeesCount: candidate.employeesCount || undefined,
        isTargetCustomer: Boolean(candidate.isTargetCustomer),
        targetReason: candidate.targetReason || undefined,
        skipDecisionMakers: options.skipDecisionMakers,
        depth: options.depth,
      });
    });
    const results = await runWithConcurrency(tasks, options.concurrency || 3);
    return results.filter((result): result is EnrichResult => Boolean(result));
  } else if (options.companyName) {
    const result = await enrichOne({
      companyName: options.companyName,
      domain: options.domain,
      website: options.domain,
      country: options.country,
      industry: options.industry,
      skipDecisionMakers: options.skipDecisionMakers,
      depth: options.depth,
    });
    return [result];
  }

  return [];
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
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

// ==================== AI 提取 CRM 字段 ====================

interface CRMProfile {
  businessType?: string;
  products?: string[];
  brands?: string[];
  employeesCount?: string;
}

async function extractCRMProfile(companyName: string, description?: string, industry?: string): Promise<CRMProfile> {
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
  return parseAIJson<CRMProfile>(response.content);
}

// ==================== 单个企业补全 ====================

async function enrichOne(params: {
  candidateId?: string;
  companyName: string;
  domain?: string;
  website?: string;
  email?: string;
  phone?: string;
  description?: string;
  country?: string | null;
  industry?: string | null;
  businessType?: string;
  products?: string[];
  brands?: string[];
  employeesCount?: string;
  isTargetCustomer?: boolean;
  targetReason?: string;
  skipDecisionMakers?: boolean;
  depth?: 'standard' | 'deep';
}): Promise<EnrichResult> {
  const enrichmentId = randomUUID();
  const errors: string[] = [];
  const stages: Record<string, EnrichmentStage> = {};
  let exaResult: ExaEnrichResult = {};
  let decisionMakers: DecisionMaker[] = [];
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
  const emails: string[] = params.email ? [params.email] : [];
  if (exaResult.email) emails.push(exaResult.email);
  const phones: string[] = params.phone ? [params.phone] : [];

  const initialEvidence: FieldEvidence[] = [];
  addEvidence(initialEvidence, 'website', params.website, 'discovery', 0.72, params.website);
  addEvidence(initialEvidence, 'website', exaResult.website, 'exa', 0.62, exaResult.website);
  const initialWebsiteResolution = resolveEvidence('website', initialEvidence);
  const website = initialWebsiteResolution.value;
  const domain = params.domain || (website ? extractDomain(website) : undefined);
  let firecrawlResult: FirecrawlResult = {};
  let websiteResult: WebsiteCrawlResult | undefined;
  let hunterEmails: string[] = [];

  await Promise.all([
    runStage('hunter', Boolean(domain && config.hunter.apiKey), stages, async () => {
      hunterEmails = await hunterDomainSearch(domain as string);
      for (const e of hunterEmails) {
        addUnique(emails, e);
      }
    }, errors, domain ? 'HUNTER_API_KEY not configured' : 'company domain unavailable'),
    runStage('officialWebsite', Boolean(website), stages, async () => {
      websiteResult = await crawlCompanyWebsite(website as string, params.companyName);
      for (const email of websiteResult.emails) addUnique(emails, email);
      for (const phone of websiteResult.phones) addUnique(phones, phone);
    }, errors, 'company website unavailable'),
    runStage('firecrawl', Boolean(deep && website && config.firecrawl.apiKey && config.ai.apiKey), stages, async () => {
      firecrawlResult = await scrapeWithFirecrawl(website as string);
      for (const email of firecrawlResult.emails || []) addUnique(emails, email);
      for (const phone of firecrawlResult.phones || []) addUnique(phones, phone);
    }, errors, !deep ? 'deep enrichment disabled' : website ? 'Firecrawl or AI key not configured' : 'company website unavailable'),
  ]);

  // Search-discovered domains are only leads. Do not promote their contacts or
  // persist them as official websites until the website is reachable and the
  // company identity matches. Discovery-supplied websites retain their original evidence.
  const searchedWebsiteVerified = Boolean(websiteResult?.identityMatched);
  if (!params.website && !searchedWebsiteVerified) {
    for (const value of [exaResult.email, ...hunterEmails]) {
      if (!value) continue;
      const index = emails.findIndex(email => email.toLowerCase() === value.toLowerCase());
      if (index >= 0) emails.splice(index, 1);
    }
  }
  const verifiedWebsite = params.website || (searchedWebsiteVerified ? websiteResult?.website : undefined);
  const verifiedDomain = verifiedWebsite ? extractDomain(verifiedWebsite) : params.domain;

  // 3. AI profile extraction is optional and should not turn a usable lead into a failed lead.
  let crmProfile: CRMProfile = {};
  await runStage('aiProfile', Boolean(deep && config.ai.apiKey), stages, async () => {
    crmProfile = await extractCRMProfile(
      params.companyName,
      firecrawlResult.description || exaResult.description || params.description,
      params.industry || undefined,
    );
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
  ].filter((value): value is string => Boolean(value));
  const recommendedChannel: EnrichResult['recommendedChannel'] = finalEmails.length
    ? 'email'
    : finalPhones.length
      ? 'phone'
      : linkedInUrl
        ? 'linkedin'
        : 'research';
  const confidenceScore = calcConfidence({ ...exaResult, website: verifiedWebsite, linkedInUrl, description }, emails, phones, decisionMakers);
  const status: EnrichResult['status'] = confidenceScore >= 0.6
    ? 'completed'
    : confidenceScore > 0
      ? 'partial'
      : 'failed';

  const result: EnrichResult = {
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
  await saveEnrichment(enrichmentId, result);

  return result;
}

// ==================== Hunter 域名搜索 ====================

async function hunterDomainSearch(domain: string): Promise<string[]> {
  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${config.hunter.apiKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return [];
  const data = await res.json() as { data?: { emails?: Array<{ value: string }> } };
  return (data.data?.emails || []).map(e => e.value).slice(0, 5);
}

// ==================== 工具函数 ====================

function extractDomain(url: string): string | undefined {
  return normalizeDomain(url);
}

function calcConfidence(exa: ExaEnrichResult, emails: string[], phones: string[], dm: DecisionMaker[]): number {
  let score = 0;
  if (exa.website) score += 0.25;
  if (exa.linkedInUrl) score += 0.15;
  if (emails.length > 0) score += 0.25;
  if (phones.length > 0) score += 0.1;
  if (dm.length > 0) score += 0.15;
  if (exa.description) score += 0.1;
  return Math.round(score * 100) / 100;
}

async function runStage(
  name: string,
  enabled: boolean,
  stages: Record<string, EnrichmentStage>,
  operation: () => Promise<void>,
  errors: string[],
  skipReason: string,
): Promise<void> {
  const startedAt = Date.now();
  if (!enabled) {
    stages[name] = { status: 'skipped', duration: 0, reason: skipReason };
    return;
  }
  try {
    await operation();
    stages[name] = { status: 'completed', duration: Date.now() - startedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`${name}: ${message}`);
    stages[name] = { status: 'failed', duration: Date.now() - startedAt, reason: message };
  }
}

function addUnique(values: string[], value: string): void {
  const normalized = value.trim();
  if (normalized && !values.some(existing => existing.toLowerCase() === normalized.toLowerCase())) values.push(normalized);
}

function dedupeContactValues(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) addUnique(result, value);
  return result;
}

function firstNonEmptyArray(...values: Array<string[] | undefined>): string[] | undefined {
  return values.find(value => value && value.length > 0);
}

function parseStoredStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : undefined;
  } catch {
    return undefined;
  }
}

function buildFieldEvidence(
  params: Parameters<typeof enrichOne>[0],
  exa: ExaEnrichResult,
  websiteResult: WebsiteCrawlResult | undefined,
  firecrawl: FirecrawlResult,
  hunterEmails: string[],
  crm: CRMProfile,
  website: string | undefined,
  linkedInUrl: string | undefined,
): FieldEvidence[] {
  const evidence: FieldEvidence[] = [];
  addEvidence(evidence, 'website', params.website, 'discovery', 0.72, params.website);
  addEvidence(evidence, 'email', params.email, 'discovery', 0.6, params.website);
  addEvidence(evidence, 'phone', params.phone, 'discovery', 0.62, params.website);
  addEvidence(evidence, 'description', params.description, 'discovery', 0.55, params.website);
  addEvidence(evidence, 'website', exa.website, 'exa', 0.62, exa.website);
  addEvidence(evidence, 'email', exa.email, 'exa', 0.58, exa.website);
  addEvidence(evidence, 'linkedinUrl', exa.linkedInUrl, 'exa', 0.72, exa.linkedInUrl);
  if (websiteResult) {
    addEvidence(evidence, 'website', websiteResult.website, 'official_website', websiteResult.identityConfidence, websiteResult.website);
    for (const email of websiteResult.emails) addEvidence(evidence, 'email', email, 'official_website', 0.95, websiteResult.website);
    for (const phone of websiteResult.phones) addEvidence(evidence, 'phone', phone, 'official_website', 0.92, websiteResult.website);
    addEvidence(evidence, 'linkedinUrl', websiteResult.linkedInUrl, 'official_website', 0.94, websiteResult.website);
    addEvidence(evidence, 'description', websiteResult.description, 'official_website', 0.88, websiteResult.website);
  }
  for (const email of hunterEmails) addEvidence(evidence, 'email', email, 'hunter', 0.82, website);
  for (const email of firecrawl.emails || []) addEvidence(evidence, 'email', email, 'firecrawl', 0.84, website);
  for (const phone of firecrawl.phones || []) addEvidence(evidence, 'phone', phone, 'firecrawl', 0.82, website);
  addEvidence(evidence, 'businessType', crm.businessType, 'ai_profile', 0.5, website);
  addEvidence(evidence, 'businessType', params.businessType, 'discovery', 0.55, params.website);
  addEvidence(evidence, 'linkedinUrl', linkedInUrl, websiteResult?.linkedInUrl ? 'official_website' : 'exa', websiteResult?.linkedInUrl ? 0.94 : 0.72, website);
  return evidence;
}

async function saveEnrichment(id: string, result: EnrichResult): Promise<void> {
  const stamp = new Date().toISOString();
  const existing = await db.select({ id: enrichments.id, createdAt: enrichments.createdAt })
    .from(enrichments)
    .where(eq(enrichments.id, id))
    .limit(1);

  const row = {
    id,
    candidateId: result.candidateId || null,
    companyName: result.companyName,
    domain: result.domain || null,
    country: result.country || null,
    linkedinUrl: result.linkedInUrl || null,
    officialUrl: result.website || null,
    emails: JSON.stringify(result.emails),
    phones: JSON.stringify(result.phones),
    decisionMakers: JSON.stringify(result.decisionMakers),
    businessType: result.businessType || null,
    products: result.products ? JSON.stringify(result.products) : null,
    brands: result.brands ? JSON.stringify(result.brands) : null,
    employeesCount: result.employeesCount || null,
    isTargetCustomer: result.isTargetCustomer ?? null,
    targetReason: result.targetReason || null,
    enrichmentStatus: result.status,
    confidenceScore: result.confidenceScore,
    recommendedChannel: result.recommendedChannel,
    informationGaps: JSON.stringify(result.informationGaps),
    fieldEvidence: JSON.stringify(result.fieldEvidence),
    conflicts: JSON.stringify(result.conflicts),
    rawSnapshot: JSON.stringify({ description: result.description, errors: result.errors, stages: result.stages }),
    updatedAt: stamp,
  };

  if (existing[0]) {
    await db.update(enrichments).set(row).where(eq(enrichments.id, id));
  } else {
    await db.insert(enrichments).values({ ...row, createdAt: stamp });
  }

  if (result.candidateId) {
    const current = await db.select().from(candidates).where(eq(candidates.id, result.candidateId)).limit(1);
    const cand = current[0];
    if (cand) {
      await db.update(candidates).set({
        website: cand.website || result.website || null,
        email: cand.email || result.emails[0] || null,
        phone: cand.phone || result.phones[0] || null,
        description: cand.description || result.description || null,
        businessType: cand.businessType || result.businessType || null,
        products: cand.products || (result.products?.length ? JSON.stringify(result.products) : null),
        brands: cand.brands || (result.brands?.length ? JSON.stringify(result.brands) : null),
        employeesCount: cand.employeesCount || result.employeesCount || null,
        updatedAt: stamp,
      }).where(eq(candidates.id, result.candidateId));
    }
  }
}

/** Serialize enrichment row to snake_case for existing UI/API consumers */
function toEnrichmentRow(row: typeof enrichments.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    candidate_id: row.candidateId,
    company_name: row.companyName,
    domain: row.domain,
    country: row.country,
    normalized_domain: row.normalizedDomain,
    linkedin_url: row.linkedinUrl,
    official_url: row.officialUrl,
    identity_confidence: row.identityConfidence,
    emails: row.emails,
    phones: row.phones,
    addresses: row.addresses,
    contact_forms: row.contactForms,
    decision_makers: row.decisionMakers,
    capabilities: row.capabilities,
    business_type: row.businessType,
    products: row.products,
    brands: row.brands,
    employees_count: row.employeesCount,
    is_target_customer: row.isTargetCustomer ? 1 : 0,
    target_reason: row.targetReason,
    enrichment_status: row.enrichmentStatus,
    confidence_score: row.confidenceScore,
    recommended_channel: row.recommendedChannel,
    information_gaps: row.informationGaps,
    field_evidence: row.fieldEvidence,
    conflicts: row.conflicts,
    raw_snapshot: row.rawSnapshot,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

// ==================== 查询接口 ====================

export async function getEnrichment(enrichmentId: string): Promise<Record<string, unknown> | null> {
  const rows = await db.select().from(enrichments).where(eq(enrichments.id, enrichmentId)).limit(1);
  return rows[0] ? toEnrichmentRow(rows[0]) : null;
}

export async function listEnrichments(limit = 50): Promise<Array<Record<string, unknown>>> {
  const rows = await db.select().from(enrichments).orderBy(desc(enrichments.createdAt)).limit(limit);
  return rows.map(toEnrichmentRow);
}

export async function getEnrichmentsByCandidate(candidateId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await db.select().from(enrichments)
    .where(eq(enrichments.candidateId, candidateId))
    .orderBy(desc(enrichments.createdAt));
  return rows.map(toEnrichmentRow);
}
