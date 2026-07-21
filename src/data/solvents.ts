// Read-path queries for solvents. Solvents have no join tables; their config lives in
// scalar columns and JSONB, so a row maps almost directly to the domain Solvent shape.

import { asc } from 'drizzle-orm';

import { db } from '../db/client.js';
import { solvents } from '../db/schema.js';
import type { Solvent } from '../domain/types.js';

type SolventRow = typeof solvents.$inferSelect;

function toDomain(row: SolventRow): Solvent {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    lore: row.lore,
    polarity: row.polarity,
    basePh: row.basePh,
    compatibleOutcomes: row.compatibleOutcomes,
    stabilityModifier: row.stabilityModifier,
    heatDefault: row.heatDefault,
    aestheticBase: row.aestheticBase,
    categoryAffinity: row.categoryAffinity,
    categoryResistance: row.categoryResistance,
    signatureTransformation: row.signatureTransformation ?? null,
    physicalForm: row.physicalForm,
  };
}

export async function listSolvents(): Promise<Solvent[]> {
  const rows = await db.select().from(solvents).orderBy(asc(solvents.name));
  return rows.map(toDomain);
}

export async function getSolventBySlug(slug: string): Promise<Solvent | null> {
  const rows = await listSolvents();
  return rows.find((s) => s.slug === slug) ?? null;
}
