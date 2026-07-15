/**
 * SQLite 表定义 & 迁移
 * 3 张核心表：scan_runs, candidates, enrichments
 */
import { getDb } from './db.js';
import { buildCandidateIdentity } from './pipeline/candidate-utils.js';
export function initSchema() {
    const db = getDb();
    db.exec(`
    -- 扫描运行记录
    CREATE TABLE IF NOT EXISTS scan_runs (
      id TEXT PRIMARY KEY,
      keywords TEXT NOT NULL,
      countries TEXT,
      industry TEXT,
      adapter_code TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      total_fetched INTEGER DEFAULT 0,
      total_found INTEGER DEFAULT 0,
      total_new INTEGER DEFAULT 0,
      total_rejected INTEGER DEFAULT 0,
      total_qualified INTEGER DEFAULT 0,
      total_review INTEGER DEFAULT 0,
      total_deferred INTEGER DEFAULT 0,
      errors TEXT,
      diagnostics TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );

    -- 发现的企业候选
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      adapter_code TEXT NOT NULL,
      external_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      candidate_type TEXT DEFAULT 'COMPANY',
      description TEXT,
      website TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      country TEXT,
      city TEXT,
      industry TEXT,
      -- CRM 扩展字段
      business_type TEXT,
      products TEXT,
      brands TEXT,
      employees_count TEXT,
      is_target_customer INTEGER DEFAULT 0,
      target_reason TEXT,
      qualification_tier TEXT,
      qualification_reasons TEXT,
      -- 评分 & 元数据
      match_score REAL,
      match_explain TEXT,
      identity_key TEXT,
      raw_data TEXT,
      source_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(adapter_code, external_id)
    );

    -- 情报补全结果
    CREATE TABLE IF NOT EXISTS enrichments (
      id TEXT PRIMARY KEY,
      candidate_id TEXT,
      company_name TEXT NOT NULL,
      domain TEXT,
      country TEXT,
      -- 身份归一化
      normalized_domain TEXT,
      linkedin_url TEXT,
      official_url TEXT,
      identity_confidence REAL,
      -- 联系方式
      emails TEXT,
      phones TEXT,
      addresses TEXT,
      contact_forms TEXT,
      -- 决策人
      decision_makers TEXT,
      -- 能力画像
      capabilities TEXT,
      -- CRM 扩展字段
      business_type TEXT,
      products TEXT,
      brands TEXT,
      employees_count TEXT,
      is_target_customer INTEGER DEFAULT 0,
      target_reason TEXT,
      -- 元数据
      enrichment_status TEXT DEFAULT 'pending',
      confidence_score REAL,
      recommended_channel TEXT,
      information_gaps TEXT,
      field_evidence TEXT,
      conflicts TEXT,
      raw_snapshot TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 索引
    CREATE INDEX IF NOT EXISTS idx_candidates_run_id ON candidates(run_id);
    CREATE INDEX IF NOT EXISTS idx_candidates_country ON candidates(country);
    CREATE INDEX IF NOT EXISTS idx_candidates_industry ON candidates(industry);
    CREATE INDEX IF NOT EXISTS idx_enrichments_candidate_id ON enrichments(candidate_id);

    -- A candidate may appear in many scans. Keep discovery history without duplicating the company.
    CREATE TABLE IF NOT EXISTS scan_run_candidates (
      run_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      adapter_code TEXT NOT NULL,
      discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (run_id, candidate_id),
      FOREIGN KEY (run_id) REFERENCES scan_runs(id),
      FOREIGN KEY (candidate_id) REFERENCES candidates(id)
    );
    CREATE INDEX IF NOT EXISTS idx_scan_run_candidates_candidate ON scan_run_candidates(candidate_id);

    -- Preserve provider evidence even when multiple sources resolve to one company.
    CREATE TABLE IF NOT EXISTS candidate_sources (
      candidate_id TEXT NOT NULL,
      adapter_code TEXT NOT NULL,
      external_id TEXT NOT NULL,
      source_url TEXT,
      raw_data TEXT,
      discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (candidate_id, adapter_code, external_id),
      FOREIGN KEY (candidate_id) REFERENCES candidates(id)
    );
    CREATE INDEX IF NOT EXISTS idx_candidate_sources_candidate ON candidate_sources(candidate_id);

    -- Anonymous provider performance. Contains aggregate run outcomes only, never tenant lead payloads.
    CREATE TABLE IF NOT EXISTS discovery_source_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      source_code TEXT NOT NULL,
      country_code TEXT,
      industry_pack_id TEXT,
      status TEXT NOT NULL,
      fetched INTEGER DEFAULT 0,
      found INTEGER DEFAULT 0,
      qualified INTEGER DEFAULT 0,
      review INTEGER DEFAULT 0,
      rejected INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      error_code TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(run_id, source_code)
    );
    CREATE INDEX IF NOT EXISTS idx_source_runs_market ON discovery_source_runs(country_code, industry_pack_id, source_code);
  `);
    // Migration for databases created before identity_key and scan_run_candidates existed.
    const columns = db.prepare('PRAGMA table_info(candidates)').all();
    if (!columns.some(column => column.name === 'identity_key')) {
        db.exec('ALTER TABLE candidates ADD COLUMN identity_key TEXT');
    }
    const scanRunColumns = db.prepare('PRAGMA table_info(scan_runs)').all();
    if (!scanRunColumns.some(column => column.name === 'total_fetched')) {
        db.exec('ALTER TABLE scan_runs ADD COLUMN total_fetched INTEGER DEFAULT 0');
    }
    if (!scanRunColumns.some(column => column.name === 'total_rejected')) {
        db.exec('ALTER TABLE scan_runs ADD COLUMN total_rejected INTEGER DEFAULT 0');
    }
    if (!scanRunColumns.some(column => column.name === 'diagnostics')) {
        db.exec('ALTER TABLE scan_runs ADD COLUMN diagnostics TEXT');
    }
    if (!scanRunColumns.some(column => column.name === 'total_qualified')) {
        db.exec('ALTER TABLE scan_runs ADD COLUMN total_qualified INTEGER DEFAULT 0');
    }
    if (!scanRunColumns.some(column => column.name === 'total_review')) {
        db.exec('ALTER TABLE scan_runs ADD COLUMN total_review INTEGER DEFAULT 0');
    }
    if (!scanRunColumns.some(column => column.name === 'total_deferred')) {
        db.exec('ALTER TABLE scan_runs ADD COLUMN total_deferred INTEGER DEFAULT 0');
    }
    if (!columns.some(column => column.name === 'qualification_tier')) {
        db.exec('ALTER TABLE candidates ADD COLUMN qualification_tier TEXT');
    }
    if (!columns.some(column => column.name === 'qualification_reasons')) {
        db.exec('ALTER TABLE candidates ADD COLUMN qualification_reasons TEXT');
    }
    const enrichmentColumns = db.prepare('PRAGMA table_info(enrichments)').all();
    if (!enrichmentColumns.some(column => column.name === 'field_evidence')) {
        db.exec('ALTER TABLE enrichments ADD COLUMN field_evidence TEXT');
    }
    if (!enrichmentColumns.some(column => column.name === 'conflicts')) {
        db.exec('ALTER TABLE enrichments ADD COLUMN conflicts TEXT');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_candidates_identity_key ON candidates(identity_key)');
    const candidatesWithoutIdentity = db.prepare(`
    SELECT id, display_name, candidate_type, website, country
    FROM candidates WHERE identity_key IS NULL
  `).all();
    for (const candidate of candidatesWithoutIdentity) {
        const identityKey = buildCandidateIdentity({
            displayName: candidate.display_name,
            candidateType: candidate.candidate_type,
            website: candidate.website,
            country: candidate.country,
        });
        if (identityKey)
            db.prepare('UPDATE candidates SET identity_key = ? WHERE id = ?').run(identityKey, candidate.id);
    }
    db.exec(`
    INSERT OR IGNORE INTO scan_run_candidates (run_id, candidate_id, adapter_code)
    SELECT run_id, id, adapter_code FROM candidates
  `);
    db.exec(`
    INSERT OR IGNORE INTO candidate_sources (candidate_id, adapter_code, external_id, source_url, raw_data, discovered_at)
    SELECT id, adapter_code, external_id, source_url, raw_data, created_at FROM candidates
  `);
    console.log('[schema] Tables initialized: scan_runs, candidates, discovery resources, enrichments');
}
//# sourceMappingURL=schema.js.map