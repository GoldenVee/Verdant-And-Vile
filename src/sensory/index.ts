// The sensory algorithm. Computes the preparation's perceived qualities from final weights
// and ingredient data. See docs/rules/sensory.md.
//
// Every channel except texture is implemented. Texture is deferred to v2 apart from the
// separation that blend_state already carries.

import {
  AROMA_POSITIONS,
  LUMINOSITIES,
  MOTION_TENDENCIES,
  TASTE_KEYS,
  TEMPERATURE_FEELS,
  type BlendState,
  type Luminosity,
  type MotionTendency,
  type StabilityState,
  type TemperatureFeel,
} from '../domain/enums.js';
import type {
  AromaProfile,
  CombinationIngredient,
  SensoryOutput,
  Solvent,
  TasteProfile,
} from '../domain/types.js';
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

// Net warming or cooling tag load, as a fraction of total weight, needed to move the
// perceived temperature one step.
const TEMPERATURE_TAG_THRESHOLD = 0.3;

// A sound-bearing ingredient below this share of total weight is not audible. Every authored
// sound is already written as faint, so a trace ingredient should not be heard at all.
const SOUND_FLOOR = 0.15;

// Most notes a single position carries. Four ingredients at three notes each, plus the
// solvent, can offer more than a profile can usefully say.
const AROMA_NOTES_PER_POSITION = 4;

// Solvent notes enter muted, on top of the usual inverse-load solvent weight, so they
// colour a profile without ever leading it.
const AROMA_SOLVENT_MUTE = 0.5;

// Motion scoring weights. Ingredient tendency supplies a floor of at most 1.0, reached when
// every ingredient agrees on one value, so these sit around that mark. They do not need to be
// tuned past it: resolveMotion breaks ties in favour of whichever source actually fired, so a
// mechanism weighted at exactly 1.0 still beats unanimous agreement.
//
// layeredGradient sits low on purpose, since a gradient is a weaker claim than full separation.
const MOTION_WEIGHTS = {
  layeredSeparated: 1.5,
  layeredGradient: 0.7,
  churningCritical: 1.5,
  churningUnstable: 1.0,
  effervescent: 0.9,
  rising: 1.3,
  pulsing: 1.3,
  restless: 1.2,
  seeking: 1.2,
  still: 1.2,
  swirling: 1.0,
  settling: 0.9,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// How much an ingredient dominates the perceived character. Presence answers "is it
// physically there", so an insoluble ingredient still colours the mix; aesthetic answers
// "how much does it carry the character".
function contributionWeight(ci: CombinationIngredient): number {
  return ci.weightData.presenceWeight * ci.ingredient.aestheticWeight;
}

// Taste and pH are properties of the solution, so they follow what dissolved rather than what
// is present. You see what is present, you taste what dissolved. This also means the three
// insoluble quartzes, which have all-zero taste profiles, cannot dilute a preparation's taste.
function extractionContribution(ci: CombinationIngredient): number {
  return ci.weightData.chemicalExtractionWeight * ci.ingredient.aestheticWeight;
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

// Weighted average per dimension, with the solvent participating at the same inverse-load
// weight it takes in the colour blend. Averaged rather than summed: a taste profile describes
// what share of the character each participant carries, so summing would make every
// four-ingredient preparation more intense than every two-ingredient one.
export function resolveTaste(ingredients: CombinationIngredient[], solvent: Solvent): TasteProfile {
  const weights = ingredients.map(extractionContribution);
  const total = weights.reduce((sum, w) => sum + w, 0);
  const sw = solventWeight(total);
  const divisor = total + sw;

  const profile = {} as TasteProfile;
  for (const key of TASTE_KEYS) {
    let sum = solvent.tasteProfile[key] * sw;
    for (let i = 0; i < ingredients.length; i++) {
      const ci = ingredients[i];
      const w = weights[i];
      if (ci === undefined || w === undefined) continue;
      sum += ci.ingredient.tasteProfile[key] * w;
    }
    profile[key] = clamp(divisor > 0 ? sum / divisor : 0, 0, 1);
  }
  return profile;
}

// Weighted dominance on the authored field, then a one-step shift from tag load. The field
// stays primary because this is a sensory output; the tags modulate it. They disagree on
// three ingredients (Wormwood and Red Coral read cold but are tagged warming, Chamomile reads
// warming but is tagged cooling), which is not bad data: the tag is what an ingredient does
// pharmacologically, the field is how it feels. Wormwood should read as cold that warms
// slightly, not as a contradiction.
export function resolveTemperature(ingredients: CombinationIngredient[]): TemperatureFeel {
  const tally = new Map<TemperatureFeel, number>();
  let total = 0;
  let net = 0;

  for (const ci of ingredients) {
    const w = contributionWeight(ci);
    total += w;
    const feel = ci.ingredient.temperatureFeel;
    tally.set(feel, (tally.get(feel) ?? 0) + w);

    const tags = [...ci.ingredient.synergyTags, ...ci.ingredient.antagonistTags];
    if (tags.includes('warming')) net += w;
    if (tags.includes('cooling')) net -= w;
  }

  // Ties resolve by TEMPERATURE_FEELS order so the result is stable regardless of input order.
  let index = 0;
  let bestScore = -1;
  for (let i = 0; i < TEMPERATURE_FEELS.length; i++) {
    const feel = TEMPERATURE_FEELS[i];
    if (feel === undefined) continue;
    const score = tally.get(feel) ?? 0;
    if (score > bestScore) {
      index = i;
      bestScore = score;
    }
  }

  const pressure = total > 0 ? net / total : 0;
  if (pressure >= TEMPERATURE_TAG_THRESHOLD) index += 1;
  else if (pressure <= -TEMPERATURE_TAG_THRESHOLD) index -= 1;

  return TEMPERATURE_FEELS[clamp(index, 0, TEMPERATURE_FEELS.length - 1)] ?? 'neutral';
}

// Dominance, not merging. Sounds are authored prose, so averaging them is meaningless, and a
// trace ingredient's faint sound should not be audible at all. Solvents carry no sound.
export function resolveSound(ingredients: CombinationIngredient[]): string | null {
  const total = ingredients.reduce((sum, ci) => sum + contributionWeight(ci), 0);
  if (total <= 0) return null;

  let best: CombinationIngredient | null = null;
  let bestWeight = 0;
  for (const ci of ingredients) {
    if (ci.ingredient.sound === null) continue;
    const w = contributionWeight(ci);
    // Ties break on id so ingredient order cannot change the result.
    if (
      w > bestWeight ||
      (w === bestWeight && best !== null && ci.ingredient.id < best.ingredient.id)
    ) {
      best = ci;
      bestWeight = w;
    }
  }

  if (best === null || bestWeight / total < SOUND_FLOOR) return null;
  return best.ingredient.sound;
}

// Merges notes by position, each position independently. A note that one ingredient places
// at top and another places at heart appears at BOTH positions rather than being arbitrated
// to one. That is not a conflict: 22 of the 38 notes in use sit at different positions on
// different ingredients, and several ingredients carrying earth at different levels should
// produce a preparation that reads earthy the whole way down. Persisting across positions is
// the signature of a composition, not a collision to resolve.
export function resolveAroma(ingredients: CombinationIngredient[], solvent: Solvent): AromaProfile {
  const total = ingredients.reduce((sum, ci) => sum + contributionWeight(ci), 0);
  const solventShare = solventWeight(total) * AROMA_SOLVENT_MUTE;

  const profile: AromaProfile = { top: [], heart: [], base: [] };

  for (const position of AROMA_POSITIONS) {
    const weights = new Map<string, number>();

    for (const ci of ingredients) {
      const w = contributionWeight(ci);
      if (w <= 0) continue;
      for (const ref of ci.ingredient.aromaNotes) {
        if (ref.position !== position) continue;
        weights.set(ref.note, (weights.get(ref.note) ?? 0) + w);
      }
    }
    for (const ref of solvent.aromaNotes) {
      if (ref.position !== position) continue;
      weights.set(ref.note, (weights.get(ref.note) ?? 0) + solventShare);
    }

    // Heaviest first; ties break on slug so ingredient order cannot change the result.
    profile[position] = [...weights.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, AROMA_NOTES_PER_POSITION)
      .map(([note]) => note);
  }

  return profile;
}

// Weighted share of total presence held by ingredients matching a predicate.
function presenceShare(
  ingredients: CombinationIngredient[],
  predicate: (ci: CombinationIngredient) => boolean,
): number {
  let total = 0;
  let matching = 0;
  for (const ci of ingredients) {
    const w = contributionWeight(ci);
    total += w;
    if (predicate(ci)) matching += w;
  }
  return total > 0 ? matching / total : 0;
}

function hasCompound(ci: CombinationIngredient, classes: string[]): boolean {
  return ci.ingredient.compoundClasses.some((c) => classes.includes(c.class));
}

// Carbonate meeting acid evolves carbon dioxide. Alkaline load is what dissolved, scaled by
// how acidic the medium is, so this is zero in water and strong in vinegar without needing
// to know which ingredients are carbonates. Null pH means no aqueous phase and no fizz.
export function effervescence(ingredients: CombinationIngredient[], solvent: Solvent): number {
  if (solvent.basePh === null) return 0;
  const acidity = clamp((NEUTRAL_PH - solvent.basePh) / NEUTRAL_PH, 0, 1);
  if (acidity <= 0) return 0;

  let alkaline = 0;
  for (const ci of ingredients) {
    const ph = ci.ingredient.phContribution ?? 0;
    if (ph > 0) alkaline += ph * ci.weightData.chemicalExtractionWeight;
  }
  return alkaline * acidity;
}

// Motion is derived, with authored tendency as a floor rather than the driver. Ingredient
// motion_tendency only ever takes 4 of its 10 values in the seed data, so dominance selection
// would leave six structurally unreachable. Each mechanism below scores its own motion.
export function resolveMotion(
  ingredients: CombinationIngredient[],
  solvent: Solvent,
  blendState: BlendState,
  stabilityState: StabilityState | null,
): MotionTendency {
  // Floor and derived scores are tracked apart and never summed. The two are correlated
  // rather than independent: dense powder gets authored as `settling` AND matches the powdery
  // texture predicate, so adding them counts one fact twice. Corroboration should not inflate,
  // so a motion scores the greater of its two sources.
  const floor = new Map<MotionTendency, number>();
  const derived = new Map<MotionTendency, number>();
  const addFloor = (motion: MotionTendency, amount: number) => {
    if (amount > 0) floor.set(motion, (floor.get(motion) ?? 0) + amount);
  };
  const add = (motion: MotionTendency, amount: number) => {
    if (amount > 0) derived.set(motion, (derived.get(motion) ?? 0) + amount);
  };

  // Floor: what the ingredients themselves tend toward.
  const total = ingredients.reduce((sum, ci) => sum + contributionWeight(ci), 0);
  if (total > 0) {
    for (const ci of ingredients) {
      addFloor(ci.ingredient.motionTendency, contributionWeight(ci) / total);
    }
  }

  // Structural: the preparation did not homogenize, so it sits in strata.
  if (blendState === 'separated') add('layered', MOTION_WEIGHTS.layeredSeparated);
  else if (blendState === 'gradient') add('layered', MOTION_WEIGHTS.layeredGradient);

  // Agitation from instability. No ingredient carries the explosive trait, so this is the
  // only route to churning.
  if (stabilityState === 'critically_unstable') add('churning', MOTION_WEIGHTS.churningCritical);
  else if (stabilityState === 'unstable') add('churning', MOTION_WEIGHTS.churningUnstable);

  add(
    'effervescent',
    Math.min(effervescence(ingredients, solvent), 2) * MOTION_WEIGHTS.effervescent,
  );

  // Vapours ascend. Kept separate from the volatile trait: vapour is literal ascent, volatile
  // is passive instability.
  add(
    'rising',
    presenceShare(ingredients, (ci) => hasCompound(ci, ['essence-vapor', 'noxious-vapor'])) *
      MOTION_WEIGHTS.rising,
  );
  add(
    'restless',
    presenceShare(ingredients, (ci) => ci.ingredient.traits.includes('volatile')) *
      MOTION_WEIGHTS.restless,
  );
  // Echoic ingredients carry a captured quality that repeats, and five of the seven are the
  // breath-bearing ones. A preparation of those pulses like respiration.
  add(
    'pulsing',
    presenceShare(ingredients, (ci) => ci.ingredient.traits.includes('echoic')) *
      MOTION_WEIGHTS.pulsing,
  );
  add(
    'still',
    presenceShare(ingredients, (ci) => ci.ingredient.traits.includes('quiescent')) *
      MOTION_WEIGHTS.still,
  );
  add(
    'seeking',
    presenceShare(
      ingredients,
      (ci) => ci.ingredient.category === 'aberrant' || ci.ingredient.category === 'pneuma',
    ) * MOTION_WEIGHTS.seeking,
  );
  // Heat drives convection.
  add(
    'swirling',
    presenceShare(
      ingredients,
      (ci) =>
        ci.ingredient.temperatureFeel === 'warming' || ci.ingredient.temperatureFeel === 'burning',
    ) * MOTION_WEIGHTS.swirling,
  );
  // Dense matter falls out of suspension.
  add(
    'settling',
    presenceShare(
      ingredients,
      (ci) =>
        hasCompound(ci, ['mineral-salt']) ||
        ['crystalline', 'powdery', 'gritty'].includes(ci.ingredient.texture.type),
    ) * MOTION_WEIGHTS.settling,
  );

  // Highest score wins. On a tie a mechanism that actually fired beats a mere tendency:
  // motion is derived with tendency as a floor, so a floor outranking a live mechanism is not
  // behaving like a floor. Remaining ties resolve by enum order, which only ever decides
  // between two sources of the same kind.
  let best: MotionTendency = 'still';
  let bestScore = -1;
  let bestIsDerived = false;
  for (const motion of MOTION_TENDENCIES) {
    const d = derived.get(motion) ?? 0;
    const f = floor.get(motion) ?? 0;
    const score = Math.max(d, f);
    const isDerived = d > 0 && d >= f;
    if (score > bestScore || (score === bestScore && isDerived && !bestIsDerived)) {
      best = motion;
      bestScore = score;
      bestIsDerived = isDerived;
    }
  }
  return best;
}

export function computeSensory(
  ingredients: CombinationIngredient[],
  solvent: Solvent,
  stabilityState: StabilityState | null,
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
    aromaProfile: resolveAroma(ingredients, solvent),
    tasteProfile: resolveTaste(ingredients, solvent),
    temperatureFeel: resolveTemperature(ingredients),
    sound: resolveSound(ingredients),
    motionTendency: resolveMotion(ingredients, solvent, blendState, stabilityState),
    texture: null,
  };
}
