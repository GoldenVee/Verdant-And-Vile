// Read-path queries for solvents. Solvents have no join tables; their config lives in
// scalar columns and JSONB, so a row maps almost directly to the domain Solvent shape.

import { asc } from 'drizzle-orm';

import { db } from '../db/client.js';
import { solventAromaNotes, solvents } from '../db/schema.js';
import type { AromaNoteRef, Solvent } from '../domain/types.js';

type SolventRow = typeof solvents.$inferSelect;

function toDomain(row: SolventRow, aromaNotes: AromaNoteRef[]): Solvent {
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
    tasteProfile: row.tasteProfile,
    aromaNotes,
    categoryAffinity: row.categoryAffinity,
    categoryResistance: row.categoryResistance,
    signatureTransformation: row.signatureTransformation ?? null,
    physicalForm: row.physicalForm,
  };
}

export async function listSolvents(): Promise<Solvent[]> {
  const [rows, aroma] = await Promise.all([
    db.select().from(solvents).orderBy(asc(solvents.name)),
    db.select().from(solventAromaNotes),
  ]);

  const aromaBy = new Map<string, AromaNoteRef[]>();
  for (const a of aroma) {
    const list = aromaBy.get(a.solventId) ?? [];
    list.push({ note: a.note, position: a.position });
    aromaBy.set(a.solventId, list);
  }

  return rows.map((row) => toDomain(row, aromaBy.get(row.id) ?? []));
}

export async function getSolventBySlug(slug: string): Promise<Solvent | null> {
  const rows = await listSolvents();
  return rows.find((s) => s.slug === slug) ?? null;
}
