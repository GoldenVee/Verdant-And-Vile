import { defineConfig } from 'drizzle-kit';

// `generate` (diffing schema to SQL) needs no live DB; `migrate`/`push` read
// DATABASE_URL. The empty-string fallback keeps generate working before Neon is wired.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
