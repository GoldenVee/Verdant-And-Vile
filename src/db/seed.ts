// Loads seed/ into the DB. Re-runnable: clears rows in FK-safe order, then inserts
// reference vocabulary, core records, and join rows. Run via `pnpm db:seed`.
//
// Seed JSON is authored in snake_case; we map it to the camelCase Drizzle insert
// shapes. Values arrive as plain strings, so each mapped array is cast once to the
// table's $inferInsert type (the DB enum constraints still enforce validity on write).

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { db } from './client.js';
import {
  aromaNotesVocab,
  compoundClasses,
  effectSubtractiveEquivalents,
  ingredientAromaNotes,
  ingredientCompounds,
  ingredientTags,
  ingredients,
  solvents,
  synergyPairs,
  tagDefinitions,
} from './schema.js';

type IngredientInsert = typeof ingredients.$inferInsert;
type SolventInsert = typeof solvents.$inferInsert;

const SEED_DIR = join(process.cwd(), 'seed');

function readJson<T>(...parts: string[]): T {
  return JSON.parse(readFileSync(join(SEED_DIR, ...parts), 'utf8')) as T;
}

// ---- Raw seed shapes (snake_case, as authored) ----

interface RawIngredient {
  id: string;
  slug: string;
  name: string;
  taxonomy: {
    lore: string;
    origin: string;
    scientific_name: string | null;
    appearance_text: string;
    appearance_img: string | null;
    type: string;
    category: string;
    traits: string[];
    compound_classes: { class: string; concentration: number }[];
    related_family: string | null;
  };
  reactive: {
    solubility: string;
    ph_contribution: number | null;
    toxicity_base: string;
    stability_base: number;
    extraction_yield: number;
    potency_base: number;
    dose_response: string;
    hormetic_threshold?: number | null;
    activation_threshold?: number | null;
    ceiling_value?: number | null;
    heat_response: string;
    synergy_tags: string[];
    antagonist_tags: string[];
  };
  sensory: {
    color_base: string;
    color_secondary: string | null;
    aroma_notes: { note: string; position: string }[];
    taste_profile: Record<string, number>;
    texture: { type: string; intensity: number };
    sound: string | null;
    temperature_feel: string;
    luminosity: string;
    motion_tendency: string;
    aesthetic_weight: number;
  };
}

interface RawSolvent {
  id: string;
  slug: string;
  name: string;
  lore: string | null;
  polarity: string;
  base_ph: number | null;
  compatible_outcomes: string[];
  stability_modifier: number;
  heat_default: string;
  aesthetic_base: { color: string; viscosity: string; luminosity: string };
  category_affinity: { strong: string[]; weak: string[] };
  category_resistance: { strong: string[]; weak: string[] };
  signature_transformation: { type: string; summary: string } | null;
  physical_form: string;
}

interface RawTag {
  slug: string;
  category: string;
  targets: string[] | null;
  targets_any_compound: boolean;
  effect_targets: string[] | null;
  boost: number | null;
  severity: number | null;
  opposite_tag: string | null;
}

interface RawPair {
  tag_a: string;
  tag_b: string;
  type: 'always_antagonistic' | 'always_complementary' | 'scaled';
  boost: number | null;
  severity: number | null;
  complementary_ceiling: number | null;
  balanced_ceiling: number | null;
  straining_ceiling: number | null;
  warning_template: string;
}

function loadIngredients(): RawIngredient[] {
  const dir = join(SEED_DIR, 'ingredients');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const all: RawIngredient[] = [];
  for (const file of files) {
    const block = readJson<{ ingredients: RawIngredient[] }>('ingredients', file);
    all.push(...block.ingredients);
  }
  return all;
}

function toIngredientRow(ing: RawIngredient): IngredientInsert {
  return {
    id: ing.id,
    slug: ing.slug,
    name: ing.name,
    lore: ing.taxonomy.lore,
    origin: ing.taxonomy.origin,
    scientificName: ing.taxonomy.scientific_name,
    appearanceText: ing.taxonomy.appearance_text,
    appearanceImg: ing.taxonomy.appearance_img,
    type: ing.taxonomy.type,
    category: ing.taxonomy.category,
    relatedFamily: ing.taxonomy.related_family,
    traits: ing.taxonomy.traits,
    solubility: ing.reactive.solubility,
    phContribution: ing.reactive.ph_contribution ?? null,
    toxicityBase: ing.reactive.toxicity_base,
    stabilityBase: ing.reactive.stability_base,
    extractionYield: ing.reactive.extraction_yield,
    potencyBase: ing.reactive.potency_base,
    doseResponse: ing.reactive.dose_response,
    hormeticThreshold: ing.reactive.hormetic_threshold ?? null,
    activationThreshold: ing.reactive.activation_threshold ?? null,
    ceilingValue: ing.reactive.ceiling_value ?? null,
    heatResponse: ing.reactive.heat_response,
    colorBase: ing.sensory.color_base,
    colorSecondary: ing.sensory.color_secondary,
    tasteProfile: ing.sensory.taste_profile,
    texture: ing.sensory.texture,
    sound: ing.sensory.sound,
    temperatureFeel: ing.sensory.temperature_feel,
    luminosity: ing.sensory.luminosity,
    motionTendency: ing.sensory.motion_tendency,
    aestheticWeight: ing.sensory.aesthetic_weight,
  } as IngredientInsert;
}

function toSolventRow(s: RawSolvent): SolventInsert {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    lore: s.lore,
    polarity: s.polarity,
    basePh: s.base_ph,
    compatibleOutcomes: s.compatible_outcomes,
    stabilityModifier: s.stability_modifier,
    heatDefault: s.heat_default,
    aestheticBase: s.aesthetic_base,
    categoryAffinity: s.category_affinity,
    categoryResistance: s.category_resistance,
    signatureTransformation: s.signature_transformation,
    physicalForm: s.physical_form,
  } as SolventInsert;
}

async function main(): Promise<void> {
  const compoundClassRows = readJson<{
    compound_classes: { slug: string; kind: string; description: string }[];
  }>('tables', 'compound_classes.json').compound_classes;
  const aromaNoteRows = readJson<{ aroma_notes: { slug: string; family: string }[] }>(
    'tables',
    'aroma_notes.json',
  ).aroma_notes;
  const tagRows = readJson<{ tag_definitions: RawTag[] }>(
    'tables',
    'tag_definitions.json',
  ).tag_definitions;
  const pairRows = readJson<{ synergy_pairs: RawPair[] }>(
    'tables',
    'synergy_pairs.json',
  ).synergy_pairs;
  const equivalentRows = readJson<{
    effect_subtractive_equivalents: { standard_effect: string; subtractive_equivalent: string }[];
  }>('tables', 'effect_subtractive_equivalents.json').effect_subtractive_equivalents;

  const ingredientRows = loadIngredients();
  const solventRows = readJson<{ solvents: RawSolvent[] }>('solvents', 'solvents.json').solvents;

  console.log('Clearing existing rows...');
  // Reverse FK order: join tables, then core, then reference vocabulary.
  await db.delete(ingredientTags);
  await db.delete(ingredientAromaNotes);
  await db.delete(ingredientCompounds);
  await db.delete(ingredients);
  await db.delete(solvents);
  await db.delete(synergyPairs);
  await db.delete(effectSubtractiveEquivalents);
  await db.delete(tagDefinitions);
  await db.delete(aromaNotesVocab);
  await db.delete(compoundClasses);

  console.log('Inserting reference vocabulary...');
  await db.insert(compoundClasses).values(
    compoundClassRows.map((c) => ({
      slug: c.slug,
      kind: c.kind,
      description: c.description,
    })) as (typeof compoundClasses.$inferInsert)[],
  );
  await db.insert(aromaNotesVocab).values(aromaNoteRows);
  await db.insert(tagDefinitions).values(
    tagRows.map((t) => ({
      slug: t.slug,
      category: t.category,
      targets: t.targets,
      targetsAnyCompound: t.targets_any_compound,
      effectTargets: t.effect_targets,
      boost: t.boost,
      severity: t.severity,
      oppositeTag: t.opposite_tag,
    })),
  );

  console.log('Inserting pipeline tables...');
  await db.insert(synergyPairs).values(
    pairRows.map((p) => ({
      tagA: p.tag_a,
      tagB: p.tag_b,
      type: p.type,
      boost: p.boost,
      severity: p.severity,
      complementaryCeiling: p.complementary_ceiling,
      balancedCeiling: p.balanced_ceiling,
      strainingCeiling: p.straining_ceiling,
      warningTemplate: p.warning_template,
    })),
  );
  await db.insert(effectSubtractiveEquivalents).values(
    equivalentRows.map((e) => ({
      standardEffect: e.standard_effect,
      subtractiveEquivalent: e.subtractive_equivalent,
    })),
  );

  console.log(`Inserting ${solventRows.length} solvents...`);
  await db.insert(solvents).values(solventRows.map(toSolventRow));

  console.log(`Inserting ${ingredientRows.length} ingredients...`);
  await db.insert(ingredients).values(ingredientRows.map(toIngredientRow));

  const compoundJoin = ingredientRows.flatMap((ing) =>
    ing.taxonomy.compound_classes.map((c) => ({
      ingredientId: ing.id,
      compoundClass: c.class,
      concentration: c.concentration,
    })),
  );
  const aromaJoin = ingredientRows.flatMap((ing) =>
    ing.sensory.aroma_notes.map((a) => ({
      ingredientId: ing.id,
      note: a.note,
      position: a.position,
    })),
  ) as (typeof ingredientAromaNotes.$inferInsert)[];
  const tagJoin = ingredientRows.flatMap((ing) => [
    ...ing.reactive.synergy_tags.map((tag) => ({ ingredientId: ing.id, tag, role: 'synergy' })),
    ...ing.reactive.antagonist_tags.map((tag) => ({
      ingredientId: ing.id,
      tag,
      role: 'antagonist',
    })),
  ]) as (typeof ingredientTags.$inferInsert)[];

  console.log(
    `Inserting join rows (${compoundJoin.length} compounds, ${aromaJoin.length} aroma, ${tagJoin.length} tags)...`,
  );
  await db.insert(ingredientCompounds).values(compoundJoin);
  await db.insert(ingredientAromaNotes).values(aromaJoin);
  if (tagJoin.length > 0) await db.insert(ingredientTags).values(tagJoin);

  console.log('Seed complete.');
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
