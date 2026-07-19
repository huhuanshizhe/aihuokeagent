/**
 * Persist / query public scan API call audit logs.
 */

import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, gte, ilike, lte, or, type SQL } from 'drizzle-orm';
import { db } from '../db.js';
import { publicScanCallLogs } from '../db/schema.js';

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

export interface RecordPublicScanCallInput {
  runId?: string | null;
  keyword: string;
  country: string;
  countryCode?: string | null;
  resultCount?: number;
  totalQualified?: number;
  totalReview?: number;
  durationMs?: number;
  success: boolean;
  errorMessage?: string | null;
  clientContext?: Record<string, unknown> | null;
}

export async function recordPublicScanCall(input: RecordPublicScanCallInput): Promise<void> {
  const ctx = input.clientContext && typeof input.clientContext === 'object'
    ? input.clientContext
    : {};

  await db.insert(publicScanCallLogs).values({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    runId: asString(input.runId),
    keyword: input.keyword,
    country: input.country,
    countryCode: asString(input.countryCode),
    resultCount: input.resultCount ?? 0,
    totalQualified: input.totalQualified ?? 0,
    totalReview: input.totalReview ?? 0,
    durationMs: input.durationMs ?? 0,
    success: input.success,
    errorMessage: asString(input.errorMessage),
    userId: asString(ctx.userId),
    userName: asString(ctx.userName),
    userEmail: asString(ctx.userEmail),
    userPhone: asString(ctx.userPhone),
    userCompany: asString(ctx.userCompany),
    licenseCode: asString(ctx.licenseCode),
    licenseExpiresAt: asString(ctx.licenseExpiresAt),
    monthlyLeadsRemaining: asInt(ctx.monthlyLeadsRemaining),
    clientApp: asString(ctx.clientApp),
    discoveryRunId: asString(ctx.discoveryRunId),
    triggerSource: asString(ctx.triggerSource),
    clientContextJson: Object.keys(ctx).length ? JSON.stringify(ctx) : null,
  });
}

/** Swallow errors so logging never breaks the scan response. */
export async function safeRecordPublicScanCall(input: RecordPublicScanCallInput): Promise<void> {
  try {
    await recordPublicScanCall(input);
  } catch (error) {
    console.error('[public-scan-logs] failed to record call:', error);
  }
}

export interface ListPublicScanLogsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  country?: string;
  user?: string;
  from?: string;
  to?: string;
}

const LIST_COLUMNS = {
  id: publicScanCallLogs.id,
  createdAt: publicScanCallLogs.createdAt,
  runId: publicScanCallLogs.runId,
  keyword: publicScanCallLogs.keyword,
  country: publicScanCallLogs.country,
  countryCode: publicScanCallLogs.countryCode,
  resultCount: publicScanCallLogs.resultCount,
  totalQualified: publicScanCallLogs.totalQualified,
  totalReview: publicScanCallLogs.totalReview,
  durationMs: publicScanCallLogs.durationMs,
  success: publicScanCallLogs.success,
  errorMessage: publicScanCallLogs.errorMessage,
  userId: publicScanCallLogs.userId,
  userName: publicScanCallLogs.userName,
  userEmail: publicScanCallLogs.userEmail,
  userCompany: publicScanCallLogs.userCompany,
  clientApp: publicScanCallLogs.clientApp,
  triggerSource: publicScanCallLogs.triggerSource,
} as const;

function buildFilters(query: ListPublicScanLogsQuery): SQL | undefined {
  const parts: SQL[] = [];

  const keyword = query.keyword?.trim();
  if (keyword) {
    parts.push(ilike(publicScanCallLogs.keyword, `%${keyword}%`));
  }

  const country = query.country?.trim();
  if (country) {
    parts.push(
      or(
        ilike(publicScanCallLogs.country, `%${country}%`),
        ilike(publicScanCallLogs.countryCode, `%${country}%`),
      )!,
    );
  }

  const user = query.user?.trim();
  if (user) {
    parts.push(
      or(
        ilike(publicScanCallLogs.userId, `%${user}%`),
        ilike(publicScanCallLogs.userName, `%${user}%`),
        ilike(publicScanCallLogs.userEmail, `%${user}%`),
      )!,
    );
  }

  const from = query.from?.trim();
  if (from) {
    parts.push(gte(publicScanCallLogs.createdAt, from));
  }

  const to = query.to?.trim();
  if (to) {
    parts.push(lte(publicScanCallLogs.createdAt, to));
  }

  if (!parts.length) return undefined;
  return parts.length === 1 ? parts[0] : and(...parts);
}

export async function listPublicScanLogs(query: ListPublicScanLogsQuery) {
  const page = Math.max(1, Math.trunc(query.page || 1));
  const pageSize = Math.min(50, Math.max(1, Math.trunc(query.pageSize || 20)));
  const offset = (page - 1) * pageSize;
  const where = buildFilters(query);

  const [totalRow] = await db
    .select({ total: count() })
    .from(publicScanCallLogs)
    .where(where);

  const items = await db
    .select(LIST_COLUMNS)
    .from(publicScanCallLogs)
    .where(where)
    .orderBy(desc(publicScanCallLogs.createdAt), desc(publicScanCallLogs.id))
    .limit(pageSize)
    .offset(offset);

  return {
    items,
    page,
    pageSize,
    total: Number(totalRow?.total || 0),
  };
}

export async function getPublicScanLogById(id: string) {
  const rows = await db
    .select()
    .from(publicScanCallLogs)
    .where(eq(publicScanCallLogs.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  let clientContext: Record<string, unknown> | null = null;
  if (row.clientContextJson) {
    try {
      clientContext = JSON.parse(row.clientContextJson) as Record<string, unknown>;
    } catch {
      clientContext = null;
    }
  }

  return {
    ...row,
    clientContext,
  };
}
