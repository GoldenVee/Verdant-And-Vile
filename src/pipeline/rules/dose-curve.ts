// DoseCurveRule: models dose-response chemistry. Computes cumulative compound-class load
// across the combination, then resolves each ingredient's effective potency against its
// dose-response curve. Runs after SynergyRule and before StabilityRule. See
// docs/rules/rules.md (DoseCurveRule).
//
// A plain rule, not a factory: it needs no lookup tables. The Lacuna subtractive/building
// tag classification is a fixed vocabulary, held here as constants (the rule doc is its
// canonical source). If it ever needs to change per-deploy it would move to a table.

import type { DoseResponse, DoseState } from '../../domain/enums.js';
import { err, ok } from '../../domain/result.js';
import type { CombinationIngredient } from '../../domain/types.js';
import type { BrewingContext } from '../context.js';
import type { Rule } from '../rule.js';

const ALL_RESPONSES: DoseResponse[] = ['linear', 'hormetic', 'threshold', 'ceiling'];

const DEFAULT_HORMETIC_THRESHOLD = 5.0;
const DEFAULT_ACTIVATION_THRESHOLD = 3.0;
const DEFAULT_CEILING_VALUE = 4.0;

const GROUNDED_FLIP_SEVERITY = 0.5;
const FICTIONAL_FLIP_SEVERITY = 0.7;

// Lacuna rewards subtractive ingredients and penalizes building ones. An ingredient with
// tags from both sets (or neither) is neutral.
const SUBTRACTIVE_TAGS = new Set([
  'amnesiac',
  'echo-dampener',
  'veil-drawer',
  'silencer',
  'moment-anchor',
  'lucidity-guard',
  'boundary-sealer',
  'reality-anchor',
  'concentrator',
  'chelator',
  'stabilizer',
  'preservative',
  'repeller',
  'will-fortifier',
  'cooling',
  'desiccant',
  'bioavailability-inhibitor',
  'denaturant',
  'separator',
  'loosener',
]);
const BUILDING_TAGS = new Set([
  'mnemonic',
  'echo-binder',
  'veil-piercer',
  'boundary-thinner',
  'hallucinogenic-amplifier',
  'stimulant-amplifier',
  'sedative-amplifier',
  'bioavailability-booster',
  'warming',
  'emulsifier',
  'binder',
  'acid-releaser',
  'alkalizer',
  'dream-inducer',
  'magnetizer',
  'disinhibitor',
  'diffuser',
  'deliquescent',
  'time-dilator',
  'volatile-fixer',
  'volatile-releaser',
  'accelerant',
]);

interface ThresholdModifiers {
  hormeticThreshold: number;
  activationThreshold: number;
  ceilingValue: number;
}

const NO_MODIFIERS: ThresholdModifiers = {
  hormeticThreshold: 0,
  activationThreshold: 0,
  ceilingValue: 0,
};

function tagsOf(ci: CombinationIngredient): string[] {
  return [...ci.ingredient.synergyTags, ...ci.ingredient.antagonistTags];
}

function isFictional(context: BrewingContext): boolean {
  return context.solvent.signatureTransformation !== null;
}

// Prism refracts an ingredient's response type: 40% stays, 20% each for the other three.
function refractDoseResponse(original: DoseResponse, roll: number): DoseResponse {
  if (roll < 0.4) return original;
  const others = ALL_RESPONSES.filter((r) => r !== original);
  if (roll < 0.6) return others[0]!;
  if (roll < 0.8) return others[1]!;
  return others[2]!;
}

function classifyForLacuna(ci: CombinationIngredient): 'subtractive' | 'building' | 'neutral' {
  const tags = tagsOf(ci);
  const hasSubtractive = tags.some((t) => SUBTRACTIVE_TAGS.has(t));
  const hasBuilding = tags.some((t) => BUILDING_TAGS.has(t));
  if (hasSubtractive && !hasBuilding) return 'subtractive';
  if (hasBuilding && !hasSubtractive) return 'building';
  return 'neutral';
}

// Solvent-signature threshold modifiers, additive to authored values.
function solventModifiers(slug: string, ci: CombinationIngredient): ThresholdModifiers {
  if (slug === 'ichor') {
    return { hormeticThreshold: 2.0, ceilingValue: 1.5, activationThreshold: -1.0 };
  }
  if (slug === 'lacuna') {
    const classification = classifyForLacuna(ci);
    if (classification === 'subtractive') {
      return { hormeticThreshold: 2.0, ceilingValue: 1.5, activationThreshold: -1.0 };
    }
    if (classification === 'building') {
      return { hormeticThreshold: -2.0, ceilingValue: -1.5, activationThreshold: 1.5 };
    }
  }
  // Prism and grounded solvents leave thresholds unchanged.
  return NO_MODIFIERS;
}

function basePotencyOf(ci: CombinationIngredient): number {
  return (
    ci.weightData.chemicalExtractionWeight *
    ci.weightData.potencyMultiplier *
    ci.ingredient.potencyBase
  );
}

export const doseCurveRule: Rule = {
  name: 'dose-curve',

  apply(context: BrewingContext) {
    const solvent = context.solvent;
    const fictional = isFictional(context);
    const prng = context.prngFor('dose-curve-rule');

    // Phase 1: Prism refracts response types; every other solvent keeps them.
    for (const ci of context.ingredients) {
      const original = ci.ingredient.doseResponse;
      if (solvent.slug === 'prism') {
        const refracted = refractDoseResponse(original, prng.next());
        ci.refractedResponse = refracted;
        if (refracted !== original) {
          context.warnings.push(
            `${ci.ingredient.name} response refracted from ${original} to ${refracted}.`,
          );
        }
      } else {
        ci.refractedResponse = original;
      }
    }

    // Phase 2: cumulative load per compound class.
    const loads = new Map<string, number>();
    for (const ci of context.ingredients) {
      for (const compound of ci.ingredient.compoundClasses) {
        const contribution = basePotencyOf(ci) * compound.concentration;
        loads.set(compound.class, (loads.get(compound.class) ?? 0) + contribution);
      }
    }
    context.cumulativeLoads = loads;

    // Phase 3: per-ingredient dose-curve application.
    const flipSeverity = fictional ? FICTIONAL_FLIP_SEVERITY : GROUNDED_FLIP_SEVERITY;

    for (const ci of context.ingredients) {
      const ingredient = ci.ingredient;
      const modifiers = solventModifiers(solvent.slug, ci);
      const hormeticThreshold =
        (ingredient.hormeticThreshold ?? DEFAULT_HORMETIC_THRESHOLD) + modifiers.hormeticThreshold;
      const activationThreshold =
        (ingredient.activationThreshold ?? DEFAULT_ACTIVATION_THRESHOLD) +
        modifiers.activationThreshold;
      const ceilingValue =
        (ingredient.ceilingValue ?? DEFAULT_CEILING_VALUE) + modifiers.ceilingValue;

      // Effective load is the max across this ingredient's compound classes: the most
      // concentrated environment it sits in.
      let effectiveLoad = 0;
      for (const compound of ingredient.compoundClasses) {
        const load = loads.get(compound.class) ?? 0;
        if (load > effectiveLoad) effectiveLoad = load;
      }

      const basePotency = basePotencyOf(ci);
      let effectivePotency: number;
      let doseState: DoseState;

      switch (ci.refractedResponse) {
        case 'hormetic':
          if (effectiveLoad <= hormeticThreshold) {
            effectivePotency = basePotency;
            doseState = 'hormetic_beneficial';
          } else {
            effectivePotency = -(basePotency * flipSeverity);
            doseState = 'hormetic_harmful';
            context.warnings.push(
              `${ingredient.name} hormetic flip: becomes harmful at high cumulative load.`,
            );
          }
          break;
        case 'threshold':
          if (effectiveLoad >= activationThreshold) {
            effectivePotency = basePotency;
            doseState = 'threshold_active';
          } else {
            effectivePotency = 0;
            doseState = 'threshold_inactive';
            context.warnings.push(
              `${ingredient.name} threshold not met: inactive at current load.`,
            );
          }
          break;
        case 'ceiling':
          if (basePotency <= ceilingValue) {
            effectivePotency = basePotency;
            doseState = 'ceiling_below';
          } else {
            effectivePotency = ceilingValue;
            doseState = 'ceiling_hit';
            context.warnings.push(
              `${ingredient.name} ceiling reached: additional contribution has no effect.`,
            );
          }
          break;
        case 'linear':
        default:
          effectivePotency = basePotency;
          doseState = 'linear';
          break;
      }

      ci.weightData.effectivePotency = effectivePotency;
      ci.weightData.doseState = doseState;
    }

    // Phase 4: hormetic cascade failure. Fictional solvents bypass it.
    if (!fictional) {
      let totalPositive = 0;
      let totalNegative = 0;
      for (const ci of context.ingredients) {
        const p = ci.weightData.effectivePotency ?? 0;
        if (p > 0) totalPositive += p;
        else if (p < 0) totalNegative += -p;
      }
      if (totalNegative > totalPositive) {
        return err({
          reason: 'extraction_impossible',
          message: 'The ingredients overwhelm each other at these concentrations.',
        });
      }
    }

    return ok(context);
  },
};
