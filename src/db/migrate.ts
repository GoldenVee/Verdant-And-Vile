// Applies pending Drizzle migrations from the drizzle/ folder to the DB pointed to
// by DATABASE_URL. Run via `pnpm db:migrate` (which loads .env).

import { migrate } from 'drizzle-orm/neon-http/migrator';

import { db } from './client.js';

async function main(): Promise<void> {
  console.log('Applying migrations...');
  await migrate(db, { migrationsFolder: 'drizzle' });
  console.log('Migrations applied.');
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
