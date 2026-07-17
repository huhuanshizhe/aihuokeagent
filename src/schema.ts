/**
 * Schema bootstrap.
 * Tables are defined in src/db/schema.ts and applied with: npm run db:push
 */

export async function initSchema(): Promise<void> {
  console.log('[schema] Using Neon PostgreSQL via Drizzle (run `npm run db:push` if tables are missing)');
}
