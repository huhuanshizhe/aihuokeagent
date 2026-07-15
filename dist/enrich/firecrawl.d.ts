/**
 * Firecrawl 结构化提取 - 精简版
 * 用于从企业官网提取结构化信息（联系方式、产品、能力等）
 */
export interface FirecrawlResult {
    description?: string;
    emails?: string[];
    phones?: string[];
    products?: string[];
    capabilities?: string[];
    socialLinks?: {
        linkedin?: string;
        twitter?: string;
        facebook?: string;
    };
}
/**
 * 使用 Firecrawl 抓取网页并用 AI 提取结构化信息
 */
export declare function scrapeWithFirecrawl(url: string): Promise<FirecrawlResult>;
