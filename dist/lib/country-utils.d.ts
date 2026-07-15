/**
 * 国家代码工具 - 精简版
 * 从 src/lib/radar/country-utils.ts 提取
 */
export declare const COUNTRY_NAME_BY_ISO: Record<string, string>;
export declare function normalizeCountryCode(value?: string | null): string | null;
export declare function getCountryDisplayName(value?: string | null): string | null;
