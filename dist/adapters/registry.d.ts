/**
 * 适配器注册中心
 * 管理所有数据源适配器的创建和获取
 */
import type { Adapter } from './types.js';
export declare function getAdapter(code: string): Adapter;
/** 获取所有已注册的适配器代码 */
export declare function getAllAdapterCodes(): string[];
/** Discovery only uses keyword-capable providers. Prefer configured providers so optional keys are not reported as failures. */
export declare function getDefaultDiscoveryAdapterCodes(countries?: string[]): string[];
/** 健康检查所有适配器 */
export declare function healthCheckAll(): Promise<Record<string, {
    healthy: boolean;
    error?: string;
}>>;
