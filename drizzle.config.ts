import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const url = (process.env.DATABASE_URL || '')
  .replace(/([?&])channel_binding=require&?/, '$1')
  .replace(/[?&]$/, '');

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url,
    ssl: { rejectUnauthorized: false },
  },
});
