// Read-path queries for ingredients. Assembles the normalized rows (core + compound,
// aroma, and tag join tables) back into the domain Ingredient shape.

import { asc } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  ingredientAromaNotes,
  ingredientCompounds,
  ingredientTags,
  ingredients,
} from '../db/schema.js';
import type { IngredientType } from '../domain/enums.js';
import type { AromaNoteRef, CompoundRef, Ingredient } from '../domain/types.js';

type CoreRow = typeof ingredients.$inferSelect;

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = map.get(k);
    if (bucket) bucket.push(row);
    else map.set(k, [row]);
  }
  return map;
}

function assemble(
  core: CoreRow,
  compounds: CompoundRef[],
  aroma: AromaNoteRef[],
  synergyTags: string[],
  antagonistTags: string[],
): Ingredient {
  return {
    id: core.id,
    slug: core.slug,
    name: core.name,
    lore: core.lore,
    origin: core.origin,
    scientificName: core.scientificName,
    appearanceText: core.appearanceText,
    appearanceImg: core.appearanceImg,
    type: core.type as IngredientType,
    category: core.category,
    traits: core.traits,
    relatedFamily: core.relatedFamily,
    compoundClasses: compounds,
    solubility: core.solubility,
    phContribution: core.phContribution,
    toxicityBase: core.toxicityBase,
    stabilityBase: core.stabilityBase,
    extractionYield: core.extractionYield,
    potencyBase: core.potencyBase,
    doseResponse: core.doseResponse,
    hormeticThreshold: core.hormeticThreshold,
    activationThreshold: core.activationThreshold,
    ceilingValue: core.ceilingValue,
    heatResponse: core.heatResponse,
    synergyTags,
    antagonistTags,
    colorBase: core.colorBase,
    colorSecondary: core.colorSecondary,
    aromaNotes: aroma,
    tasteProfile: core.tasteProfile,
    texture: core.texture,
    sound: core.sound,
    temperatureFeel: core.temperatureFeel,
    luminosity: core.luminosity,
    motionTendency: core.motionTendency,
    aestheticWeight: core.aestheticWeight,
  };
}

// Loads every ingredient with its relations. Four queries, grouped in memory, rather
// than N+1 per ingredient.
export async function listIngredients(): Promise<Ingredient[]> {
  const [core, compounds, aroma, tags] = await Promise.all([
    db.select().from(ingredients).orderBy(asc(ingredients.name)),
    db.select().from(ingredientCompounds),
    db.select().from(ingredientAromaNotes),
    db.select().from(ingredientTags),
  ]);

  const compoundsBy = groupBy(compounds, (r) => r.ingredientId);
  const aromaBy = groupBy(aroma, (r) => r.ingredientId);
  const tagsBy = groupBy(tags, (r) => r.ingredientId);

  return core.map((row) => {
    const c = (compoundsBy.get(row.id) ?? []).map<CompoundRef>((r) => ({
      class: r.compoundClass,
      concentration: r.concentration,
    }));
    const a = (aromaBy.get(row.id) ?? []).map<AromaNoteRef>((r) => ({
      note: r.note,
      position: r.position,
    }));
    const ingTags = tagsBy.get(row.id) ?? [];
    const synergyTags = ingTags.filter((r) => r.role === 'synergy').map((r) => r.tag);
    const antagonistTags = ingTags.filter((r) => r.role === 'antagonist').map((r) => r.tag);
    return assemble(row, c, a, synergyTags, antagonistTags);
  });
}

export async function getIngredientBySlug(slug: string): Promise<Ingredient | null> {
  const all = await listIngredients();
  return all.find((i) => i.slug === slug) ?? null;
}
