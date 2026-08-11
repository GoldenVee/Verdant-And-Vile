// The BrewingContext is the transient state passed between rules. It starts from the
// validated request and is populated progressively. Rules take a context and return a
// context (never coupled to HTTP or DB concerns).

import { combinationSeed, prngFor, type Prng } from '../domain/prng.js';
import type { FailureReason, Outcome, StabilityState } from '../domain/enums.js';
import type {
  CombinationIngredient,
  DeferredComplementaryPair,
  Effect,
  EmergentEffectIntent,
  Ingredient,
  LacunaTransmuteMarker,
  PipelineData,
  Solvent,
  Toxicity,
  ToxicityStateObject,
} from '../domain/types.js';

export interface PipelineInput {
  ingredients: Ingredient[];
  solvent: Solvent;
  outcome: Outcome;
}

export function emptyPipelineData(): PipelineData {
  return {
    tagDefinitions: new Map(),
    synergyPairs: [],
    effectDefinitions: new Map(),
    effectSubtractiveEquivalents: new Map(),
  };
}

export interface BrewingContext {
  // Ingredients are wrapped at context creation with empty weight data, so the type is
  // stable across the whole pipeline. SolventMatchRule populates the weights; later
  // rules read and extend them.
  ingredients: CombinationIngredient[];
  solvent: Solvent;
  outcome: Outcome;

  // Deterministic seeding. `prngFor(ruleName)` yields an independent sub-stream so no
  // rule can pollute another's randomness.
  masterSeed: string;
  prngFor(ruleName: string): Prng;

  // Set true by SolventMatchRule on a successful pass.
  solventValidated: boolean;

  // Scaled pairs AntagonismRule classified as complementary, consumed by SynergyRule.
  deferredComplementaryPairs: DeferredComplementaryPair[];

  // Emergent effects unlocked by synergy (SynergyRule pass 2), materialized by EffectsRule.
  emergentEffects: EmergentEffectIntent[];

  // The preparation's effects. Materialized by EffectsRule.
  effects: Effect[];

  // Cumulative compound-class load, keyed by compound class. Set by DoseCurveRule.
  cumulativeLoads: Map<string, number>;

  // Set by SynergyRule pass 2 (Lacuna); defaults until then. Read by StabilityRule and
  // ToxicityRule.
  permanenceScale: number | null;
  sensoryErasureCount: number;
  lacunaTransmuteMarkers: LacunaTransmuteMarker[];

  // Set by SynergyRule pass 2 (Prism); read by SignatureTransformRule.
  synergyScopeMultiplier: number;

  // Set by StabilityRule.
  stability: number | null;
  stabilityState: StabilityState | null;

  // Set by ToxicityRule.
  toxicity: Toxicity | null;
  toxicityState: ToxicityStateObject | null;

  // Accumulated across rules.
  warnings: string[];

  // Failure state (set by whichever rule short-circuits).
  failed: boolean;
  failureReason: FailureReason | null;
}

function wrap(ingredient: Ingredient): CombinationIngredient {
  return {
    ingredient,
    weightData: {
      chemicalExtractionWeight: 0,
      presenceWeight: 0,
      extractionYieldModifier: 0,
      potencyMultiplier: 1,
      effectivePotency: null,
      doseState: null,
      warnings: [],
    },
    refractedResponse: null,
  };
}

export function createContext(input: PipelineInput): BrewingContext {
  const masterSeed = combinationSeed(
    input.ingredients.map((i) => i.id),
    input.solvent.id,
    input.outcome,
  );
  return {
    ingredients: input.ingredients.map(wrap),
    solvent: input.solvent,
    outcome: input.outcome,
    masterSeed,
    prngFor: (ruleName: string) => prngFor(masterSeed, ruleName),
    solventValidated: false,
    deferredComplementaryPairs: [],
    emergentEffects: [],
    effects: [],
    cumulativeLoads: new Map(),
    permanenceScale: null,
    sensoryErasureCount: 0,
    lacunaTransmuteMarkers: [],
    synergyScopeMultiplier: 0,
    stability: null,
    stabilityState: null,
    toxicity: null,
    toxicityState: null,
    warnings: [],
    failed: false,
    failureReason: null,
  };
}
