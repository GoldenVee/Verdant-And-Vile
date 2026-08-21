// ToxicityRule: computes three orthogonal toxicity dimensions (somatic, psychic,
// sensory), gates each against outcome-specific thresholds, and surfaces warnings. Runs
// after StabilityRule and before SignatureTransformRule. See docs/rules/toxicity.md.
//
// A plain rule: the toxicity mappings and outcome gates are fixed vocabulary held as
// constants. Contributions that depend on Lacuna's SynergyRule-pass-2 outputs
// (sensoryErasureCount, permanenceScale, lacunaTransmuteMarkers) read the context's
// defaults (0 / empty) until pass 2 populates them.

import type { Outcome, ToxicityLevel, ToxicityState } from '../../domain/enums.js';
import { err, ok } from '../../domain/result.js';
import type { CombinationIngredient } from '../../domain/types.js';
import type { BrewingContext } from '../context.js';
import type { Rule } from '../rule.js';

const TOXICITY_BASE: Record<ToxicityLevel, number> = {
  none: 0,
  low: 1.5,
  medium: 3,
  high: 5,
  lethal: 8,
};

const SOLVENT_SOMATIC: Record<string, number> = {
  water: 0,
  spirits: 0,
  oil: 0,
  vinegar: 0.5,
  honey: 0,
  ichor: 1,
  prism: 0.5,
  lacuna: 0,
};

interface Gate {
  somatic: number;
  psychic: number;
  sensory: number;
}

const OUTCOME_GATES: Record<Outcome, Gate> = {
  'eye-drops': { somatic: 4, psychic: 6, sensory: 5 },
  potion: { somatic: 8, psychic: 8, sensory: 8 },
  concentrate: { somatic: 7, psychic: 7, sensory: 8 },
  reduction: { somatic: 8, psychic: 8, sensory: 8 },
  balm: { somatic: 8, psychic: 9, sensory: 9 },
  liniment: { somatic: 7, psychic: 9, sensory: 9 },
  aromatic: { somatic: 9, psychic: 7, sensory: 6 },
  sachet: { somatic: 9, psychic: 8, sensory: 8 },
  vapors: { somatic: 8, psychic: 6, sensory: 5 },
  pellet: { somatic: 8, psychic: 8, sensory: 8 },
  paste: { somatic: 8, psychic: 8, sensory: 8 },
  'powder-balls': { somatic: 8, psychic: 8, sensory: 8 },
  veil: { somatic: 9, psychic: 8, sensory: 7 },
};

const PSYCHIC_DOMAINS = new Set(['memory', 'emotion', 'identity']);
const SENSORY_DOMAINS = new Set(['sight', 'sound', 'perception', 'sensation']);

function tagsOf(ci: CombinationIngredient): string[] {
  return [...ci.ingredient.synergyTags, ...ci.ingredient.antagonistTags];
}

function has(ingredients: CombinationIngredient[], tag: string): boolean {
  return ingredients.some((ci) => tagsOf(ci).includes(tag));
}

function count(ingredients: CombinationIngredient[], tag: string): number {
  return ingredients.filter((ci) => tagsOf(ci).includes(tag)).length;
}

function load(context: BrewingContext, compoundClass: string): number {
  return context.cumulativeLoads.get(compoundClass) ?? 0;
}

function computeSomatic(context: BrewingContext): number {
  let somatic = 0;

  // Per-ingredient baseline, weighted by normalized potency and aesthetic influence.
  for (const ci of context.ingredients) {
    const base = TOXICITY_BASE[ci.ingredient.toxicityBase];
    const potencyFactor = Math.min((ci.weightData.effectivePotency ?? 0) / 5, 1.0);
    somatic += base * potencyFactor * ci.ingredient.aestheticWeight;
  }

  // Compound-class load stacking.
  if (load(context, 'alkaloid') > 6) somatic += (load(context, 'alkaloid') - 6) * 1;
  if (load(context, 'oxide') > 4) somatic += (load(context, 'oxide') - 4) * 0.5;
  if (load(context, 'unknown-substance') > 3) {
    somatic += (load(context, 'unknown-substance') - 3) * 2;
  }
  if (load(context, 'noxious-vapor') > 2) somatic += (load(context, 'noxious-vapor') - 2) * 2;

  // Corrosive/damaging tags.
  for (const ci of context.ingredients) {
    if (tagsOf(ci).includes('denaturant')) somatic += 1 * ci.ingredient.aestheticWeight;
  }

  // Hormetic flips are actively harmful.
  for (const ci of context.ingredients) {
    if (ci.weightData.doseState === 'hormetic_harmful')
      somatic += 2 * ci.ingredient.aestheticWeight;
  }

  somatic += SOLVENT_SOMATIC[context.solvent.slug] ?? 0;

  // Decayed preparations are physically dangerous beyond their base chemistry.
  if (context.stabilityState === 'critically_unstable') somatic *= 1.5;

  return somatic;
}

function computePsychic(context: BrewingContext): number {
  const ingredients = context.ingredients;
  let psychic = 0; // no per-ingredient baseline: psychic harm emerges from interactions.

  if (has(ingredients, 'amnesiac') && has(ingredients, 'bioavailability-booster')) psychic += 2;
  if (has(ingredients, 'mnemonic') && has(ingredients, 'disinhibitor')) psychic += 2;
  if (has(ingredients, 'echo-binder') && has(ingredients, 'boundary-thinner')) psychic += 2;

  if (has(ingredients, 'disinhibitor')) psychic += 1;

  if (has(ingredients, 'boundary-thinner') && !has(ingredients, 'boundary-sealer')) psychic += 2;

  // Extreme sedative/stimulant stacking.
  let combinedIntensity = 0;
  for (const ci of ingredients) {
    const tags = tagsOf(ci);
    if (tags.includes('stimulant-amplifier') || tags.includes('sedative-amplifier')) {
      combinedIntensity += ci.weightData.chemicalExtractionWeight * ci.ingredient.aestheticWeight;
    }
  }
  if (combinedIntensity > 2.0) psychic += 1.5;

  // Permanent psychic effects are worse than temporary ones.
  if (
    context.solvent.slug === 'lacuna' &&
    context.permanenceScale !== null &&
    context.permanenceScale >= 2.0
  ) {
    psychic *= 1.5;
  }

  // Lacuna subtractive transmutations in psychic domains.
  for (const marker of context.lacunaTransmuteMarkers) {
    if (PSYCHIC_DOMAINS.has(marker.effectDomain)) psychic += 1;
  }

  return psychic;
}

function computeSensory(context: BrewingContext): number {
  const ingredients = context.ingredients;
  let sensory = 0;

  sensory += context.sensoryErasureCount * 1.5;

  const hallucinogenic = count(ingredients, 'hallucinogenic-amplifier');
  sensory += hallucinogenic * 1;
  if (hallucinogenic > 0 && !has(ingredients, 'reality-anchor')) sensory += 2;

  if (has(ingredients, 'perception-shifter') && has(ingredients, 'boundary-thinner')) sensory += 2;
  const shifters = count(ingredients, 'perception-shifter');
  if (shifters > 1) sensory += (shifters - 1) * 1;

  if (has(ingredients, 'time-dilator') && has(ingredients, 'hallucinogenic-amplifier')) {
    sensory += 2;
  }

  let silencerIntensity = 0;
  for (const ci of ingredients) {
    if (tagsOf(ci).includes('silencer')) {
      silencerIntensity += ci.weightData.chemicalExtractionWeight * ci.ingredient.aestheticWeight;
    }
  }
  if (silencerIntensity > 0.5) sensory += 2;

  if (has(ingredients, 'veil-drawer') && context.solvent.slug === 'lacuna') sensory += 1.5;

  for (const marker of context.lacunaTransmuteMarkers) {
    if (SENSORY_DOMAINS.has(marker.effectDomain)) sensory += 1;
  }

  return sensory;
}

function categorize(value: number, gate: number): ToxicityState {
  if (value >= gate) return 'lethal';
  if (value >= 7) return 'dangerous';
  if (value >= 5) return 'significant';
  if (value >= 3) return 'mild';
  return 'safe';
}

function addWarnings(context: BrewingContext, somatic: number, psychic: number, sensory: number) {
  if (somatic >= 3) context.warnings.push('may cause physical discomfort');
  if (somatic >= 5) context.warnings.push('significant physical toxicity');
  if (somatic >= 7) context.warnings.push('dangerous physical toxicity');
  if (psychic >= 3) context.warnings.push('may affect thought or emotion');
  if (psychic >= 5) context.warnings.push('significant psychic impact');
  if (psychic >= 7) context.warnings.push('dangerous psychic burden');
  if (sensory >= 3) context.warnings.push('may alter perception');
  if (sensory >= 5) context.warnings.push('significant sensory distortion');
  if (sensory >= 7) context.warnings.push('dangerous perceptual damage');
}

export const toxicityRule: Rule = {
  name: 'toxicity',

  apply(context: BrewingContext) {
    const somatic = Math.min(computeSomatic(context), 10);
    const psychic = Math.min(computePsychic(context), 10);
    const sensory = Math.min(computeSensory(context), 10);
    context.toxicity = { somatic, psychic, sensory };

    const gates = OUTCOME_GATES[context.outcome];

    // Gate checks fire in severity order; only the first exceeded gate fails.
    if (somatic >= gates.somatic) {
      return err({
        reason: 'lethal_somatic',
        message: 'The preparation would be physically dangerous to use in this form.',
      });
    }
    if (psychic >= gates.psychic) {
      return err({
        reason: 'lethal_psychic',
        message: 'The preparation would cause dangerous harm to mind or memory in this form.',
      });
    }
    if (sensory >= gates.sensory) {
      return err({
        reason: 'lethal_sensory',
        message: 'The preparation would cause dangerous perceptual damage in this form.',
      });
    }

    addWarnings(context, somatic, psychic, sensory);
    context.toxicityState = {
      somatic: categorize(somatic, gates.somatic),
      psychic: categorize(psychic, gates.psychic),
      sensory: categorize(sensory, gates.sensory),
    };

    return ok(context);
  },
};
