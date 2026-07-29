// StabilityRule: computes how many days the preparation stays effective. An eight-stage
// multiplicative formula over ingredient bases, category composition, outcome, solvent,
// tags, traits, and fictional signatures, then a minimum-stability floor check. Runs
// after DoseCurveRule and before ToxicityRule. See docs/rules/rules.md (StabilityRule).
//
// A plain rule: category/outcome/tag modifiers are fixed vocabulary held as constants.
// Stability is a combination-level property; ingredient weight data is not modified here,
// except the decaying trait's documented presence-weight spread.

import type { Category, Outcome, StabilityState } from '../../domain/enums.js';
import { err, ok } from '../../domain/result.js';
import type { CombinationIngredient } from '../../domain/types.js';
import type { BrewingContext } from '../context.js';
import type { Rule } from '../rule.js';

const CATEGORY_MODIFIERS: Record<Category, number> = {
  mineral: 1.5,
  alchemical: 1.3,
  cosmic: 1.2,
  botanical: 1.0,
  'fauna-derived': 1.0,
  aberrant: 1.0,
  fungal: 0.8,
  pneuma: 0.6,
  effluvia: 0.5,
};

const OUTCOME_MODIFIERS: Record<Outcome, number> = {
  concentrate: 1.5,
  pellet: 1.5,
  'powder-balls': 1.5,
  reduction: 1.4,
  sachet: 1.4,
  balm: 1.3,
  paste: 1.0,
  potion: 1.0,
  liniment: 1.0,
  aromatic: 0.9,
  vapors: 0.7,
  veil: 0.6,
  'eye-drops': 0.5,
};

// Tags that raise (>1) or lower (<1) stability. Applied once per tag using the highest
// aesthetic weight among ingredients carrying it, scaled by that weight.
const STABILITY_TAGS: Record<string, number> = {
  preservative: 1.6,
  stabilizer: 1.4,
  desiccant: 1.5,
  'volatile-fixer': 1.3,
  chelator: 1.15,
  accelerant: 0.5,
  deliquescent: 0.6,
  'volatile-releaser': 0.7,
  oxidizer: 0.75,
};

const USE_IMMEDIATELY_OUTCOMES = new Set<Outcome>(['vapors', 'veil', 'eye-drops']);

const INDESTRUCTIBLE_FLOOR = 30;
const INDESTRUCTIBLE_MIN_AESTHETIC = 0.3;
const MINIMUM_STABILITY = 1.0;

function tagsOf(ci: CombinationIngredient): string[] {
  return [...ci.ingredient.synergyTags, ...ci.ingredient.antagonistTags];
}

function hasTrait(ci: CombinationIngredient, trait: string): boolean {
  return ci.ingredient.traits.includes(trait as never);
}

function weightedAverage(values: number[], weights: number[]): number {
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    weighted += values[i]! * weights[i]!;
    total += weights[i]!;
  }
  return total === 0 ? 0 : weighted / total;
}

// A tag multiplier scaled by the influence of the ingredient carrying it.
function scaledMultiplier(raw: number, aestheticWeight: number): number {
  return 1 + (raw - 1) * aestheticWeight;
}

function classify(
  stability: number,
  override: StabilityState | null,
  hasIndestructible: boolean,
): StabilityState {
  if (override) return override;
  if (hasIndestructible) return 'indefinite';
  if (stability > 365) return 'indefinite';
  if (stability > 180) return 'highly_stable';
  if (stability > 30) return 'stable';
  if (stability > 7) return 'moderately_stable';
  if (stability >= 1) return 'unstable';
  return 'critically_unstable';
}

export const stabilityRule: Rule = {
  name: 'stability',

  apply(context: BrewingContext) {
    const { ingredients, solvent, outcome } = context;
    const fictional = solvent.signatureTransformation !== null;
    const prng = context.prngFor('stability-rule');
    const aesthetics = ingredients.map((ci) => ci.ingredient.aestheticWeight);

    // Stage 1: base stability from weighted ingredient contributions (presence-weighted).
    const contributions = ingredients.map(
      (ci) =>
        ci.ingredient.stabilityBase * ci.weightData.presenceWeight * ci.ingredient.aestheticWeight,
    );
    let stability = weightedAverage(contributions, aesthetics);

    // Stage 2: category composition modifier (weighted average of category modifiers).
    const categoryValues = ingredients.map((ci) => CATEGORY_MODIFIERS[ci.ingredient.category]);
    stability *= weightedAverage(categoryValues, aesthetics);

    // Stage 3: outcome modifier.
    stability *= OUTCOME_MODIFIERS[outcome];

    // Stage 4: solvent modifier.
    stability *= solvent.stabilityModifier;

    // Stage 5: tag multipliers. Each tag applies once, using the highest-aesthetic bearer.
    for (const [tag, raw] of Object.entries(STABILITY_TAGS)) {
      let highestAesthetic = -1;
      for (const ci of ingredients) {
        if (tagsOf(ci).includes(tag) && ci.ingredient.aestheticWeight > highestAesthetic) {
          highestAesthetic = ci.ingredient.aestheticWeight;
        }
      }
      if (highestAesthetic >= 0) {
        stability *= scaledMultiplier(raw, highestAesthetic);
      }
    }

    // Stage 6: trait modifiers. Positive first, then negative, then indestructible floor.
    for (const ci of ingredients) {
      if (hasTrait(ci, 'quiescent')) stability *= 1.4;
    }
    for (const ci of ingredients) {
      if (hasTrait(ci, 'volatile')) {
        stability *= scaledMultiplier(0.6, ci.ingredient.aestheticWeight);
      }
    }
    for (const ci of ingredients) {
      if (!hasTrait(ci, 'decaying')) continue;
      stability *= scaledMultiplier(0.4, ci.ingredient.aestheticWeight);
      // Contamination spread: decay reduces the presence of everything else.
      for (const other of ingredients) {
        if (other !== ci) other.weightData.presenceWeight *= 0.9;
      }
    }
    for (const ci of ingredients) {
      if (hasTrait(ci, 'explosive')) {
        stability *= scaledMultiplier(0.5, ci.ingredient.aestheticWeight);
      }
    }
    // Mercurial randomizes stability, except under Prism (whose own refraction covers it).
    if (solvent.slug !== 'prism') {
      for (const ci of ingredients) {
        if (hasTrait(ci, 'mercurial')) stability *= prng.float(0.7, 1.4);
      }
    }

    const hasIndestructible = ingredients.some(
      (ci) =>
        hasTrait(ci, 'indestructible') &&
        ci.ingredient.aestheticWeight > INDESTRUCTIBLE_MIN_AESTHETIC,
    );
    if (hasIndestructible && stability < INDESTRUCTIBLE_FLOOR) {
      stability = INDESTRUCTIBLE_FLOOR;
    }

    // Stage 7: fictional solvent signatures.
    let stateOverride: StabilityState | null = null;
    if (solvent.slug === 'prism') {
      stability *= prng.float(0.7, 1.4);
      context.warnings.push('Prism refracts stability: outcome uncertain within predicted range.');
    }
    if (solvent.slug === 'lacuna') {
      if (stability > 30) stateOverride = 'indefinite';
      if (context.permanenceScale !== null && context.permanenceScale >= 2.0) {
        context.warnings.push('preparation carries indefinite absence.');
      }
    }

    // Stage 8: minimum stability check. Transient outcomes, indestructible presence, and
    // fictional solvents all bypass it.
    if (
      stability < MINIMUM_STABILITY &&
      !USE_IMMEDIATELY_OUTCOMES.has(outcome) &&
      !hasIndestructible &&
      !fictional
    ) {
      return err({
        reason: 'insufficient_stability',
        message: 'The preparation decays before it can be used.',
      });
    }

    context.stability = stability;
    context.stabilityState = classify(stability, stateOverride, hasIndestructible);
    return ok(context);
  },
};
