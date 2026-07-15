/**
 * 适配器接口 - 精简版
 * 从 src/lib/radar/adapters/types.ts 提取，去除 Prisma 依赖
 */

// ==================== 类型定义 ====================

export type ChannelType = 'TENDER' | 'MAPS' | 'DIRECTORY' | 'SEARCH' | 'CUSTOM';

export interface AdapterFeatures {
  supportsKeywordSearch: boolean;
  supportsRegionFilter: boolean;
  supportsPagination: boolean;
  supportsDetails: boolean;
  maxResultsPerQuery: number;
}

export interface SearchQuery {
  keywords?: string[];
  countries?: string[];
  industry?: string;
  page?: number;
  pageSize?: number;
  maxResults?: number;
  /** Maximum number of provider queries to execute for this run. */
  maxQueries?: number;
  // AI 搜索专用
  targetIndustries?: string[];
  companyTypes?: string[];
  excludeKeywords?: string[];
}

export interface SearchResult {
  items: NormalizedCandidate[];
  total: number;
  hasMore: boolean;
  metadata: {
    source: string;
    query: SearchQuery;
    fetchedAt: Date;
    duration: number;
    keywordStats?: Array<{ keyword: string; fetched: number }>;
    warnings?: string[];
    rawFetched?: number;
  };
}

export interface NormalizedCandidate {
  /** 数据库主键（从 DB 读取时存在） */
  id?: string;
  externalId: string;
  sourceUrl: string;
  displayName: string;
  candidateType: 'COMPANY' | 'OPPORTUNITY' | 'CONTACT';
  description?: string;
  website?: string;
  phone?: string;
  email?: string;
  address?: string;
  country?: string;
  city?: string;
  industry?: string;
  companySize?: string;
  // CRM 扩展字段
  businessType?: string;
  products?: string[];
  brands?: string[];
  employeesCount?: string;
  isTargetCustomer?: boolean;
  targetReason?: string;
  qualificationTier?: 'qualified' | 'review' | 'rejected';
  qualificationReasons?: string[];
  // 评分 & 元数据
  matchScore?: number;
  matchExplain?: {
    channel?: string;
    reasons?: string[];
    matchedKeywords?: string[];
  };
  rawData?: Record<string, unknown>;
}

export interface CandidateDetails {
  externalId: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  description?: string;
  additionalInfo?: Record<string, unknown>;
}

export interface HealthStatus {
  healthy: boolean;
  latency: number;
  error?: string;
  message?: string;
}

// ==================== 适配器接口 ====================

export interface Adapter {
  readonly code: string;
  readonly channelType: ChannelType;
  readonly features: AdapterFeatures;

  search(query: SearchQuery): Promise<SearchResult>;
  getDetails?(externalId: string): Promise<CandidateDetails | null>;
  healthCheck(): Promise<HealthStatus>;
}

export interface AdapterConfig {
  apiKey?: string;
  timeout?: number;
}
