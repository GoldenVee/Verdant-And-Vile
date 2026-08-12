// SynergyRule pass 2: emergent effects, Prism scope, and Lacuna erasure count, permanence
// scale, and transmute markers.

import { describe, expect, it } from 'vitest';

import type { Ingredient, PipelineData, Solvent } from '../../src/domain/types.js';
import { createContext } from '../../src/pipeline/context.js';
import { solventMatchRule } from '../../src/pipeline/rules/solvent-match.js';
import { makeSynergyRule } from '../../src/pipeline/rules/synergy.js';
import {
  makeEffectDef,
  makeFictionalSolvent,
  makeIngredient,
  makeOpenSolvent,
  makePipelineData,
  makeSynergyPair,
  makeTagDef,
} from '../support/fixtures.js';

function build(ingredients: Ingredient[], solvent: Solvent, data: PipelineData) {
  const context = createContext({ ingredients, solvent, outcome: 'concentrate' });
  const matched = solventMatchRule.apply(context);
  if (!matched.ok) throw new Error(`solvent match failed: ${matched.error.reason}`);
  makeSynergyRule(data).apply(context);
  return context;
}

const prism = () =>
  makeFictionalSolvent({
    slug: 'prism',
    signatureTransformation: { type: 'refractive-alteration', summary: 'you become other' },
  });
const lacuna = () => makeFictionalSolvent(); // slug 'lacuna'

// Two ingredients of the same related family fire exactly one synergy.
const family = () => [
  makeIngredient({ id: 'a', relatedFamily: 'X', aestheticWeight: 1 }),
  makeIngredient({ id: 'b', relatedFamily: 'X', aestheticWeight: 1 }),
];

describe('Prism scope', () => {
  it('sets the synergy scope multiplier to the number of synergies fired', () => {
    const context = build(family(), prism(), makePipelineData());
    expect(context.synergyScopeMultiplier).toBe(1);
  });
});

describe('Lacuna scalars', () => {
  it('sets the sensory erasure count to the number of synergies fired', () => {
    const context = build(family(), lacuna(), makePipelineData());
    expect(context.sensoryErasureCount).toBe(1);
  });

  it('sets the permanence scale to the max potency multiplier', () => {
    // Related-family boost 0.3 at full effective weight leaves each at 1.3.
    const context = build(family(), lacuna(), makePipelineData());
    expect(context.permanenceScale).toBeCloseTo(1.3);
  });

  it('builds transmute markers from producing tags with a subtractive equivalent', () => {
    const data = makePipelineData({
      tags: [makeTagDef({ slug: 'mnemonic', producesEffect: 'memory_recall' })],
      effects: [makeEffectDef('memory_recall', 'memory')],
      subtractiveEquivalents: { memory_recall: 'memory_erasure' },
    });
    const context = build(
      [makeIngredient({ id: 'rosemary', synergyTags: ['mnemonic'] })],
      lacuna(),
      data,
    );
    expect(context.lacunaTransmuteMarkers).toEqual([
      {
        ingredientId: 'rosemary',
        originalEffect: 'memory_recall',
        transmutedEffect: 'memory_erasure',
        effectDomain: 'memory',
      },
    ]);
  });
});

describe('emergent effects', () => {
  it('records an emergent effect intent when a complementary pair unlocks one', () => {
    const data = makePipelineData({
      pairs: [
        makeSynergyPair({
          tagA: 'emulsifier',
          tagB: 'binder',
          type: 'always_complementary',
          boost: 0.4,
          unlocksEffect: 'dream_enhancement',
        }),
      ],
    });
    const context = build(
      [
        makeIngredient({ id: 'a', synergyTags: ['emulsifier'], aestheticWeight: 1 }),
        makeIngredient({ id: 'b', synergyTags: ['binder'], aestheticWeight: 1 }),
      ],
      makeOpenSolvent(),
      data,
    );
    expect(context.emergentEffects).toEqual([{ effectType: 'dream_enhancement', magnitude: 2 }]);
  });
});

describe('grounded solvents', () => {
  it('leave the fictional scalars at their defaults', () => {
    const context = build(family(), makeOpenSolvent(), makePipelineData());
    expect(context.synergyScopeMultiplier).toBe(0);
    expect(context.sensoryErasureCount).toBe(0);
    expect(context.permanenceScale).toBeNull();
    expect(context.lacunaTransmuteMarkers).toEqual([]);
  });
});
