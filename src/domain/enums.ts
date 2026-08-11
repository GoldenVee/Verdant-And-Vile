// Canonical domain vocabularies. These `as const` arrays are the single source of
// truth: the DB layer builds Postgres enums from them, and the rest of the code
// derives TypeScript union types from them. Pure module, no I/O, no DB imports.

export const ORIGINS = ['real', 'fictional'] as const;
export type Origin = (typeof ORIGINS)[number];

export const CATEGORIES = [
  'botanical',
  'mineral',
  'fungal',
  'fauna-derived',
  'alchemical',
  'pneuma',
  'effluvia',
  'aberrant',
  'cosmic',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SOLUBILITIES = [
  'polar',
  'nonpolar',
  'acid-soluble',
  'universal',
  'insoluble',
] as const;
export type Solubility = (typeof SOLUBILITIES)[number];

export const TOXICITY_LEVELS = ['none', 'low', 'medium', 'high', 'lethal'] as const;
export type ToxicityLevel = (typeof TOXICITY_LEVELS)[number];

export const DOSE_RESPONSES = ['linear', 'hormetic', 'threshold', 'ceiling'] as const;
export type DoseResponse = (typeof DOSE_RESPONSES)[number];

// Per-ingredient dose-curve outcome, set by DoseCurveRule.
export const DOSE_STATES = [
  'linear',
  'hormetic_beneficial',
  'hormetic_harmful',
  'threshold_active',
  'threshold_inactive',
  'ceiling_below',
  'ceiling_hit',
] as const;
export type DoseState = (typeof DOSE_STATES)[number];

export const HEAT_RESPONSES = [
  'requires-heat',
  'destroyed-by-heat',
  'enhanced-by-heat',
  'neutral',
] as const;
export type HeatResponse = (typeof HEAT_RESPONSES)[number];

export const TEMPERATURE_FEELS = ['cold', 'neutral', 'warming', 'burning'] as const;
export type TemperatureFeel = (typeof TEMPERATURE_FEELS)[number];

export const LUMINOSITIES = ['dull', 'glossy', 'phosphorescent', 'light-swallowing'] as const;
export type Luminosity = (typeof LUMINOSITIES)[number];

export const MOTION_TENDENCIES = [
  'still',
  'settling',
  'rising',
  'swirling',
  'pulsing',
  'churning',
  'effervescent',
  'seeking',
  'layered',
  'restless',
] as const;
export type MotionTendency = (typeof MOTION_TENDENCIES)[number];

export const TRAITS = [
  'echoic',
  'volatile',
  'catalyst',
  'indestructible',
  'mercurial',
  'shy',
  'carrier',
  'quiescent',
  'decaying',
  'explosive',
] as const;
export type Trait = (typeof TRAITS)[number];

export const AROMA_POSITIONS = ['top', 'heart', 'base'] as const;
export type AromaPosition = (typeof AROMA_POSITIONS)[number];

export const TEXTURE_TYPES = [
  'viscous',
  'thin',
  'gritty',
  'effervescent',
  'crystalline',
  'oily',
  'waxy',
  'powdery',
  'fibrous',
] as const;
export type TextureType = (typeof TEXTURE_TYPES)[number];

export const TASTE_KEYS = [
  'sweet',
  'bitter',
  'sour',
  'salty',
  'umami',
  'astringent',
  'metallic',
  'bright',
] as const;
export type TasteKey = (typeof TASTE_KEYS)[number];

export const OUTCOMES = [
  'potion',
  'concentrate',
  'reduction',
  'liniment',
  'balm',
  'aromatic',
  'sachet',
  'vapors',
  'pellet',
  'paste',
  'powder-balls',
  'veil',
  'eye-drops',
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const POLARITIES = [
  'polar',
  'nonpolar',
  'acid-soluble',
  'universal',
  'anti-solvent',
] as const;
export type Polarity = (typeof POLARITIES)[number];

export const PHYSICAL_FORMS = ['liquid', 'solid'] as const;
export type PhysicalForm = (typeof PHYSICAL_FORMS)[number];

export const HEAT_DEFAULTS = ['cold', 'warm', 'hot'] as const;
export type HeatDefault = (typeof HEAT_DEFAULTS)[number];

export const SIGNATURE_TYPES = [
  'additive-elevation',
  'refractive-alteration',
  'subtractive-erasure',
] as const;
export type SignatureType = (typeof SIGNATURE_TYPES)[number];

export const TAG_ROLES = ['synergy', 'antagonist'] as const;
export type TagRole = (typeof TAG_ROLES)[number];

export const COMPOUND_KINDS = ['real', 'fictional'] as const;
export type CompoundKind = (typeof COMPOUND_KINDS)[number];

export const SYNERGY_PAIR_TYPES = [
  'always_antagonistic',
  'always_complementary',
  'scaled',
] as const;
export type SynergyPairType = (typeof SYNERGY_PAIR_TYPES)[number];

// Pipeline result vocabularies (used by rules and the combination response).

export const FAILURE_REASONS = [
  'no_ingredients',
  'outcome_incompatible',
  'extraction_impossible',
  'total_antagonism',
  'insufficient_stability',
  'lethal_somatic',
  'lethal_psychic',
  'lethal_sensory',
  'unknown',
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

export const STABILITY_STATES = [
  'critically_unstable',
  'unstable',
  'moderately_stable',
  'stable',
  'highly_stable',
  'indefinite',
] as const;
export type StabilityState = (typeof STABILITY_STATES)[number];

export const TOXICITY_STATES = ['safe', 'mild', 'significant', 'dangerous', 'lethal'] as const;
export type ToxicityState = (typeof TOXICITY_STATES)[number];

// Effect duration, set by SignatureTransformRule (Lacuna) from the permanence scale.
export const EFFECT_DURATIONS = ['normal', 'extended', 'permanent'] as const;
export type EffectDuration = (typeof EFFECT_DURATIONS)[number];

// Effect domains, used to route Lacuna transmutation markers to psychic vs sensory toxicity.
export const EFFECT_DOMAINS = [
  'memory',
  'emotion',
  'identity',
  'sight',
  'sound',
  'perception',
  'sensation',
  'time',
  'other',
] as const;
export type EffectDomain = (typeof EFFECT_DOMAINS)[number];

// Ingredient physical form. 62 values; kept as a validation list rather than a
// Postgres enum (large and more likely to grow than the small fixed vocabularies).
export const INGREDIENT_TYPES = [
  'root',
  'leaf',
  'flower',
  'bark',
  'seed',
  'fruit',
  'stem',
  'sap',
  'berry',
  'pollen',
  'wood',
  'thorn',
  'moss',
  'cap',
  'spore',
  'mycelium',
  'lichen',
  'bloom',
  'algae',
  'bone',
  'shell',
  'scale',
  'feather',
  'hair',
  'fat',
  'blood',
  'organ',
  'venom',
  'chitin',
  'horn',
  'tooth',
  'hide',
  'stone',
  'crystal',
  'salt',
  'metal',
  'ore',
  'mineral',
  'dust',
  'ash',
  'soot',
  'powder-raw',
  'oil-raw',
  'wax-raw',
  'honey-raw',
  'resin-raw',
  'rust',
  'slag',
  'residue',
  'vapor',
  'miasma',
  'exhalation',
  'essence',
  'aura',
  'breath',
  'silence',
  'resonance',
  'fragment',
  'shard',
  'filament',
  'anomaly',
  'unknown',
] as const;
export type IngredientType = (typeof INGREDIENT_TYPES)[number];
