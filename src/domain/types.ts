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
