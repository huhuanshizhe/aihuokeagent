import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Adapter, HealthStatus, NormalizedCandidate, SearchQuery, SearchResult } from './types.js';
import { normalizeCountryCode } from '../lib/country-utils.js';

export const THAI_FACTORY_SOURCE_URL =
  'https://openapi.industry.go.th/gdcatalog/Factory_Data_CSV.php?download_all=1';
export const THAI_FACTORY_CACHE_REL = 'data/cache/thailand-factories.csv';
const DIRECTORY_URL = 'https://www.diw.go.th/webdiw/search-factory/';
const LOCAL_DOWNLOAD_TIMEOUT_MS = Number(process.env.THAI_FACTORY_DOWNLOAD_TIMEOUT_MS || 300_000);
const INDUSTRIAL_PROVINCES = new Set(['ชลบุรี', 'ระยอง', 'สมุทรปราการ', 'ฉะเชิงเทรา', 'พระนครศรีอยุธยา', 'ปทุมธานี']);

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve cache path across local (src/dist), Docker (/app), and Vercel (/var/task). */
export function getThaiFactoryCachePath(): string {
  const fromEnv = process.env.THAI_FACTORY_CACHE_PATH?.trim();
  if (fromEnv) return fromEnv;

  const candidates = [
    join(process.cwd(), THAI_FACTORY_CACHE_REL),
    process.env.LAMBDA_TASK_ROOT
      ? join(process.env.LAMBDA_TASK_ROOT, THAI_FACTORY_CACHE_REL)
      : '',
    // src/adapters → repo root; dist/adapters → repo root
    join(__dirname, '..', '..', THAI_FACTORY_CACHE_REL),
    // bundled single-file edge cases: keep looking upward for data/cache
    join(__dirname, '..', THAI_FACTORY_CACHE_REL),
    join(__dirname, THAI_FACTORY_CACHE_REL),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // Prefer cwd for local download writes / status when file is not yet present
  return candidates[0]!;
}

export interface ThaiFactoryCacheInfo {
  path: string;
  relativePath: string;
  exists: boolean;
  sizeBytes?: number;
  updatedAt?: string;
  recordCount?: number;
  gitHint: string;
}

export function getThaiFactoryCacheInfo(): ThaiFactoryCacheInfo {
  const path = getThaiFactoryCachePath();
  const info: ThaiFactoryCacheInfo = {
    path,
    relativePath: THAI_FACTORY_CACHE_REL,
    exists: existsSync(path),
    gitHint: `下载后提交：git add ${THAI_FACTORY_CACHE_REL}`,
  };
  if (!info.exists) return info;
  const stat = statSync(path);
  info.sizeBytes = stat.size;
  info.updatedAt = stat.mtime.toISOString();
  try {
    info.recordCount = parseThaiFactoryCsv(readFileSync(path, 'utf8')).length;
  } catch {
    // ignore parse errors on status
  }
  return info;
}

export function invalidateThaiFactoryCache(): void {
  recordCache = undefined;
}

export interface ThaiFactoryDownloadResult {
  path: string;
  relativePath: string;
  sizeBytes: number;
  recordCount: number;
  durationMs: number;
  sourceUrl: string;
}

/** Local dev: download full DIW CSV into data/cache for Git commit. */
export async function downloadThaiFactoryCache(): Promise<ThaiFactoryDownloadResult> {
  const started = Date.now();
  const cachePath = getThaiFactoryCachePath();
  const url = process.env.THAI_FACTORY_DATA_URL?.trim() || THAI_FACTORY_SOURCE_URL;

  const response = await fetch(url, { signal: AbortSignal.timeout(LOCAL_DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Thailand DIW factory download failed: HTTP ${response.status}`);
  const csv = await response.text();
  if (!csv.includes('FACREG') || !csv.includes('FPROVNAME')) {
    throw new Error('Thailand DIW factory download returned an unexpected format');
  }

  const records = parseThaiFactoryCsv(csv);
  if (records.length === 0) throw new Error('Thailand DIW factory dataset did not contain readable records');

  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, csv, 'utf8');
  invalidateThaiFactoryCache();
  recordCache = records;

  return {
    path: cachePath,
    relativePath: THAI_FACTORY_CACHE_REL,
    sizeBytes: Buffer.byteLength(csv, 'utf8'),
    recordCount: records.length,
    durationMs: Date.now() - started,
    sourceUrl: url,
  };
}

export interface ThaiFactoryRecord {
  registrationId: string;
  factoryName: string;
  operatorName: string;
  activity: string;
  address: string;
  district: string;
  province: string;
  postalCode: string;
  isicCode: string;
  totalWorkers?: number;
  latitude?: number;
  longitude?: number;
  estate?: string;
  updatedAt?: string;
}

export interface RankedThaiFactory {
  record: ThaiFactoryRecord;
  score: number;
  matchedKeywords: string[];
  matchedTerms: string[];
}

let recordCache: ThaiFactoryRecord[] | undefined;
let cachePromise: Promise<ThaiFactoryRecord[]> | undefined;

export class ThailandFactoryAdapter implements Adapter {
  readonly code = 'thailand_factory';
  readonly channelType = 'DIRECTORY' as const;
  readonly features = {
    supportsKeywordSearch: true,
    supportsRegionFilter: true,
    supportsPagination: false,
    supportsDetails: false,
    maxResultsPerQuery: 100,
  };

  async search(query: SearchQuery): Promise<SearchResult> {
    const startedAt = Date.now();
    const targetCodes = (query.countries || []).map(normalizeCountryCode).filter(Boolean);
    if (targetCodes.length > 0 && !targetCodes.includes('TH')) {
      return emptyResult(this.code, query, startedAt, 'Thailand factory registry only applies to TH');
    }

    const records = await loadFactoryRecords();
    const keywords = query.keywords?.length ? query.keywords : [query.industry || 'industrial'];
    const maxResults = Math.min(query.maxResults || 20, this.features.maxResultsPerQuery);
    const allRanked = rankThaiFactories(records, keywords);
    const ranked = allRanked.slice(0, maxResults);
    const items = ranked.map(({ record, matchedKeywords, matchedTerms, score }): NormalizedCandidate => ({
      externalId: cleanValue(record.registrationId),
      sourceUrl: DIRECTORY_URL,
      displayName: chooseDisplayName(record),
      candidateType: 'COMPANY',
      description: record.activity || undefined,
      address: [record.address, record.district, record.province, record.postalCode].filter(Boolean).join(', '),
      country: 'Thailand',
      city: record.province || record.district || undefined,
      industry: record.isicCode ? `ISIC ${record.isicCode}` : 'Manufacturing',
      employeesCount: record.totalWorkers ? String(record.totalWorkers) : undefined,
      products: record.activity ? [record.activity] : undefined,
      matchExplain: {
        channel: this.code,
        reasons: ['Official Thailand Department of Industrial Works factory record', `Registry relevance ${score.toFixed(2)}`],
        matchedKeywords,
      },
      rawData: {
        source: this.code,
        searchKeyword: matchedKeywords[0],
        sourceMatchedKeywords: matchedKeywords,
        sourceMatchedTerms: matchedTerms,
        registrationId: record.registrationId,
        operatorName: record.operatorName,
        factoryName: record.factoryName,
        isicCode: record.isicCode,
        totalWorkers: record.totalWorkers,
        lat: record.latitude,
        lng: record.longitude,
        estate: record.estate,
        updatedAt: record.updatedAt,
      },
    }));

    const keywordStats = keywords.map(keyword => ({
      keyword,
      fetched: ranked.filter(item => item.matchedKeywords.includes(keyword)).length,
    }));

    return {
      items,
      total: items.length,
      hasMore: allRanked.length > items.length,
      metadata: {
        source: this.code,
        query,
        fetchedAt: new Date(),
        duration: Date.now() - startedAt,
        rawFetched: items.length,
        keywordStats,
        warnings: [`DIW registry loaded ${records.length.toLocaleString('en-US')} factory records; returned the top ${items.length}`],
      },
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    const info = getThaiFactoryCacheInfo();
    return {
      healthy: info.exists,
      latency: 0,
      message: info.exists
        ? `DIW factory cache: ${info.recordCount?.toLocaleString('en-US') ?? '?'} records`
        : `DIW cache missing — download ${THAI_FACTORY_CACHE_REL} from scan page`,
    };
  }
}

async function loadFactoryRecords(): Promise<ThaiFactoryRecord[]> {
  if (recordCache) return recordCache;
  if (cachePromise) return cachePromise;
  cachePromise = (async () => {
    const cachePath = getThaiFactoryCachePath();
    if (!existsSync(cachePath)) {
      throw new Error(
        `DIW factory cache missing (${THAI_FACTORY_CACHE_REL}). Download from scan page, then commit to Git.`,
      );
    }
    const csv = await readFile(cachePath, 'utf8');
    recordCache = parseThaiFactoryCsv(csv);
    if (recordCache.length === 0) throw new Error('Thailand DIW factory dataset did not contain readable records');
    return recordCache;
  })();
  try { return await cachePromise; } finally { cachePromise = undefined; }
}

export function parseThaiFactoryCsv(csv: string): ThaiFactoryRecord[] {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(stripHtml(lines[0])).map(value => cleanValue(value).toUpperCase());
  const index = Object.fromEntries(headers.map((header, i) => [header, i]));
  if (index.FACREG === undefined || index.FPROVNAME === undefined) return [];

  const value = (row: string[], field: string): string => cleanValue(row[index[field]] || '');
  const records: ThaiFactoryRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(stripHtml(lines[i]));
    const registrationId = value(row, 'FACREG');
    const factoryName = value(row, 'FNAME');
    const operatorName = value(row, 'ONAME');
    if (!registrationId || (!factoryName && !operatorName)) continue;
    records.push({
      registrationId,
      factoryName,
      operatorName,
      activity: value(row, 'OBJECT'),
      address: [value(row, 'FADDR'), value(row, 'FMOO'), value(row, 'FSOI'), value(row, 'FROAD')].filter(Boolean).join(' '),
      district: [value(row, 'FTUMNAME'), value(row, 'FAMPNAME')].filter(Boolean).join(', '),
      province: value(row, 'FPROVNAME'),
      postalCode: value(row, 'FZIPCODE'),
      isicCode: value(row, 'ISIC_CODE'),
      totalWorkers: numberValue(value(row, 'TOTAL_WORKER')),
      latitude: numberValue(value(row, 'LAT')),
      longitude: numberValue(value(row, 'LNG')),
      estate: value(row, 'ESTATE_NAME_TH') || value(row, 'INDUSTRIAL_ZONE_NAME'),
      updatedAt: value(row, 'LAST_UPDATE'),
    });
  }
  return records;
}

export function rankThaiFactories(records: ThaiFactoryRecord[], keywords: string[]): RankedThaiFactory[] {
  const groups = keywords.map(keyword => ({ keyword, terms: expandKeyword(keyword) })).filter(group => group.terms.length > 0);
  const ranked: RankedThaiFactory[] = [];
  for (const record of records) {
    const searchable = normalize(`${record.factoryName} ${record.operatorName} ${record.activity} ${record.isicCode} ${record.province} ${record.estate || ''}`);
    const matches = groups.map(group => ({
      keyword: group.keyword,
      terms: group.terms.filter(term => searchable.includes(normalize(term))),
    })).filter(group => group.terms.length > 0);
    if (matches.length === 0) continue;
    const matchedTerms = [...new Set(matches.flatMap(match => match.terms))];
    let score = matchedTerms.length;
    if (matches.some(match => match.terms.length >= 2)) score += 2;
    if (INDUSTRIAL_PROVINCES.has(record.province)) score += 0.6;
    if ((record.totalWorkers || 0) >= 50) score += 0.3;
    if (record.latitude && record.longitude) score += 0.1;
    ranked.push({ record, score, matchedKeywords: matches.map(match => match.keyword), matchedTerms });
  }
  return ranked.sort((a, b) => b.score - a.score || (b.record.totalWorkers || 0) - (a.record.totalWorkers || 0));
}

function expandKeyword(keyword: string): string[] {
  const generic = new Set(['company', 'companies', 'manufacturer', 'manufacturers', 'factory', 'supplier', 'system', 'industrial', 'in', 'thailand']);
  const translations: Record<string, string[]> = {
    automotive: ['รถยนต์', 'ยานยนต์'], auto: ['รถยนต์'], car: ['รถยนต์'], vehicle: ['ยานยนต์'],
    paint: ['พ่นสี', 'เคลือบสี'], painting: ['พ่นสี', 'เคลือบสี'], coating: ['เคลือบ', 'ชุบ'], booth: ['ห้องพ่นสี'],
    robot: ['หุ่นยนต์'], robotic: ['หุ่นยนต์'], automation: ['อัตโนมัติ'],
    part: ['ชิ้นส่วน', 'อะไหล่'], parts: ['ชิ้นส่วน', 'อะไหล่'], component: ['ชิ้นส่วน'], components: ['ชิ้นส่วน'],
    metal: ['โลหะ'], plastic: ['พลาสติก'], electronics: ['อิเล็กทรอนิกส์'], electronic: ['อิเล็กทรอนิกส์'],
    assembly: ['ประกอบ'], machinery: ['เครื่องจักร'], machine: ['เครื่องจักร'], welding: ['เชื่อม'],
  };
  const tokens = normalize(keyword).split(/[^a-z0-9\p{L}]+/u).filter(token => token.length > 2 && !generic.has(token));
  const terms = tokens.flatMap(token => [token, ...(translations[token] || [])]);
  return [...new Set(terms)];
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(value); value = '';
    } else value += char;
  }
  values.push(value);
  return values;
}

function chooseDisplayName(record: ThaiFactoryRecord): string {
  const looksLegal = (name: string) => /บริษัท|ห้างหุ้นส่วน|\b(?:co\.?|company|ltd\.?|plc\.?)\b/i.test(name);
  if (looksLegal(record.operatorName)) return record.operatorName;
  if (looksLegal(record.factoryName)) return record.factoryName;
  return record.factoryName || record.operatorName;
}

function normalize(value: string): string { return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim(); }
function cleanValue(value: string): string { return value.trim().replace(/^="?/, '').replace(/"$/, '').replace(/^[- ]+$/, ''); }
function stripHtml(value: string): string { return value.replace(/^\s*<[^>]+>/, '').replace(/<[^>]+>\s*$/, '').trim(); }
function numberValue(value: string): number | undefined { const parsed = Number(value); return Number.isFinite(parsed) && value !== '' ? parsed : undefined; }

function emptyResult(source: string, query: SearchQuery, startedAt: number, warning: string): SearchResult {
  return { items: [], total: 0, hasMore: false, metadata: { source, query, fetchedAt: new Date(), duration: Date.now() - startedAt, rawFetched: 0, warnings: [warning], keywordStats: [] } };
}
