import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

/** Scan job metadata */
export const scanRuns = pgTable('scan_runs', {
  id: text('id').primaryKey(),
  keywords: text('keywords').notNull(),
  countries: text('countries'),
  industry: text('industry'),
  adapterCode: text('adapter_code'),
  status: text('status').notNull().default('running'),
  totalFetched: integer('total_fetched').default(0),
  totalFound: integer('total_found').default(0),
  totalNew: integer('total_new').default(0),
  totalRejected: integer('total_rejected').default(0),
  totalQualified: integer('total_qualified').default(0),
  totalReview: integer('total_review').default(0),
  totalDeferred: integer('total_deferred').default(0),
  errors: text('errors'),
  diagnostics: text('diagnostics'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
});

/** Discovered company candidates */
export const candidates = pgTable(
  'candidates',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    adapterCode: text('adapter_code').notNull(),
    externalId: text('external_id').notNull(),
    displayName: text('display_name').notNull(),
    candidateType: text('candidate_type').default('COMPANY'),
    description: text('description'),
    website: text('website'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    country: text('country'),
    city: text('city'),
    industry: text('industry'),
    businessType: text('business_type'),
    products: text('products'),
    brands: text('brands'),
    employeesCount: text('employees_count'),
    isTargetCustomer: boolean('is_target_customer').default(false),
    targetReason: text('target_reason'),
    qualificationTier: text('qualification_tier'),
    qualificationReasons: text('qualification_reasons'),
    matchScore: doublePrecision('match_score'),
    matchExplain: text('match_explain'),
    identityKey: text('identity_key'),
    rawData: text('raw_data'),
    sourceUrl: text('source_url'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    adapterExternalUnique: uniqueIndex('candidates_adapter_external_uid').on(
      table.adapterCode,
      table.externalId,
    ),
    runIdIdx: index('idx_candidates_run_id').on(table.runId),
    countryIdx: index('idx_candidates_country').on(table.country),
    industryIdx: index('idx_candidates_industry').on(table.industry),
    identityIdx: index('idx_candidates_identity_key').on(table.identityKey),
  }),
);

/** Enrichment results */
export const enrichments = pgTable(
  'enrichments',
  {
    id: text('id').primaryKey(),
    candidateId: text('candidate_id'),
    companyName: text('company_name').notNull(),
    domain: text('domain'),
    country: text('country'),
    normalizedDomain: text('normalized_domain'),
    linkedinUrl: text('linkedin_url'),
    officialUrl: text('official_url'),
    identityConfidence: doublePrecision('identity_confidence'),
    emails: text('emails'),
    phones: text('phones'),
    addresses: text('addresses'),
    contactForms: text('contact_forms'),
    decisionMakers: text('decision_makers'),
    capabilities: text('capabilities'),
    businessType: text('business_type'),
    products: text('products'),
    brands: text('brands'),
    employeesCount: text('employees_count'),
    isTargetCustomer: boolean('is_target_customer'),
    targetReason: text('target_reason'),
    enrichmentStatus: text('enrichment_status').default('pending'),
    confidenceScore: doublePrecision('confidence_score'),
    recommendedChannel: text('recommended_channel'),
    informationGaps: text('information_gaps'),
    fieldEvidence: text('field_evidence'),
    conflicts: text('conflicts'),
    rawSnapshot: text('raw_snapshot'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    candidateIdx: index('idx_enrichments_candidate_id').on(table.candidateId),
  }),
);

export const scanRunCandidates = pgTable(
  'scan_run_candidates',
  {
    runId: text('run_id').notNull(),
    candidateId: text('candidate_id').notNull(),
    adapterCode: text('adapter_code').notNull(),
    discoveredAt: text('discovered_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.runId, table.candidateId] }),
    candidateIdx: index('idx_scan_run_candidates_candidate').on(table.candidateId),
  }),
);

export const candidateSources = pgTable(
  'candidate_sources',
  {
    candidateId: text('candidate_id').notNull(),
    adapterCode: text('adapter_code').notNull(),
    externalId: text('external_id').notNull(),
    sourceUrl: text('source_url'),
    rawData: text('raw_data'),
    discoveredAt: text('discovered_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.candidateId, table.adapterCode, table.externalId] }),
    candidateIdx: index('idx_candidate_sources_candidate').on(table.candidateId),
  }),
);

export const discoverySourceRuns = pgTable(
  'discovery_source_runs',
  {
    id: serial('id').primaryKey(),
    runId: text('run_id').notNull(),
    sourceCode: text('source_code').notNull(),
    countryCode: text('country_code'),
    industryPackId: text('industry_pack_id'),
    status: text('status').notNull(),
    fetched: integer('fetched').default(0),
    found: integer('found').default(0),
    qualified: integer('qualified').default(0),
    review: integer('review').default(0),
    rejected: integer('rejected').default(0),
    durationMs: integer('duration_ms').default(0),
    errorCode: text('error_code'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    runSourceUnique: uniqueIndex('discovery_source_runs_run_source_uid').on(
      table.runId,
      table.sourceCode,
    ),
    marketIdx: index('idx_source_runs_market').on(
      table.countryCode,
      table.industryPackId,
      table.sourceCode,
    ),
  }),
);
