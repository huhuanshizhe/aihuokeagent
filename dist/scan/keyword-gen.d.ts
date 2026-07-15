/**
 * AI 关键词生成 - 精简版
 * 从 src/lib/radar/keyword-generator.ts 提取，去除 Prisma 依赖
 */
export interface GeneratedKeyword {
    keyword: string;
    rationale: string;
}
interface CompanyContext {
    companyName: string;
    companyIntro?: string;
    products?: string[];
    targetIndustries?: string[];
}
/**
 * 根据企业画像生成搜索关键词
 */
export declare function generateKeywords(context: CompanyContext, targetCountries: string[], options?: {
    mode: 'initial' | 'expansion';
    existingKeywords?: string[];
    maxKeywords?: number;
}): Promise<GeneratedKeyword[]>;
export {};
