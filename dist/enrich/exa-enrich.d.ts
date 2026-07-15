/**
 * Exa 企业补全 - 精简版
 * 从 src/lib/radar/exa-enrich.ts 提取
 */
export interface ExaEnrichResult {
    website?: string;
    email?: string;
    linkedInUrl?: string;
    description?: string;
    businessType?: string;
    products?: string[];
    brands?: string[];
    employeesCount?: string;
}
export declare function enrichWithExa(companyName: string, country?: string | null, industry?: string | null): Promise<ExaEnrichResult>;
