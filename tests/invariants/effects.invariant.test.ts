// Property-based invariants for EffectsRule.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createContext } from '../../src/pipeline/context.js';
import { doseCurveRule } from '../../src/pipeline/rules/dose-curve.js';
import { makeEffectsRule } from '../../src/pipeline/rules/effects.js';
import { solventMatchRule } from '../../src/pipeline/rules/solvent-match.js';
import {
  makeEffectDef,
  makeIngredient,
  makeOpenSolvent,
  makePipelineData,
  makeTagDef,
} from '../support/fixtures.js';

const potencyBase = () => fc.integer({ min: 1, max: 10 });

const data = () =>
  makePipelineData({
    tags: [makeTagDef({ slug: 'mnemonic', producesEffect: 'memory_recall' })],
    effects: [makeEffectDef('memory_recall', 'memory')],
  });

describe('materialized effects', () => {
  it('a linear producing ingredient yields exactly one effect with positive magnitude', () => {
    fc.assert(
      fc.property(potencyBase(), (pb) => {
        const context = createContext({
          ingredients: [makeIngredient({ id: 'a', synergyTags: ['mnemonic'], potencyBase: pb })],
          solvent: makeOpenSolvent(),
          outcome: 'concentrate',
        });
        solventMatchRule.apply(context);
        doseCurveRule.apply(context);
        makeEffectsRule(data()).apply(context);

        expect(context.effects).toHaveLength(1);
        const effect = context.effects[0]!;
        expect(effect.magnitude).toBeGreaterThan(0);
        expect(effect.magnitude).toBe(context.ingredients[0]!.weightData.effectivePotency);
      }),
    );
  });
});
