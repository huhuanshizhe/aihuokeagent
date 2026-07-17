/**
 * Local scan latency breakdown.
 * Usage: npx tsx scripts/bench-scan.ts
 */
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, closeDb, db } from '../src/db/index.js';
import { sql } from 'drizzle-orm';
import { getAdapter, getDefaultDiscoveryAdapterCodes } from '../src/adapters/registry.js';
import { runScan } from '../src/scan/scanner.js';
import { getScanResults } from '../src/scan/scanner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const cachePath = join(root, 'data', 'cache', 'thailand-factories.csv');

function ms(start: number): number {
  return Math.round(performance.now() - start);
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<{ label: string; ms: number; ok: boolean; detail?: string; value?: T }> {
  const start = performance.now();
  try {
    const value = await fn();
    const elapsed = ms(start);
    console.log(`  ✓ ${label}: ${elapsed}ms`);
    return { label, ms: elapsed, ok: true, value };
  } catch (error) {
    const elapsed = ms(start);
    const detail = error instanceof Error ? error.message : String(error);
    console.log(`  ✗ ${label}: ${elapsed}ms — ${detail.slice(0, 200)}`);
    return { label, ms: elapsed, ok: false, detail };
  }
}

async function main() {
  console.log('\n=== aihuokeagent scan bench ===\n');
  console.log(`cache CSV exists: ${existsSync(cachePath)}`);
  console.log(`default adapters for TH: ${getDefaultDiscoveryAdapterCodes(['TH']).join(', ')}`);

  await initDb();

  console.log('\n[1] Neon RTT (5x SELECT 1)');
  const rtts: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await db.execute(sql`select 1`);
    rtts.push(ms(t0));
  }
  console.log(`  RTTs: ${rtts.join(', ')}ms | avg ${Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length)}ms`);

  const query = {
    keywords: ['wedding photography'],
    countries: ['TH'],
    maxResults: 20,
  };

  console.log('\n[2] Per-adapter search (no DB persist)');
  const adapters = getDefaultDiscoveryAdapterCodes(['TH']);
  const adapterResults: Array<{ code: string; ms: number; ok: boolean; items?: number; detail?: string }> = [];
  for (const code of adapters) {
    const result = await timed(`adapter ${code}`, async () => {
      const adapter = getAdapter(code);
      return adapter.search(query);
    });
    adapterResults.push({
      code,
      ms: result.ms,
      ok: result.ok,
      items: result.value?.items?.length,
      detail: result.detail || result.value?.metadata?.warnings?.[0],
    });
    if (result.ok && result.value) {
      console.log(`      items=${result.value.items.length} duration_meta=${result.value.metadata.duration}ms`);
      if (result.value.metadata.warnings?.length) {
        console.log(`      warnings: ${result.value.metadata.warnings.join('; ')}`);
      }
    }
  }

  console.log('\n[3] Full runScan WITHOUT thailand_factory');
  const withoutThai = await timed('runScan(no thai)', () => runScan({
    keywords: ['wedding photography'],
    countries: ['TH'],
    maxResults: 20,
    adapters: adapters.filter(code => code !== 'thailand_factory'),
  }));
  if (withoutThai.ok && withoutThai.value) {
    const r = withoutThai.value;
    const candidates = await getScanResults(r.runId);
    console.log(`      found=${r.totalFound} candidates=${candidates.length} adapterResults=${JSON.stringify(
      Object.fromEntries(Object.entries(r.adapterResults).map(([k, v]) => [k, { found: v.found, fetched: v.fetched, new: v.new }])),
    )}`);
    console.log(`      errors=${JSON.stringify(r.errors)}`);
  }

  console.log('\n[4] Full runScan WITH thailand_factory (may be slow / fail)');
  const withThai = await timed('runScan(with thai)', () => runScan({
    keywords: ['wedding photography'],
    countries: ['TH'],
    maxResults: 20,
    // adapters omitted → includes thailand_factory for TH
  }));
  if (withThai.ok && withThai.value) {
    const r = withThai.value;
    const candidates = await getScanResults(r.runId);
    console.log(`      found=${r.totalFound} candidates=${candidates.length}`);
    console.log(`      adapterResults=${JSON.stringify(
      Object.fromEntries(Object.entries(r.adapterResults).map(([k, v]) => [k, { found: v.found, fetched: v.fetched, new: v.new }])),
    )}`);
    console.log(`      errors=${JSON.stringify(r.errors)}`);
    console.log(`      warnings=${JSON.stringify(r.warnings)}`);
  }

  console.log('\n=== summary ===');
  console.log(JSON.stringify({
    neonAvgRttMs: Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length),
    adapters: adapterResults.map(a => ({ code: a.code, ms: a.ms, ok: a.ok, items: a.items, detail: a.detail?.slice(0, 120) })),
    fullWithoutThaiMs: withoutThai.ms,
    fullWithThaiMs: withThai.ms,
    withThaiOk: withThai.ok,
    withThaiError: withThai.detail?.slice(0, 200),
    cacheAfter: existsSync(cachePath),
  }, null, 2));

  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
