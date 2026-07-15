/**
 * 适配器注册中心
 * 管理所有数据源适配器的创建和获取
 */

import type { Adapter, AdapterConfig } from './types.js';
import { config } from '../config.js';
import { GooglePlacesAdapter } from './google-places.js';
import { AISearchAdapter } from './ai-search.js';
import { ApolloAdapter } from './apollo.js';
import { HunterAdapter } from './hunter.js';
import { BravePlacesAdapter } from './brave-places.js';
import { ThailandFactoryAdapter } from './thailand-factory.js';
import { isSoutheastAsiaFocus } from './market-localization.js';

const adapterCache = new Map<string, Adapter>();

export function getAdapter(code: string): Adapter {
  const cached = adapterCache.get(code);
  if (cached) return cached;

  let adapter: Adapter;

  switch (code) {
    case 'google_places':
      adapter = new GooglePlacesAdapter({ apiKey: config.googleMaps.apiKey });
      break;
    case 'ai_search':
      adapter = new AISearchAdapter({});
      break;
    case 'brave_places':
      adapter = new BravePlacesAdapter({ apiKey: config.brave.apiKey });
      break;
    case 'thailand_factory':
      adapter = new ThailandFactoryAdapter();
      break;
    case 'apollo':
      adapter = new ApolloAdapter({ apiKey: config.apollo.apiKey });
      break;
    case 'hunter':
      adapter = new HunterAdapter({ apiKey: config.hunter.apiKey });
      break;
    default:
      throw new Error(`Unknown adapter: ${code}`);
  }

  adapterCache.set(code, adapter);
  return adapter;
}

/** 获取所有已注册的适配器代码 */
export function getAllAdapterCodes(): string[] {
  return ['google_places', 'ai_search', 'brave_places', 'thailand_factory', 'apollo', 'hunter'];
}

/** Discovery only uses keyword-capable providers. Prefer configured providers so optional keys are not reported as failures. */
export function getDefaultDiscoveryAdapterCodes(countries: string[] = []): string[] {
  const southeastAsiaFocus = countries.some(isSoutheastAsiaFocus);
  const thailandFocus = countries.some(country => country.toUpperCase() === 'TH' || country === '泰国' || country.toLowerCase() === 'thailand');
  const configured = [
    config.googleMaps.apiKey ? 'google_places' : undefined,
    (config.serpapi.apiKey || config.brave.apiKey) ? 'ai_search' : undefined,
    (config.brave.apiKey && southeastAsiaFocus) ? 'brave_places' : undefined,
    thailandFocus ? 'thailand_factory' : undefined,
    config.apollo.apiKey ? 'apollo' : undefined,
  ].filter((code): code is string => Boolean(code));

  return configured;
}

/** 健康检查所有适配器 */
export async function healthCheckAll(): Promise<Record<string, { healthy: boolean; error?: string }>> {
  const results: Record<string, { healthy: boolean; error?: string }> = {};

  for (const code of getAllAdapterCodes()) {
    try {
      const adapter = getAdapter(code);
      const status = await adapter.healthCheck();
      results[code] = { healthy: status.healthy, error: status.error };
    } catch (e) {
      results[code] = { healthy: false, error: e instanceof Error ? e.message : 'Unknown' };
    }
  }

  return results;
}
