// The BrewingContext is the transient state passed between rules. It starts from the
// validated request and is populated progressively. Rules take a context and return a
// context (never coupled to HTTP or DB concerns).

import { combinationSeed, prngFor, type Prng } from '../domain/prng.js';
import type { FailureReason, Outcome } from '../domain/enums.js';
import type { Ingredient, Solvent } from '../domain/types.js';

export interface PipelineInput {
  ingredients: Ingredient[];
  solvent: Solvent;
  outcome: Outcome;
}

export interface BrewingContext {
  // Inputs. `ingredients` starts as raw records and is replaced by CombinationIngredient
  // wrappers once SolventMatchRule is implemented.
  ingredients: Ingredient[];
  solvent: Solvent;
  outcome: Outcome;

  // Deterministic seeding. `prngFor(ruleName)` yields an independent sub-stream so no
  // rule can pollute another's randomness.
  masterSeed: string;
  prngFor(ruleName: string): Prng;

  // Accumulated across rules.
  warnings: string[];

  // Failure state (set by whichever rule short-circuits).
  failed: boolean;
  failureReason: FailureReason | null;
}

export function createContext(input: PipelineInput): BrewingContext {
  const masterSeed = combinationSeed(
    input.ingredients.map((i) => i.id),
    input.solvent.id,
    input.outcome,
  );
  return {
    ingredients: input.ingredients,
    solvent: input.solvent,
    outcome: input.outcome,
    masterSeed,
    prngFor: (ruleName: string) => prngFor(masterSeed, ruleName),
    warnings: [],
    failed: false,
    failureReason: null,
  };
}
