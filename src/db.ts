/**
 * Database entry — Neon PostgreSQL + Drizzle.
 * (Replaces former sql.js wrapper.)
 */
export {
  initDb,
  getDb,
  closeDb,
  db,
  schema,
  type AppDatabase,
} from './db/index.js';
