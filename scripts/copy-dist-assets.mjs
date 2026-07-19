/**
 * Copy runtime assets into dist so self-host can ship only `dist/` (+ node_modules).
 * - UI → dist/ui
 * - docs (OpenAPI YAML) → dist/docs
 * - DIW CSV → dist/data/cache/thailand-factories.csv
 */
import { cpSync, existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

function copyDir(src, dest) {
  if (!existsSync(src)) {
    console.warn(`[copy-dist-assets] skip missing: ${src}`);
    return false;
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[copy-dist-assets] ${src} → ${dest}`);
  return true;
}

function copyFile(src, dest) {
  if (!existsSync(src)) {
    console.warn(`[copy-dist-assets] skip missing: ${src}`);
    return false;
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  const mb = (statSync(dest).size / (1024 * 1024)).toFixed(1);
  console.log(`[copy-dist-assets] ${src} → ${dest} (${mb} MB)`);
  return true;
}

if (!existsSync(dist)) {
  console.error('[copy-dist-assets] dist/ missing — run tsc first');
  process.exit(1);
}

copyDir(join(root, 'src', 'ui'), join(dist, 'ui'));
copyDir(join(root, 'resources'), join(dist, 'resources'));
copyDir(join(root, 'docs'), join(dist, 'docs'));
const csvOk = copyFile(
  join(root, 'data', 'cache', 'thailand-factories.csv'),
  join(dist, 'data', 'cache', 'thailand-factories.csv'),
);

if (!csvOk) {
  console.warn(
    '[copy-dist-assets] thailand-factories.csv not copied. Download via scan page (or place under data/cache/) then rebuild.',
  );
}
