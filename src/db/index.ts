/**
 * Neon PostgreSQL via Drizzle ORM
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import { config } from '../config.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>;

export async function initDb(): Promise<AppDatabase> {
  if (dbInstance) return dbInstance;

  const connectionString = config.databaseUrl;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Add your Neon connection string to .env');
  }

  // node-pg does not need channel_binding; strip if present to avoid handshake issues.
  const url = connectionString.replace(/([?&])channel_binding=require&?/, '$1').replace(/[?&]$/, '');

  pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 10,
  });

  // Smoke-check connection
  const client = await pool.connect();
  try {
    await client.query('select 1');
  } finally {
    client.release();
  }

  dbInstance = drizzle(pool, { schema });
  console.log('[db] Connected to Neon PostgreSQL (drizzle)');
  return dbInstance;
}

export function getDb(): AppDatabase {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return dbInstance;
}

/** Back-compat export used across modules */
export const db: AppDatabase = new Proxy({} as AppDatabase, {
  get(_target, prop, receiver) {
    if (!dbInstance) throw new Error('Database not initialized. Call initDb() first.');
    return Reflect.get(dbInstance, prop, receiver);
  },
});

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    dbInstance = null;
  }
}

export { schema };
