import { initDb, getDb } from '../dist/db.js';
import { initSchema } from '../dist/schema.js';

await initDb();
initSchema();

const db = getDb();
const requiredTables = ['candidate_sources', 'candidates', 'enrichments', 'scan_run_candidates', 'scan_runs'];
const tableRows = db.prepare(`
  SELECT name FROM sqlite_master
  WHERE type = 'table'
  ORDER BY name
`).all();
const tableNames = new Set(tableRows.map(row => row.name));
const candidateColumns = db.prepare('PRAGMA table_info(candidates)').all();
const scanRunColumns = db.prepare('PRAGMA table_info(scan_runs)').all();

const missingTables = requiredTables.filter(table => !tableNames.has(table));
const hasIdentityKey = candidateColumns.some(column => column.name === 'identity_key');
const requiredScanColumns = [
  'total_fetched', 'total_rejected', 'total_qualified', 'total_review', 'total_deferred', 'diagnostics',
];
const missingScanColumns = requiredScanColumns.filter(name => !scanRunColumns.some(column => column.name === name));

if (missingTables.length || !hasIdentityKey || missingScanColumns.length) {
  console.error(JSON.stringify({ ok: false, missingTables, hasIdentityKey, missingScanColumns }, null, 2));
  db.flush();
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, tables: requiredTables, hasIdentityKey, scanColumns: requiredScanColumns }, null, 2));
db.flush();
process.exit(0);
