// The sensory algorithm. Computes the preparation's perceived qualities from final weights
// and ingredient data. See docs/sensory.md.
//
// Colour and luminosity are implemented. Aroma, taste, texture, motion, temperature, and
// sound are not yet designed and are returned as null.

import { LUMINOSITIES, type BlendState, type Luminosity } from '../domain/enums.js';
import type { CombinationIngredient, SensoryOutput, Solvent } from '../domain/types.js';
import { blend, luminance, shiftToward } from './color.js';

// Reactive shift targets. Amber is fixed rather than derived because tannin browning
// produces phlobaphenes, which are the same class of compound whatever plant they came
// from. Tea, apple, and wine all brown to roughly this colour. Deriving it from the tannin
// bearers would give green, since most of them are green.
const AMBER = '#8B5A2B';
const ACID_RED = '#C41E3A';
const ALKALINE_TEAL = '#2E8B8B';

const NEUTRAL_PH = 7;

// Blend-state cut points. Spread only ever takes seven values, because the adjacency matrix
// emits 0, 0.3, 0.5, 0.7, and 1.0. Mean extraction is a second axis: two insoluble
// ingredients in Spirits both extract at 0.5, so spread is 0 while the truth is a uniform
// suspension.
const SEPARATED_SPREAD = 0.7;
const GRADIENT_SPREAD = 0.4;
const SUSPENSION_MEAN = 0.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// How much an ingredient dominates the perceived character. Presence answers "is it
// physically there", so an insoluble ingredient still colours the mix; aesthetic answers
// "how much does it carry the character".
function contributionWeight(ci: CombinationIngredient): number {
  return ci.weightData.presenceWeight * ci.ingredient.aestheticWeight;
}

function concentrationOf(ci: CombinationIngredient, compoundClass: string): number {
  return ci.ingredient.compoundClasses.find((c) => c.class === compoundClass)?.concentration ?? 0;
}

// Weighted load of a compound class in the medium. Scaled by extraction weight, because
// these are reactions in solution, and summed rather than averaged, because more tannin
// material means more tannin present.
//
// Deliberately NOT context.cumulativeLoads. That load is potency-scaled
// (extraction * potencyMultiplier * potencyBase), which is a pharmacological dose. Arsenic's
// cumulative load is enormous for toxicological reasons that have nothing to do with colour.
export function chromaticLoad(ingredients: CombinationIngredient[], compoundClass: string): number {
  let load = 0;
  for (const ci of ingredients) {
    load += concentrationOf(ci, compoundClass) * ci.weightData.chemicalExtractionWeight;
  }
  return load;
}

// pH is a property of the solution, so it follows what dissolved rather than what is
// present. Null when the solvent has no aqueous phase, which skips the flavonoid shift
// entirely rather than defaulting it to neutral.
export function combinationPh(
  ingredients: CombinationIngredient[],
  solvent: Solvent,
): number | null {
  if (solvent.basePh === null) return null;
  let shift = 0;
  for (const ci of ingredients) {
    shift += (ci.ingredient.phContribution ?? 0) * ci.weightData.chemicalExtractionWeight;
  }
  return clamp(solvent.basePh + shift, 0, 14);
}

export function resolveBlendState(ingredients: CombinationIngredient[]): BlendState {
  const weights = ingredients.map((ci) => ci.weightData.chemicalExtractionWeight);
  if (weights.length === 0) return 'homogeneous';
  const spread = Math.max(...weights) - Math.min(...weights);
  const mean = weights.reduce((sum, w) => sum + w, 0) / weights.length;

  if (spread >= SEPARATED_SPREAD) return 'separated';
  if (spread >= GRADIENT_SPREAD) return 'gradient';
  if (mean <= SUSPENSION_MEAN) return 'suspension';
  return 'homogeneous';
}

// The solvent joins the blend as a participant whose weight falls as ingredient load rises.
// A sparse preparation reads as tinted solvent; a dense one reads as its ingredients.
function solventWeight(ingredientTotal: number): number {
  return 1 / (1 + ingredientTotal);
}

function blendPhase(phase: CombinationIngredient[], solvent: Solvent): string {
  const colors = phase.map((ci) => ci.ingredient.colorBase);
  const weights = phase.map(contributionWeight);
  const total = weights.reduce((sum, w) => sum + w, 0);
  return blend([...colors, solvent.aestheticBase.color], [...weights, solventWeight(total)]);
}

// Splits into a dissolved and an undissolved phase at the midpoint of the extraction range.
// Only meaningful once blend state says the preparation did not homogenize.
function partition(ingredients: CombinationIngredient[]): {
  major: CombinationIngredient[];
  minor: CombinationIngredient[];
} {
  const weights = ingredients.map((ci) => ci.weightData.chemicalExtractionWeight);
  const midpoint = (Math.max(...weights) + Math.min(...weights)) / 2;
  const upper = ingredients.filter((ci) => ci.weightData.chemicalExtractionWeight >= midpoint);
  const lower = ingredients.filter((ci) => ci.weightData.chemicalExtractionWeight < midpoint);
  if (lower.length === 0) return { major: upper, minor: [] };

  const mass = (group: CombinationIngredient[]) =>
    group.reduce((sum, ci) => sum + contributionWeight(ci), 0);
  // The heavier phase by contribution weight is the one the preparation reads as.
  return mass(upper) >= mass(lower)
    ? { major: upper, minor: lower }
    : { major: lower, minor: upper };
}

// Applies the three reactive shifts in order. Iron-gall consumes the tannin it complexes,
// so the amber shift works on the remainder and precedence needs no separate rule.
export function applyReactiveShifts(
  color: string,
  ingredients: CombinationIngredient[],
  ph: number | null,
): string {
  let result = color;

  const tanninLoad = chromaticLoad(ingredients, 'tannin');

  // A tannate complex takes its colour from the metal: iron tannate is black because iron
  // oxides are dark, aluminium tannate is a pale lake because alum is white. So the
  // darkening scales by how dark the oxide bearer already is. This is why the whole `oxide`
  // class can drive the shift without white powders like Arsenic turning a tincture black.
  const oxideColors: string[] = [];
  const oxideWeights: number[] = [];
  let oxideDarkening = 0;
  for (const ci of ingredients) {
    const conc = concentrationOf(ci, 'oxide');
    if (conc <= 0) continue;
    const extracted = conc * ci.weightData.chemicalExtractionWeight;
    if (extracted <= 0) continue;
    oxideColors.push(ci.ingredient.colorBase);
    oxideWeights.push(extracted);
    oxideDarkening += extracted * (1 - luminance(ci.ingredient.colorBase));
  }

  const consumed = Math.min(tanninLoad, oxideDarkening);
  if (consumed > 0 && oxideColors.length > 0) {
    result = shiftToward(result, blend(oxideColors, oxideWeights), clamp(consumed, 0, 1));
  }

  const remaining = tanninLoad - consumed;
  if (remaining > 0) {
    result = shiftToward(result, AMBER, clamp(remaining, 0, 1));
  }

  if (ph !== null) {
    const flavonoidLoad = chromaticLoad(ingredients, 'flavonoid');
    const deviation = clamp((ph - NEUTRAL_PH) / NEUTRAL_PH, -1, 1);
    const strength = clamp(flavonoidLoad * Math.abs(deviation), 0, 1);
    if (strength > 0) {
      result = shiftToward(result, deviation < 0 ? ACID_RED : ALKALINE_TEAL, strength);
    }
  }

  return result;
}

// Weighted dominance across ingredients with the solvent participating. The solvent is why
// `light-swallowing` is reachable at all: no ingredient carries it, only Lacuna does.
export function resolveLuminosity(
  ingredients: CombinationIngredient[],
  solvent: Solvent,
): Luminosity {
  const tally = new Map<Luminosity, number>();
  let total = 0;
  for (const ci of ingredients) {
    const w = contributionWeight(ci);
    total += w;
    tally.set(ci.ingredient.luminosity, (tally.get(ci.ingredient.luminosity) ?? 0) + w);
  }
  const sw = solventWeight(total);
  tally.set(
    solvent.aestheticBase.luminosity,
    (tally.get(solvent.aestheticBase.luminosity) ?? 0) + sw,
  );

  // Ties resolve by LUMINOSITIES order so the result is stable regardless of input order.
  let best: Luminosity = LUMINOSITIES[0];
  let bestScore = -1;
  for (const value of LUMINOSITIES) {
    const score = tally.get(value) ?? 0;
    if (score > bestScore) {
      best = value;
      bestScore = score;
    }
  }
  return best;
}

export function computeSensory(
  ingredients: CombinationIngredient[],
  solvent: Solvent,
): SensoryOutput {
  const blendState = resolveBlendState(ingredients);
  const ph = combinationPh(ingredients, solvent);

  let colorBase: string;
  let colorSecondary: string | null = null;

  if (blendState === 'gradient' || blendState === 'separated') {
    const { major, minor } = partition(ingredients);
    colorBase = applyReactiveShifts(blendPhase(major, solvent), ingredients, ph);
    colorSecondary =
      minor.length > 0 ? applyReactiveShifts(blendPhase(minor, solvent), ingredients, ph) : null;
  } else {
    colorBase = applyReactiveShifts(blendPhase(ingredients, solvent), ingredients, ph);
  }

  return {
    colorBase,
    colorSecondary,
    blendState,
    luminosity: resolveLuminosity(ingredients, solvent),
    aromaProfile: null,
    tasteProfile: null,
    texture: null,
    motionTendency: null,
    temperatureFeel: null,
    sound: null,
  };
}
