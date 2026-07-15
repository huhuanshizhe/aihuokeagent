export interface WebsiteCrawlResult {
    website: string;
    identityMatched: boolean;
    identityConfidence: number;
    emails: string[];
    phones: string[];
    linkedInUrl?: string;
    description?: string;
    pagesVisited: string[];
}
export declare function crawlCompanyWebsite(input: string, companyName: string): Promise<WebsiteCrawlResult>;
export declare function normalizeWebsiteUrl(input: string): string | undefined;
export declare function extractContactEvidence(html: string, baseUrl: string): Pick<WebsiteCrawlResult, 'emails' | 'phones' | 'linkedInUrl'>;
