/**
 * 环境变量 & 配置管理
 * 所有 API Key 直接从 .env 读取，不依赖任何数据库
 */
export interface AppConfig {
    port: number;
    service: {
        apiKey: string;
        corsOrigins: string[];
    };
    ai: {
        apiKey: string;
        baseUrl: string;
        model: string;
        openRouterApiKey: string;
        openRouterModel: string;
    };
    googleMaps: {
        apiKey: string;
    };
    exa: {
        apiKey: string;
    };
    apollo: {
        apiKey: string;
    };
    hunter: {
        apiKey: string;
    };
    serpapi: {
        apiKey: string;
    };
    brave: {
        apiKey: string;
    };
    firecrawl: {
        apiKey: string;
    };
}
export declare const config: AppConfig;
/** 检查哪些适配器有可用的 API Key */
export declare function getAdapterStatus(): Record<string, {
    enabled: boolean;
}>;
