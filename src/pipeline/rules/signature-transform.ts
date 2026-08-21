// SignatureTransformRule: the final rule. Applies the fictional solvents' signature
// transformations to the resolved result. Grounded solvents skip it entirely. See
// docs/rules/rules.md (SignatureTransformRule).
//
// The effect transformations, marks, narrative wrap, warnings, and the colour and luminosity
// overlays are implemented. The aroma, texture, motion, and taste overlays are still deferred,
// since those sub-algorithms are not yet designed. Those sites are marked below.

import { AROMA_POSITIONS, type AromaPosition, type Luminosity } from '../../domain/enums.js';
import type { Prng } from '../../domain/prng.js';
import { ok } from '../../domain/result.js';
import type { AromaProfile, Effect, PipelineData } from '../../domain/types.js';
import {
  blend,
  darken,
  desaturate,
  parseHex,
  rotateHue,
  stripYellow,
} from '../../sensory/color.js';
import type { BrewingContext } from '../context.js';
import type { Rule } from '../rule.js';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Descriptor elevation is a placeholder pending the description algorithm (Phase 10); it
// simply marks the effect as heightened for now.
function elevate(descriptor: string): string {
  return `transcendent ${descriptor}`;
}

const ICHOR_NARRATIVE =
  "The preparation shines with a light that isn't quite metaphor. Ichor holds nothing " +
  'subtly. Every effect it carries is elevated, made more of itself. Consume with the ' +
  'understanding that divinity amplifies whatever it touches, its blessings and its costs alike.';

const PRISM_NARRATIVE =
  'The preparation refracts. What enters as one thing emerges as another. Effects duplicate ' +
  'in ways the recipient may not distinguish from their original sources. Where Prism has ' +
  'touched, the world becomes multiple, and the recipient sees a version of themselves that ' +
  "isn't quite them.";

const LACUNA_NARRATIVE =
  'Something is missing here. The preparation itself is barely present, muted and quiet and ' +
  'hard to describe. Its effects are absences rather than additions. The recipient loses what ' +
  'they consumed rather than gaining anything. Some of what is lost may never return.';

const ICHOR_GOLD = '#FFD700';
// Ichor floods rather than replaces: it enters the blend at overwhelming weight, so the
// result is always plainly gold while still carrying what was brewed.
const ICHOR_FLOOD = 0.75;

// Prism keeps a saturation floor so the spectrum reads as iridescent even when the
// underlying blend was muddy.
const PRISM_SATURATION_FLOOR = 0.65;
const PRISM_SECONDARY_TURN = 1 / 3;

// Notes Prism adds per point of synergy scope, capped so a high-scope combination does not
// bury the original profile.
const PRISM_NOTES_PER_SCOPE = 1;
const PRISM_MAX_ADDED_NOTES = 6;

// Erasure step at which aroma flattens. Top notes are the volatile ones that lift off a
// preparation, so they go first; at the far end only the base remains.
const LACUNA_AROMA_STEP = 3;
const LACUNA_MOTION_STEP = 5;
const LACUNA_HEART_STEP = 6;

// Lacuna dulls toward 'dull'. LUMINOSITIES is not a brightness ordering, so stepping down the
// enum would be wrong: light-swallowing is already maximal absence and stays put.
const DULLED: Record<Luminosity, Luminosity> = {
  phosphorescent: 'glossy',
  glossy: 'dull',
  dull: 'dull',
  'light-swallowing': 'light-swallowing',
};

function applyIchorSensory(context: BrewingContext): void {
  const sensory = context.sensoryOutput;
  if (sensory === null) return;

  sensory.colorBase = blend([sensory.colorBase, ICHOR_GOLD], [1 - ICHOR_FLOOD, ICHOR_FLOOD]);
  sensory.colorSecondary ??= ICHOR_GOLD;
  if (sensory.luminosity === 'dull' || sensory.luminosity === 'glossy') {
    sensory.luminosity = 'phosphorescent';
  }
}

// Takes the PRNG rather than deriving its own, and must be called after the effect
// duplication loop. Inserting a draw earlier shifts every downstream value and changes which
// effects are refracted, so the ordering is load-bearing, not stylistic.
function applyPrismSensory(context: BrewingContext, prng: Prng): void {
  const sensory = context.sensoryOutput;
  if (sensory === null) return;

  // A prism splits one input into a spectrum, so the rotation starts from the blended
  // ingredient colour: always a full spectrum, but where it starts is what was brewed.
  sensory.colorBase = rotateHue(sensory.colorBase, prng.next(), PRISM_SATURATION_FLOOR);
  sensory.colorSecondary = rotateHue(
    sensory.colorBase,
    PRISM_SECONDARY_TURN,
    PRISM_SATURATION_FLOOR,
  );
  sensory.luminosity = 'phosphorescent';
}

// A prism splits one thing into adjacent versions of itself, so the expansion pulls sibling
// notes from the same family as notes already present rather than inventing strings. The
// vocabulary supplies them: 17 of its 55 notes are authored but unused by any ingredient.
// Draws from the same stream as the rest of applyPrism, so it must stay after the existing
// consumption sites.
function expandAroma(
  profile: AromaProfile,
  families: Map<string, string>,
  scope: number,
  prng: Prng,
): void {
  const budget = Math.min(Math.floor(scope * PRISM_NOTES_PER_SCOPE), PRISM_MAX_ADDED_NOTES);
  if (budget <= 0) return;

  // Siblings by family, so a note present at any position can suggest relatives.
  const byFamily = new Map<string, string[]>();
  for (const [note, family] of families) {
    const list = byFamily.get(family) ?? [];
    list.push(note);
    byFamily.set(family, list);
  }
  for (const list of byFamily.values()) list.sort();

  const present = new Set(AROMA_POSITIONS.flatMap((pos) => profile[pos]));

  for (let added = 0; added < budget; added++) {
    // Candidates are unused siblings of whatever is currently in the profile.
    const candidates: Array<{ note: string; position: AromaPosition }> = [];
    for (const position of AROMA_POSITIONS) {
      for (const note of profile[position]) {
        const family = families.get(note);
        if (family === undefined) continue;
        for (const sibling of byFamily.get(family) ?? []) {
          if (!present.has(sibling)) candidates.push({ note: sibling, position });
        }
      }
    }
    if (candidates.length === 0) return;

    candidates.sort((a, b) => a.note.localeCompare(b.note) || a.position.localeCompare(b.position));
    const pick = candidates[Math.floor(prng.next() * candidates.length)];
    if (pick === undefined) return;
    profile[pick.position].push(pick.note);
    present.add(pick.note);
  }
}

// Progressive erasure. Step 1 dulls luminosity, step 2 onward strips the yellow channel over
// a darkening, desaturating ground. Y = 1 - B in subtractive space, so removing yellow is
// what leaves cyan and magenta behind: the mechanic and the look are the same operation.
function applyLacunaSensory(context: BrewingContext): void {
  const sensory = context.sensoryOutput;
  if (sensory === null) return;

  const count = context.sensoryErasureCount;
  if (count < 1) return;

  sensory.luminosity = DULLED[sensory.luminosity];
  if (count < 2) return;

  const t = Math.min((count - 1) / 5, 1);
  const erase = (hex: string) => darken(stripYellow(desaturate(hex, t), t * 0.6), t * 0.7);

  const [r, g] = parseHex(sensory.colorBase);
  sensory.colorBase = erase(sensory.colorBase);
  // What survives the erasure fringes toward whichever of the two remaining subtractive
  // primaries the original colour leaned into.
  sensory.colorSecondary =
    sensory.colorSecondary === null
      ? r >= g
        ? '#FF00FF'
        : '#00FFFF'
      : erase(sensory.colorSecondary);

  // Aroma flattens by losing its volatiles first: top notes lift off a preparation, so they
  // are the first thing to go missing. At the far end only the base remains.
  if (sensory.aromaProfile !== null) {
    if (count >= LACUNA_AROMA_STEP) sensory.aromaProfile.top = [];
    if (count >= LACUNA_HEART_STEP) sensory.aromaProfile.heart = [];
  }

  // Whatever the preparation was doing, it stops.
  if (count >= LACUNA_MOTION_STEP) sensory.motionTendency = 'still';

  // Texture is deferred to v2 apart from the separation blend_state already carries, so
  // erasure step 4 has nothing to act on yet.
}

function applyIchor(context: BrewingContext): void {
  applyIchorSensory(context);

  for (const effect of context.effects) {
    effect.descriptor = elevate(effect.descriptor);
  }

  const totalPotency = context.ingredients.reduce(
    (sum, ci) => sum + ci.weightData.potencyMultiplier,
    0,
  );
  const count = context.ingredients.length;
  const intensity = (totalPotency - count) * 0.8 + count * 0.5;
  const markLevel = clamp(Math.round(intensity / 2.5), 1, 5);
  context.marks.push({ solvent: 'ichor', markLevel });

  if ((context.toxicity?.somatic ?? 0) >= 5) {
    context.warnings.push('the divine solvent amplifies harm as readily as benefit');
  }
  if (markLevel >= 3) {
    context.warnings.push('this preparation will produce a moderate golden mark');
  }
  if (markLevel >= 4) {
    context.warnings.push(
      'this preparation will produce a significant golden mark with permanent perceptual expansion',
    );
  }

  context.narrativeWrap = ICHOR_NARRATIVE;
}

function applyPrism(context: BrewingContext, data: PipelineData): void {
  const prng = context.prngFor('signature-transform');

  // Effect duplication: each effect has a 40% chance of a refracted copy.
  const duplicates: Effect[] = [];
  for (const effect of context.effects) {
    if (prng.next() < 0.4) {
      duplicates.push({
        ...effect,
        id: `${effect.id}-refracted`,
        descriptor: `a refraction of ${effect.descriptor}`,
        refracted: true,
      });
    }
  }
  context.effects.push(...duplicates);

  // Drawn after the duplication loop on purpose: see applyPrismSensory.
  applyPrismSensory(context, prng);
  if (context.sensoryOutput?.aromaProfile != null) {
    expandAroma(
      context.sensoryOutput.aromaProfile,
      data.aromaFamilies,
      context.synergyScopeMultiplier,
      prng,
    );
  }

  const count = context.ingredients.length;
  const intensity = context.synergyScopeMultiplier * 1.2 + count * 0.4;
  const markLevel = clamp(Math.round(intensity / 2.5), 1, 5);
  context.marks.push({ solvent: 'prism', markLevel });

  if (markLevel >= 3) {
    context.warnings.push('this preparation will produce a moderate iridescent mark');
  }
  if (markLevel >= 4) {
    context.warnings.push(
      'this preparation will produce a significant iridescent mark with unstable perception',
    );
  }

  context.narrativeWrap = PRISM_NARRATIVE;
}

function applyLacuna(context: BrewingContext): void {
  // Subtractive effect resolution: apply each transmute marker to its matching effect.
  for (const marker of context.lacunaTransmuteMarkers) {
    const effect = context.effects.find(
      (e) => e.sourceIngredientId === marker.ingredientId && e.type === marker.originalEffect,
    );
    if (effect) {
      effect.type = marker.transmutedEffect;
      effect.subtractive = true;
    }
  }

  applyLacunaSensory(context);

  // Permanence tagging from the permanence scale.
  const permanence = context.permanenceScale ?? 0;
  if (permanence >= 2.0) {
    for (const effect of context.effects) {
      if (effect.subtractive) {
        effect.duration = 'permanent';
        effect.reversible = false;
      }
    }
  } else if (permanence >= 1.5) {
    for (const effect of context.effects) {
      if (effect.subtractive) effect.duration = 'extended';
    }
  }

  const count = context.ingredients.length;
  const intensity = context.sensoryErasureCount * 1.5 + permanence * 2 + count * 0.3;
  const markLevel = clamp(Math.round(intensity / 3), 1, 5);
  context.marks.push({ solvent: 'lacuna', markLevel });

  if (context.effects.some((e) => e.duration === 'permanent')) {
    context.warnings.push('preparation carries permanent absence, consider carefully');
  }
  if (markLevel >= 3) {
    context.warnings.push('this preparation will produce a moderate absence mark');
  }
  if (markLevel >= 4) {
    context.warnings.push(
      'this preparation will produce a significant absence mark with potentially permanent perceptual loss',
    );
  }
  if (markLevel >= 5) {
    context.warnings.push('this preparation may cause irrevocable perceptual erasure');
  }

  context.narrativeWrap = LACUNA_NARRATIVE;
}

// A factory now, because Prism's aroma expansion reads the aroma vocabulary. Same shape as
// the other data-dependent rules.
export function makeSignatureTransformRule(data: PipelineData): Rule {
  return {
    name: 'signature-transform',

    apply(context: BrewingContext) {
      if (context.solvent.signatureTransformation === null) return ok(context);

      switch (context.solvent.slug) {
        case 'ichor':
          applyIchor(context);
          break;
        case 'prism':
          applyPrism(context, data);
          break;
        case 'lacuna':
          applyLacuna(context);
          break;
      }

      return ok(context);
    },
  };
}
