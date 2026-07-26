// The BrewingContext is the transient state passed between rules. It starts from the
// validated request and is populated progressively. Rules take a context and return a
// context (never coupled to HTTP or DB concerns).

import { combinationSeed, prngFor, type Prng } from '../domain/prng.js';
import type { FailureReason, Outcome } from '../domain/enums.js';
import type { CombinationIngredient, Ingredient, Solvent } from '../domain/types.js';

export interface PipelineInput {
  ingredients: Ingredient[];
  solvent: Solvent;
  outcome: Outcome;
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
      warnings: [],
    },
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
    warnings: [],
    failed: false,
    failureReason: null,
  };
}
