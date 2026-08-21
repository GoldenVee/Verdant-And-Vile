// Pure domain types. These describe the assembled shapes the pipeline and routes
// work with, independent of how they are stored. The data layer maps DB rows into
// these; nothing here imports from the DB or HTTP layers.

import type {
  AromaPosition,
  BlendState,
  Category,
  DoseResponse,
  DoseState,
  EffectDomain,
  EffectDuration,
  HeatDefault,
  HeatResponse,
  IngredientType,
  Luminosity,
  MotionTendency,
  Origin,
  Outcome,
  PhysicalForm,
  Polarity,
  SignatureType,
  Solubility,
  SynergyPairType,
  TasteKey,
  TemperatureFeel,
  TextureType,
  ToxicityLevel,
  ToxicityState,
  Trait,
} from './enums.js';

// A compound class attached to an ingredient with its concentration weight (0.0-1.0).
export interface CompoundRef {
  class: string;
  concentration: number;
}

// An aroma note attached to an ingredient at a perfumery position.
export interface AromaNoteRef {
  note: string;
  position: AromaPosition;
}

export type TasteProfile = Record<TasteKey, number>;

export interface Texture {
  type: TextureType;
  intensity: number;
}

// The assembled ingredient record. Reactive fields drive chemistry; sensory fields
// drive perceived output. Nested relations (compoundClasses, aromaNotes, tags) come
// from join tables; tasteProfile and texture are leaf value-objects.
export interface Ingredient {
  // Meta
  id: string;
  slug: string;
  name: string;
  // Taxonomy
  lore: string;
  origin: Origin;
  scientificName: string | null;
  appearanceText: string;
  appearanceImg: string | null;
  type: IngredientType;
  category: Category;
  traits: Trait[];
  relatedFamily: string | null;
  compoundClasses: CompoundRef[];
  // Reactive
  solubility: Solubility;
  phContribution: number | null;
  toxicityBase: ToxicityLevel;
  stabilityBase: number;
  extractionYield: number;
  potencyBase: number;
  doseResponse: DoseResponse;
  hormeticThreshold: number | null;
  activationThreshold: number | null;
  ceilingValue: number | null;
  heatResponse: HeatResponse;
  synergyTags: string[];
  antagonistTags: string[];
  // Sensory
  colorBase: string;
  colorSecondary: string | null;
  aromaNotes: AromaNoteRef[];
  tasteProfile: TasteProfile;
  texture: Texture;
  sound: string | null;
  temperatureFeel: TemperatureFeel;
  luminosity: Luminosity;
  motionTendency: MotionTendency;
  aestheticWeight: number;
}

// Pipeline-derived weights attached to an ingredient during a combination. The
// original ingredient record stays immutable; this holds the mutable per-rule state.
// SolventMatchRule populates these fields; later rules add more (potency, dose state).
export interface WeightData {
  // How much of the ingredient's chemistry enters the medium (0.0-1.0). Set by
  // SolventMatchRule, reduced by AntagonismRule.
  chemicalExtractionWeight: number;
  // How much the ingredient is physically/sensorily present (0.0-1.0). Set
  // independently of extraction; insoluble ingredients still have presence.
  presenceWeight: number;
  // Additive modifier from category affinity/resistance (-0.50 to +0.30).
  extractionYieldModifier: number;
  // Accumulated synergy amplification (starts at 1.0, capped per solvent). Set by
  // SynergyRule on a field separate from extraction weight: extraction weight is how
  // much dissolved, potency multiplier is how effective what dissolved is.
  potencyMultiplier: number;
  // Final potency contribution after dose-curve resolution (may be negative on a
  // hormetic flip). Set by DoseCurveRule; null until then. Primary input to Stability
  // and Toxicity.
  effectivePotency: number | null;
  // Dose-curve outcome classification. Set by DoseCurveRule; null until then.
  doseState: DoseState | null;
  // Human-readable per-ingredient notes surfaced to the final result.
  warnings: string[];
}

// An ingredient wrapped with its computed weight data for the duration of a
// combination. Downstream rules read ci.ingredient.<prop> for immutable properties
// and ci.weightData.<field> for pipeline state.
export interface CombinationIngredient {
  ingredient: Ingredient;
  weightData: WeightData;
  // Dose response after Prism refraction (equals the ingredient's own response under any
  // other solvent). Set by DoseCurveRule; null until then.
  refractedResponse: DoseResponse | null;
}

export interface CategoryTiers {
  strong: Category[];
  weak: Category[];
}

export interface AestheticBase {
  color: string;
  viscosity: string;
  luminosity: Luminosity;
}

// Perfumery-style aroma layering. Not yet computed; the field exists so the sensory output
// shape is stable across the remaining Phase 9 work.
export interface AromaProfile {
  top: string[];
  heart: string[];
  base: string[];
}

// The preparation's perceived qualities, set by SensoryRule. Colour, luminosity, taste,
// temperature, and sound are computed; aroma and texture are null until their sub-algorithms
// are designed, and motion until its deferred session. Those are typed to their eventual
// shape rather than to null so consumers do not churn when the rest of Phase 9 lands.
export interface SensoryOutput {
  colorBase: string;
  colorSecondary: string | null;
  blendState: BlendState;
  luminosity: Luminosity;
  aromaProfile: AromaProfile | null;
  tasteProfile: TasteProfile | null;
  texture: Texture | null;
  motionTendency: MotionTendency | null;
  temperatureFeel: TemperatureFeel | null;
  sound: string | null;
}

export interface SignatureTransformation {
  type: SignatureType;
  summary: string;
}

// ---- Static lookup tables (the pipeline "rulebook") ----
// Loaded once from the DB and injected into rules that need them. Read-only; not part
// of per-combination state.

export interface TagDefinition {
  slug: string;
  category: string;
  // Compound classes this tag acts on (for tag-targets-compound patterns).
  targets: string[] | null;
  // True when the tag acts on any compound class (bioavailability booster/inhibitor).
  targetsAnyCompound: boolean;
  // Effect types this tag amplifies (parked gap; not yet backed by ingredient data).
  effectTargets: string[] | null;
  // Base effect type this tag produces (null for non-producing tags). Drives EffectsRule.
  producesEffect: string | null;
  // Synergy boost when the tag amplifies its targets.
  boost: number | null;
  // Antagonism severity when the tag neutralizes its targets.
  severity: number | null;
  oppositeTag: string | null;
}

// An entry in the effect vocabulary: an effect type with its domain and default descriptor.
export interface EffectDefinition {
  type: string;
  domain: EffectDomain;
  defaultDescriptor: string;
}

export interface SynergyPair {
  tagA: string;
  tagB: string;
  type: SynergyPairType;
  boost: number | null;
  severity: number | null;
  complementaryCeiling: number | null;
  balancedCeiling: number | null;
  strainingCeiling: number | null;
  // Emergent effect a complementary pair unlocks (null for most pairs).
  unlocksEffect: string | null;
  warningTemplate: string;
}

// The static data a pipeline run reads. Injected into rules that need it via a factory.
export interface PipelineData {
  tagDefinitions: Map<string, TagDefinition>;
  synergyPairs: SynergyPair[];
  effectDefinitions: Map<string, EffectDefinition>;
  // Base effect type to its Lacuna subtractive equivalent.
  effectSubtractiveEquivalents: Map<string, string>;
  // Aroma note to its family. Prism's expansion walks this to find sibling notes, which is
  // what lets the vocabulary supply the new notes rather than the rule inventing strings.
  aromaFamilies: Map<string, string>;
}

// A scaled tag pair AntagonismRule classified as complementary, deferred to SynergyRule.
export interface DeferredComplementaryPair {
  a: CombinationIngredient;
  b: CombinationIngredient;
  boost: number;
}

// A Lacuna subtractive transmutation record. Written by SynergyRule pass 2, read by
// ToxicityRule to route psychic/sensory contributions by effect domain.
export interface LacunaTransmuteMarker {
  ingredientId: string;
  originalEffect: string;
  transmutedEffect: string;
  effectDomain: EffectDomain;
}

// Three-dimensional toxicity, each 0-10.
export interface Toxicity {
  somatic: number;
  psychic: number;
  sensory: number;
}

export interface ToxicityStateObject {
  somatic: ToxicityState;
  psychic: ToxicityState;
  sensory: ToxicityState;
}

// An experiential effect the preparation produces. Materialized by EffectsRule; the
// transformation flags (subtractive/refracted/duration/reversible) are set later by
// SignatureTransformRule for fictional solvents.
export interface Effect {
  id: string;
  // The producing ingredient, or null for an emergent (synergy-unlocked) effect.
  sourceIngredientId: string | null;
  type: string;
  domain: EffectDomain;
  descriptor: string;
  // The source ingredient's effective potency (or the pair's combined potency, emergent).
  magnitude: number;
  emergent: boolean;
  subtractive: boolean;
  refracted: boolean;
  duration: EffectDuration;
  reversible: boolean;
}

// A synergy-unlocked effect intent, produced by SynergyRule pass 2, consumed by EffectsRule.
export interface EmergentEffectIntent {
  effectType: string;
  magnitude: number;
}

// A visible/perceptual sign a fictional solvent leaves on the recipient. Single-preparation
// intensity (1-5), not cumulative. Set by SignatureTransformRule.
export interface Mark {
  solvent: string;
  markLevel: number;
}

// The assembled solvent record.
export interface Solvent {
  id: string;
  slug: string;
  name: string;
  lore: string | null;
  polarity: Polarity;
  basePh: number | null;
  compatibleOutcomes: Outcome[];
  stabilityModifier: number;
  heatDefault: HeatDefault;
  aestheticBase: AestheticBase;
  // Authored per solvent. Honey is sweet, Vinegar sour; Water and Lacuna are flat, the
  // first because it is neutral and the second because it is absent.
  tasteProfile: TasteProfile;
  // Authored per solvent, and deliberately sparse. Solvent notes enter the merge muted so
  // they colour a profile without ever leading it.
  aromaNotes: AromaNoteRef[];
  categoryAffinity: CategoryTiers;
  categoryResistance: CategoryTiers;
  signatureTransformation: SignatureTransformation | null;
  physicalForm: PhysicalForm;
}
