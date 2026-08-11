// SignatureTransformRule: the final rule. Applies the fictional solvents' signature
// transformations to the resolved result. Grounded solvents skip it entirely. See
// docs/rules/rules.md (SignatureTransformRule).
//
// Partial implementation: the effect transformations, marks, narrative wrap, and warnings
// are implemented. The sensory_output overlays (color/luminosity/aroma/progressive erasure)
// are deferred until the sensory algorithm (Phase 9) exists, since there is no sensory_output
// to modify yet. Those sites are marked below.

import { ok } from '../../domain/result.js';
import type { Effect } from '../../domain/types.js';
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

function applyIchor(context: BrewingContext): void {
  // Sensory (deferred): color shift toward gold and luminosity boost.

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

function applyPrism(context: BrewingContext): void {
  const prng = context.prngFor('signature-transform');

  // Sensory (deferred): iridescent quality and aroma expansion by synergy scope.

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

  // Sensory (deferred): progressive erasure by sensory_erasure_count.

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

export const signatureTransformRule: Rule = {
  name: 'signature-transform',

  apply(context: BrewingContext) {
    if (context.solvent.signatureTransformation === null) return ok(context);

    switch (context.solvent.slug) {
      case 'ichor':
        applyIchor(context);
        break;
      case 'prism':
        applyPrism(context);
        break;
      case 'lacuna':
        applyLacuna(context);
        break;
    }

    return ok(context);
  },
};
