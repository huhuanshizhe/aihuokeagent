import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
export class DiscoveryResourceRegistry {
    rootDir;
    markets = new Map();
    industries = new Map();
    sources = new Map();
    loadedAt = '';
    constructor(rootDir = resolveResourceRoot()) {
        this.rootDir = rootDir;
        this.reload();
    }
    reload() {
        const markets = loadJsonDirectory(join(this.rootDir, 'markets'));
        const industries = loadJsonDirectory(join(this.rootDir, 'industries'));
        const sources = loadJsonDirectory(join(this.rootDir, 'sources'));
        validateUnique(markets.map(item => item.countryCode), 'market countryCode');
        validateUnique(industries.map(item => item.id), 'industry id');
        validateUnique(sources.map(item => item.code), 'source code');
        validateResources(markets, industries, sources);
        this.markets = new Map(markets.map(item => [item.countryCode.toUpperCase(), item]));
        this.industries = new Map(industries.map(item => [item.id, item]));
        this.sources = new Map(sources.map(item => [item.code, item]));
        this.loadedAt = new Date().toISOString();
    }
    listMarkets() { return [...this.markets.values()]; }
    listIndustries() { return [...this.industries.values()]; }
    listSources() { return [...this.sources.values()]; }
    getMarket(code) { return this.markets.get(code.toUpperCase()); }
    getIndustry(id) { return this.industries.get(id); }
    getSource(code) { return this.sources.get(code); }
    getLoadedAt() { return this.loadedAt; }
    findMarket(value) {
        if (!value)
            return undefined;
        const normalized = value.trim().toLowerCase();
        return this.listMarkets().find(pack => pack.countryCode.toLowerCase() === normalized ||
            pack.countryName.toLowerCase() === normalized ||
            pack.aliases.some(alias => alias.toLowerCase() === normalized));
    }
    findIndustry(value, keywords = []) {
        const haystack = [value || '', ...keywords].join(' ').toLowerCase();
        if (!haystack.trim())
            return undefined;
        return this.listIndustries()
            .filter(pack => pack.status === 'active')
            .map(pack => ({ pack, score: [pack.id, pack.name, ...pack.aliases].filter(term => haystack.includes(term.toLowerCase())).length }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)[0]?.pack;
    }
}
function resolveResourceRoot() {
    const configured = process.env.DISCOVERY_RESOURCES_DIR?.trim();
    if (configured)
        return configured;
    const cwdRoot = join(process.cwd(), 'resources');
    if (existsSync(cwdRoot))
        return cwdRoot;
    return join(__dirname, '..', '..', 'resources');
}
function loadJsonDirectory(directory) {
    if (!existsSync(directory))
        return [];
    return readdirSync(directory)
        .filter(file => file.endsWith('.json'))
        .sort()
        .map(file => JSON.parse(readFileSync(join(directory, file), 'utf8')));
}
function validateUnique(values, label) {
    const seen = new Set();
    for (const value of values) {
        if (!value)
            throw new Error(`Discovery resource has an empty ${label}`);
        if (seen.has(value))
            throw new Error(`Duplicate discovery resource ${label}: ${value}`);
        seen.add(value);
    }
}
function validateResources(markets, industries, sources) {
    const sourceCodes = new Set(sources.map(source => source.code));
    for (const market of markets) {
        if (!market.id || !market.version || !market.countryName || !market.viewport)
            throw new Error(`Incomplete Market Pack: ${market.countryCode}`);
        for (const phrase of market.localization?.phrases || []) {
            try {
                new RegExp(phrase.pattern, 'i');
            }
            catch {
                throw new Error(`Invalid localization pattern in ${market.id}: ${phrase.pattern}`);
            }
        }
        for (const sourceCode of market.sourceCodes || []) {
            if (!sourceCodes.has(sourceCode))
                throw new Error(`Market Pack ${market.id} references unknown source ${sourceCode}`);
        }
    }
    for (const industry of industries) {
        if (!industry.version || !industry.name || !industry.entityType)
            throw new Error(`Incomplete Industry Pack: ${industry.id}`);
    }
    for (const source of sources) {
        if (!source.version || !source.name || !source.sourceType || !source.refreshPolicy || !source.cachePolicy) {
            throw new Error(`Incomplete Source Catalog entry: ${source.code}`);
        }
    }
}
export const resourceRegistry = new DiscoveryResourceRegistry();
//# sourceMappingURL=registry.js.map