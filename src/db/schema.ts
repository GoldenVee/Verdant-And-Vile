// Drizzle schema (hybrid normalization). Relationships the rules query are relational
// join tables with data; leaf value-objects (taste_profile, texture) and solvent config
// blobs are JSONB. Postgres enums are built from the domain vocabulary in domain/enums,
// so the DB and the TypeScript types share one source of truth.

import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  unique,
} from 'drizzle-orm/pg-core';

import {
  AROMA_POSITIONS,
  CATEGORIES,
  COMPOUND_KINDS,
  DOSE_RESPONSES,
  HEAT_DEFAULTS,
  HEAT_RESPONSES,
  LUMINOSITIES,
  MOTION_TENDENCIES,
  ORIGINS,
  OUTCOMES,
  PHYSICAL_FORMS,
  POLARITIES,
  SOLUBILITIES,
  SYNERGY_PAIR_TYPES,
  TAG_ROLES,
  TEMPERATURE_FEELS,
  TOXICITY_LEVELS,
  TRAITS,
} from '../domain/enums.js';
import type {
  AestheticBase,
  CategoryTiers,
  SignatureTransformation,
  TasteProfile,
  Texture,
} from '../domain/types.js';

// ---- Postgres enums ----
export const originEnum = pgEnum('origin', ORIGINS);
export const categoryEnum = pgEnum('category', CATEGORIES);
export const solubilityEnum = pgEnum('solubility', SOLUBILITIES);
export const toxicityLevelEnum = pgEnum('toxicity_level', TOXICITY_LEVELS);
export const doseResponseEnum = pgEnum('dose_response', DOSE_RESPONSES);
export const heatResponseEnum = pgEnum('heat_response', HEAT_RESPONSES);
export const temperatureFeelEnum = pgEnum('temperature_feel', TEMPERATURE_FEELS);
export const luminosityEnum = pgEnum('luminosity', LUMINOSITIES);
export const motionTendencyEnum = pgEnum('motion_tendency', MOTION_TENDENCIES);
export const traitEnum = pgEnum('trait', TRAITS);
export const polarityEnum = pgEnum('polarity', POLARITIES);
export const physicalFormEnum = pgEnum('physical_form', PHYSICAL_FORMS);
export const heatDefaultEnum = pgEnum('heat_default', HEAT_DEFAULTS);
export const outcomeEnum = pgEnum('outcome', OUTCOMES);
export const aromaPositionEnum = pgEnum('aroma_position', AROMA_POSITIONS);
export const tagRoleEnum = pgEnum('tag_role', TAG_ROLES);
export const compoundKindEnum = pgEnum('compound_kind', COMPOUND_KINDS);
export const synergyPairTypeEnum = pgEnum('synergy_pair_type', SYNERGY_PAIR_TYPES);

// ---- Reference tables (static vocabulary) ----

export const compoundClasses = pgTable('compound_classes', {
  slug: text('slug').primaryKey(),
  kind: compoundKindEnum('kind').notNull(),
  description: text('description'),
});

export const aromaNotesVocab = pgTable('aroma_notes', {
  slug: text('slug').primaryKey(),
  family: text('family'),
});

export const tagDefinitions = pgTable('tag_definitions', {
  slug: text('slug').primaryKey(),
  category: text('category').notNull(),
  targets: text('targets').array(),
  targetsAnyCompound: boolean('targets_any_compound').notNull().default(false),
  effectTargets: text('effect_targets').array(),
  boost: real('boost'),
  severity: real('severity'),
  oppositeTag: text('opposite_tag'),
});

export const synergyPairs = pgTable('synergy_pairs', {
  id: serial('id').primaryKey(),
  tagA: text('tag_a').notNull(),
  tagB: text('tag_b').notNull(),
  type: synergyPairTypeEnum('type').notNull(),
  boost: real('boost'),
  severity: real('severity'),
  complementaryCeiling: real('complementary_ceiling'),
  balancedCeiling: real('balanced_ceiling'),
  strainingCeiling: real('straining_ceiling'),
  warningTemplate: text('warning_template').notNull(),
});

export const effectSubtractiveEquivalents = pgTable('effect_subtractive_equivalents', {
  standardEffect: text('standard_effect').primaryKey(),
  subtractiveEquivalent: text('subtractive_equivalent').notNull(),
});

// ---- Core tables ----

export const ingredients = pgTable('ingredients', {
  // Meta
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  // Taxonomy
  lore: text('lore').notNull(),
  origin: originEnum('origin').notNull(),
  scientificName: text('scientific_name'),
  appearanceText: text('appearance_text').notNull(),
  appearanceImg: text('appearance_img'),
  // `type` is one of 62 physical forms; kept as text (large, growth-prone) rather than an enum.
  type: text('type').notNull(),
  category: categoryEnum('category').notNull(),
  relatedFamily: text('related_family'),
  traits: traitEnum('traits').array().notNull().default([]),
  // Reactive
  solubility: solubilityEnum('solubility').notNull(),
  phContribution: integer('ph_contribution'),
  toxicityBase: toxicityLevelEnum('toxicity_base').notNull(),
  stabilityBase: integer('stability_base').notNull(),
  extractionYield: real('extraction_yield').notNull(),
  potencyBase: integer('potency_base').notNull(),
  doseResponse: doseResponseEnum('dose_response').notNull(),
  hormeticThreshold: real('hormetic_threshold'),
  activationThreshold: real('activation_threshold'),
  ceilingValue: real('ceiling_value'),
  heatResponse: heatResponseEnum('heat_response').notNull(),
  // Sensory
  colorBase: text('color_base').notNull(),
  colorSecondary: text('color_secondary'),
  tasteProfile: jsonb('taste_profile').$type<TasteProfile>().notNull(),
  texture: jsonb('texture').$type<Texture>().notNull(),
  sound: text('sound'),
  temperatureFeel: temperatureFeelEnum('temperature_feel').notNull(),
  luminosity: luminosityEnum('luminosity').notNull(),
  motionTendency: motionTendencyEnum('motion_tendency').notNull(),
  aestheticWeight: real('aesthetic_weight').notNull(),
});

export const solvents = pgTable('solvents', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  lore: text('lore'),
  polarity: polarityEnum('polarity').notNull(),
  basePh: real('base_ph'),
  compatibleOutcomes: outcomeEnum('compatible_outcomes').array().notNull(),
  stabilityModifier: real('stability_modifier').notNull(),
  heatDefault: heatDefaultEnum('heat_default').notNull(),
  aestheticBase: jsonb('aesthetic_base').$type<AestheticBase>().notNull(),
  categoryAffinity: jsonb('category_affinity').$type<CategoryTiers>().notNull(),
  categoryResistance: jsonb('category_resistance').$type<CategoryTiers>().notNull(),
  signatureTransformation: jsonb('signature_transformation').$type<SignatureTransformation>(),
  physicalForm: physicalFormEnum('physical_form').notNull(),
});

// ---- Join tables (relationships with data) ----

export const ingredientCompounds = pgTable(
  'ingredient_compounds',
  {
    ingredientId: text('ingredient_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'cascade' }),
    compoundClass: text('compound_class')
      .notNull()
      .references(() => compoundClasses.slug),
    concentration: real('concentration').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ingredientId, t.compoundClass] })],
);

export const ingredientAromaNotes = pgTable(
  'ingredient_aroma_notes',
  {
    id: serial('id').primaryKey(),
    ingredientId: text('ingredient_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'cascade' }),
    note: text('note')
      .notNull()
      .references(() => aromaNotesVocab.slug),
    position: aromaPositionEnum('position').notNull(),
  },
  (t) => [unique().on(t.ingredientId, t.note, t.position)],
);

export const ingredientTags = pgTable(
  'ingredient_tags',
  {
    ingredientId: text('ingredient_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'cascade' }),
    tag: text('tag')
      .notNull()
      .references(() => tagDefinitions.slug),
    role: tagRoleEnum('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ingredientId, t.tag, t.role] })],
);
