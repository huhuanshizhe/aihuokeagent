import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IndustryPack, MarketPack, SourceCatalogEntry } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class DiscoveryResourceRegistry {
  private markets = new Map<string, MarketPack>();
  private industries = new Map<string, IndustryPack>();
  private sources = new Map<string, SourceCatalogEntry>();
  private loadedAt = '';

  constructor(private rootDir = resolveResourceRoot()) { this.reload(); }

  reload(): void {
    const markets = loadJsonDirectory<MarketPack>(join(this.rootDir, 'markets'));
    const industries = loadJsonDirectory<IndustryPack>(join(this.rootDir, 'industries'));
    const sources = loadJsonDirectory<SourceCatalogEntry>(join(this.rootDir, 'sources'));
    validateUnique(markets.map(item => item.countryCode), 'market countryCode');
    validateUnique(industries.map(item => item.id), 'industry id');
    validateUnique(sources.map(item => item.code), 'source code');
    validateResources(markets, industries, sources);
    this.markets = new Map(markets.map(item => [item.countryCode.toUpperCase(), item]));
    this.industries = new Map(industries.map(item => [item.id, item]));
    this.sources = new Map(sources.map(item => [item.code, item]));
    this.loadedAt = new Date().toISOString();
  }

  listMarkets(): MarketPack[] { return [...this.markets.values()]; }
  listIndustries(): IndustryPack[] { return [...this.industries.values()]; }
  listSources(): SourceCatalogEntry[] { return [...this.sources.values()]; }
  getMarket(code: string): MarketPack | undefined { return this.markets.get(code.toUpperCase()); }
  getIndustry(id: string): IndustryPack | undefined { return this.industries.get(id); }
  getSource(code: string): SourceCatalogEntry | undefined { return this.sources.get(code); }
  getLoadedAt(): string { return this.loadedAt; }

  findMarket(value?: string): MarketPack | undefined {
    if (!value) return undefined;
    const normalized = value.trim().toLowerCase();
    return this.listMarkets().find(pack =>
      pack.countryCode.toLowerCase() === normalized ||
      pack.countryName.toLowerCase() === normalized ||
      pack.aliases.some(alias => alias.toLowerCase() === normalized)
    );
  }

  findIndustry(value?: string, keywords: string[] = []): IndustryPack | undefined {
    const haystack = [value || '', ...keywords].join(' ').toLowerCase();
    if (!haystack.trim()) return undefined;
    return this.listIndustries()
      .filter(pack => pack.status === 'active')
      .map(pack => ({ pack, score: [pack.id, pack.name, ...pack.aliases].filter(term => haystack.includes(term.toLowerCase())).length }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.pack;
  }
}

function resolveResourceRoot(): string {
  const configured = process.env.DISCOVERY_RESOURCES_DIR?.trim();
  if (configured) return configured;
  const cwdRoot = join(process.cwd(), 'resources');
  if (existsSync(cwdRoot)) return cwdRoot;
  return join(__dirname, '..', '..', 'resources');
}

function loadJsonDirectory<T>(directory: string): T[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter(file => file.endsWith('.json'))
    .sort()
    .map(file => JSON.parse(readFileSync(join(directory, file), 'utf8')) as T);
}

function validateUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) throw new Error(`Discovery resource has an empty ${label}`);
    if (seen.has(value)) throw new Error(`Duplicate discovery resource ${label}: ${value}`);
    seen.add(value);
  }
}

function validateResources(markets: MarketPack[], industries: IndustryPack[], sources: SourceCatalogEntry[]): void {
  const sourceCodes = new Set(sources.map(source => source.code));
  for (const market of markets) {
    if (!market.id || !market.version || !market.countryName || !market.viewport) throw new Error(`Incomplete Market Pack: ${market.countryCode}`);
    for (const phrase of market.localization?.phrases || []) {
      try { new RegExp(phrase.pattern, 'i'); } catch { throw new Error(`Invalid localization pattern in ${market.id}: ${phrase.pattern}`); }
    }
    for (const sourceCode of market.sourceCodes || []) {
      if (!sourceCodes.has(sourceCode)) throw new Error(`Market Pack ${market.id} references unknown source ${sourceCode}`);
    }
  }
  for (const industry of industries) {
    if (!industry.version || !industry.name || !industry.entityType) throw new Error(`Incomplete Industry Pack: ${industry.id}`);
  }
  for (const source of sources) {
    if (!source.version || !source.name || !source.sourceType || !source.refreshPolicy || !source.cachePolicy) {
      throw new Error(`Incomplete Source Catalog entry: ${source.code}`);
    }
  }
}

export const resourceRegistry = new DiscoveryResourceRegistry();
