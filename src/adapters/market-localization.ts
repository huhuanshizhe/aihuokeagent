import { normalizeCountryCode } from '../lib/country-utils.js';
import { resourceRegistry } from '../resources/registry.js';
import type { GeoViewport } from '../resources/types.js';

export type Viewport = GeoViewport;

export interface MarketCluster {
  name: string;
  localName: string;
  viewport: Viewport;
}

export interface MarketProfile {
  code: string;
  countryName: string;
  languageCode: string;
  uiLanguage: string;
  viewport: Viewport;
  clusters: MarketCluster[];
}

export function getMarketProfile(country?: string): MarketProfile | undefined {
  const code = normalizeCountryCode(country) || resourceRegistry.findMarket(country)?.countryCode;
  const pack = code ? resourceRegistry.getMarket(code) : undefined;
  if (!pack || pack.status !== 'active') return undefined;
  const primaryLanguage = [...pack.languages].sort((a, b) => a.priority - b.priority)[0]?.code || 'en';
  return {
    code: pack.countryCode,
    countryName: pack.countryName,
    languageCode: primaryLanguage,
    uiLanguage: primaryLanguage === 'en' ? 'en-US' : `${primaryLanguage}-${pack.countryCode}`,
    viewport: pack.viewport,
    clusters: pack.clusters.map(cluster => ({ name: cluster.name, localName: cluster.localName, viewport: cluster.viewport })),
  };
}

export function localizeIndustrialKeyword(keyword: string, country?: string): string | undefined {
  const code = normalizeCountryCode(country) || resourceRegistry.findMarket(country)?.countryCode;
  const pack = code ? resourceRegistry.getMarket(code) : undefined;
  if (!pack) return undefined;
  for (const phrase of pack.localization.phrases) {
    try {
      if (new RegExp(phrase.pattern, 'i').test(keyword)) return phrase.value;
    } catch {
      // Invalid resource expressions are ignored; registry validation can surface them later.
    }
  }
  return undefined;
}

export function isSoutheastAsiaFocus(country?: string): boolean {
  const code = normalizeCountryCode(country) || resourceRegistry.findMarket(country)?.countryCode;
  return Boolean(code && resourceRegistry.getMarket(code)?.region === 'southeast_asia');
}
