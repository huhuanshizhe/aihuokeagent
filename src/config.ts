/**
 * 环境变量 & 配置管理
 * 所有 API Key 直接从 .env 读取，不依赖任何数据库
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载 .env
dotenv.config({ path: join(__dirname, '..', '.env') });

export interface AppConfig {
  port: number;
  service: {
    apiKey: string;
    corsOrigins: string[];
    /** Local test UI only: allow /api/health to return apiKey for prefill. Never enable in public production. */
    exposeApiKeyInUi: boolean;
  };
  ai: {
    apiKey: string;
    baseUrl: string;
    model: string;
    openRouterApiKey: string;
    openRouterModel: string;
  };
  googleMaps: { apiKey: string };
  exa: { apiKey: string };
  apollo: { apiKey: string };
  hunter: { apiKey: string };
  serpapi: { apiKey: string };
  brave: { apiKey: string };
  firecrawl: { apiKey: string };
}

function env(key: string, fallback = ''): string {
  return process.env[key]?.trim() || fallback;
}

export const config: AppConfig = {
  port: parseInt(env('PORT', '3100'), 10),
  service: {
    apiKey: env('SERVICE_API_KEY'),
    corsOrigins: env('CORS_ORIGINS').split(',').map(value => value.trim()).filter(Boolean),
    exposeApiKeyInUi: ['1', 'true', 'yes', 'on'].includes(env('EXPOSE_API_KEY_IN_UI').toLowerCase()),
  },
  ai: {
    // Prefer Alibaba Cloud Model Studio's official variable names while keeping
    // the legacy TEXT_* names compatible with existing local deployments.
    apiKey: env('DASHSCOPE_API_KEY', env('TEXT_API_KEY')),
    baseUrl: env(
      'DASHSCOPE_BASE_URL',
      env('TEXT_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'),
    ),
    model: env('DASHSCOPE_MODEL', env('TEXT_MODEL', 'qwen3.7-plus')),
    openRouterApiKey: env('OPENROUTER_API_KEY'),
    openRouterModel: env('OPENROUTER_MODEL', 'qwen/qwen-plus'),
  },
  googleMaps: { apiKey: env('GOOGLE_MAPS_API_KEY') },
  exa: { apiKey: env('EXA_API_KEY') },
  apollo: { apiKey: env('APOLLO_API_KEY') },
  hunter: { apiKey: env('HUNTER_API_KEY') },
  serpapi: { apiKey: env('SERPAPI_KEY') },
  brave: { apiKey: env('BRAVE_SEARCH_API_KEY') },
  firecrawl: { apiKey: env('FIRECRAWL_API_KEY') },
};

/** 检查哪些适配器有可用的 API Key */
export function getAdapterStatus(): Record<string, { enabled: boolean }> {
  const adapters: Record<string, string> = {
    google_places: config.googleMaps.apiKey,
    ai_search: config.serpapi.apiKey || config.brave.apiKey,
    brave_places: config.brave.apiKey,
    thailand_factory: 'public-official-source',
    apollo: config.apollo.apiKey,
    hunter: config.hunter.apiKey,
    exa: config.exa.apiKey,
    firecrawl: config.firecrawl.apiKey,
  };

  const result: Record<string, { enabled: boolean }> = {};
  for (const [name, key] of Object.entries(adapters)) {
    result[name] = { enabled: !!key };
  }
  return result;
}
