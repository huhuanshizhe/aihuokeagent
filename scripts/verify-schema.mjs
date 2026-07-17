/**
 * Verify Neon schema via Drizzle after `npm run db:push`.
 */
import { sql } from 'drizzle-orm';
import { initDb, getDb, closeDb } from '../dist/db.js';
import { initSchema } from '../dist/schema.js';

await initDb();
await initSchema();

const db = getDb();
const requiredTables = [
  'candidate_sources',
  'candidates',
  'discovery_source_runs',
  'enrichments',
  'scan_run_candidates',
  'scan_runs',
];

const tableRows = await db.execute(sql`
  SELECT table_name AS name
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name
`);

const tableNames = new Set(
  (tableRows.rows || tableRows).map((row) => String(row.name || row.table_name)),
);

const candidateColumns = await db.execute(sql`
  SELECT column_name AS name
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'candidates'
`);
const scanRunColumns = await db.execute(sql`
  SELECT column_name AS name
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'scan_runs'
`);

const candidateColNames = (candidateColumns.rows || candidateColumns).map((c) => String(c.name || c.column_name));
const scanColNames = (scanRunColumns.rows || scanRunColumns).map((c) => String(c.name || c.column_name));

const missingTables = requiredTables.filter((table) => !tableNames.has(table));
const hasIdentityKey = candidateColNames.includes('identity_key');
const requiredScanColumns = [
  'total_fetched',
  'total_rejected',
  'total_qualified',
  'total_review',
  'total_deferred',
  'diagnostics',
];
const missingScanColumns = requiredScanColumns.filter((name) => !scanColNames.includes(name));

if (missingTables.length || !hasIdentityKey || missingScanColumns.length) {
  console.error(JSON.stringify({ ok: false, missingTables, hasIdentityKey, missingScanColumns }, null, 2));
  await closeDb();
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  tables: requiredTables,
  hasIdentityKey,
  scanColumns: requiredScanColumns,
}, null, 2));
await closeDb();
process.exit(0);
