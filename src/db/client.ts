// Neon serverless client wired to Drizzle. The HTTP driver suits a stateless,
// scale-to-zero deployment: each query is a one-shot request, no long-lived pool.

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

import { loadConfig } from '../config.js';
import * as schema from './schema.js';

const { databaseUrl } = loadConfig();

const sql = neon(databaseUrl);
export const db = drizzle(sql, { schema });

export type Db = typeof db;
