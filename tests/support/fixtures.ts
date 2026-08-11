// Builders for domain objects in tests. Each returns a complete, valid object with
// sensible defaults; pass overrides for the fields under test.

import { OUTCOMES } from '../../src/domain/enums.js';
import type { EffectDomain } from '../../src/domain/enums.js';
import type {
  EffectDefinition,
  Ingredient,
  PipelineData,
  Solvent,
  SynergyPair,
  TagDefinition,
} from '../../src/domain/types.js';

export function makeIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: 'test-ingredient',
    slug: 'test-ingredient',
    name: 'Test Ingredient',
    lore: '',
    origin: 'real',
    scientificName: null,
    appearanceText: '',
    appearanceImg: null,
    type: 'root',
    category: 'botanical',
    traits: [],
    relatedFamily: null,
    compoundClasses: [],
    solubility: 'polar',
    phContribution: 0,
    toxicityBase: 'none',
    stabilityBase: 5,
    extractionYield: 0.5,
    potencyBase: 5,
    doseResponse: 'linear',
    hormeticThreshold: null,
    activationThreshold: null,
    ceilingValue: null,
    heatResponse: 'neutral',
    synergyTags: [],
    antagonistTags: [],
    colorBase: '#000000',
    colorSecondary: null,
    aromaNotes: [],
    tasteProfile: {
      sweet: 0,
      bitter: 0,
      sour: 0,
      salty: 0,
      umami: 0,
      astringent: 0,
      metallic: 0,
      bright: 0,
    },
    texture: { type: 'thin', intensity: 0.5 },
    sound: null,
    temperatureFeel: 'neutral',
    luminosity: 'dull',
    motionTendency: 'still',
    aestheticWeight: 0.5,
    ...overrides,
  };
}

// Defaults model Water: polar, grounded, botanical/fungal affinity, effluvia resistance.
export function makeSolvent(overrides: Partial<Solvent> = {}): Solvent {
  return {
    id: 'water',
    slug: 'water',
    name: 'Water',
    lore: null,
    polarity: 'polar',
    basePh: 7,
    compatibleOutcomes: ['potion', 'concentrate', 'reduction'],
    stabilityModifier: 0.7,
    heatDefault: 'warm',
    aestheticBase: { color: '#EAF2F5', viscosity: 'thin', luminosity: 'glossy' },
    categoryAffinity: { strong: ['botanical', 'fungal'], weak: ['mineral', 'pneuma'] },
    categoryResistance: { strong: ['effluvia'], weak: ['cosmic'] },
    signatureTransformation: null,
    physicalForm: 'liquid',
    ...overrides,
  };
}

// A solvent that accepts every outcome, to isolate checks other than outcome compatibility.
export function makeOpenSolvent(overrides: Partial<Solvent> = {}): Solvent {
  return makeSolvent({ compatibleOutcomes: [...OUTCOMES], ...overrides });
}

// A fictional solvent (carries a signature transformation, so it bypasses gates).
export function makeFictionalSolvent(overrides: Partial<Solvent> = {}): Solvent {
  return makeSolvent({
    id: 'lacuna',
    slug: 'lacuna',
    name: 'Lacuna',
    polarity: 'anti-solvent',
    compatibleOutcomes: [...OUTCOMES],
    signatureTransformation: { type: 'subtractive-erasure', summary: 'you become less' },
    ...overrides,
  });
}

export function makeTagDef(overrides: Partial<TagDefinition> & { slug: string }): TagDefinition {
  return {
    category: 'interaction',
    targets: null,
    targetsAnyCompound: false,
    effectTargets: null,
    producesEffect: null,
    boost: null,
    severity: null,
    oppositeTag: null,
    ...overrides,
  };
}

export function makeEffectDef(
  type: string,
  domain: EffectDomain,
  defaultDescriptor = `${type} descriptor`,
): EffectDefinition {
  return { type, domain, defaultDescriptor };
}

export function makeSynergyPair(p: {
  tagA: string;
  tagB: string;
  type: SynergyPair['type'];
  boost?: number | null;
  severity?: number | null;
  complementaryCeiling?: number | null;
  balancedCeiling?: number | null;
  strainingCeiling?: number | null;
  unlocksEffect?: string | null;
  warningTemplate?: string;
}): SynergyPair {
  return {
    tagA: p.tagA,
    tagB: p.tagB,
    type: p.type,
    boost: p.boost ?? null,
    severity: p.severity ?? null,
    complementaryCeiling: p.complementaryCeiling ?? null,
    balancedCeiling: p.balancedCeiling ?? null,
    strainingCeiling: p.strainingCeiling ?? null,
    unlocksEffect: p.unlocksEffect ?? null,
    warningTemplate: p.warningTemplate ?? '{A} and {B} interact.',
  };
}

export function makePipelineData(
  opts: {
    tags?: TagDefinition[];
    pairs?: SynergyPair[];
    effects?: EffectDefinition[];
    subtractiveEquivalents?: Record<string, string>;
  } = {},
): PipelineData {
  const tagDefinitions = new Map<string, TagDefinition>();
  for (const tag of opts.tags ?? []) tagDefinitions.set(tag.slug, tag);
  const effectDefinitions = new Map<string, EffectDefinition>();
  for (const effect of opts.effects ?? []) effectDefinitions.set(effect.type, effect);
  const effectSubtractiveEquivalents = new Map<string, string>(
    Object.entries(opts.subtractiveEquivalents ?? {}),
  );
  return {
    tagDefinitions,
    synergyPairs: opts.pairs ?? [],
    effectDefinitions,
    effectSubtractiveEquivalents,
  };
}

// A complementary pair of tag definitions that oppose each other (each names the other
// as its opposite), for opposite-tag antagonism tests.
export function makeOppositeTags(a: string, b: string): TagDefinition[] {
  return [makeTagDef({ slug: a, oppositeTag: b }), makeTagDef({ slug: b, oppositeTag: a })];
}
