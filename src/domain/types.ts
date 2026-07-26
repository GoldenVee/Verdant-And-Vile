// Pure domain types. These describe the assembled shapes the pipeline and routes
// work with, independent of how they are stored. The data layer maps DB rows into
// these; nothing here imports from the DB or HTTP layers.

import type {
  AromaPosition,
  Category,
  DoseResponse,
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
  TasteKey,
  TemperatureFeel,
  TextureType,
  ToxicityLevel,
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
  // Human-readable per-ingredient notes surfaced to the final result.
  warnings: string[];
}

// An ingredient wrapped with its computed weight data for the duration of a
// combination. Downstream rules read ci.ingredient.<prop> for immutable properties
// and ci.weightData.<field> for pipeline state.
export interface CombinationIngredient {
  ingredient: Ingredient;
  weightData: WeightData;
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

export interface SignatureTransformation {
  type: SignatureType;
  summary: string;
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
  categoryAffinity: CategoryTiers;
  categoryResistance: CategoryTiers;
  signatureTransformation: SignatureTransformation | null;
  physicalForm: PhysicalForm;
}
