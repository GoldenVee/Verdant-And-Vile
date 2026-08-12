// Known-case tests for EffectsRule: base effects from producing tags gated by dose state,
// multiplicity, non-producing tags, and emergent effects.

import { describe, expect, it } from 'vitest';

import type { Outcome } from '../../src/domain/enums.js';
import type { Ingredient, PipelineData, Solvent } from '../../src/domain/types.js';
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

// Builds a context and runs SolventMatchRule + DoseCurveRule so effective potency and dose
// state are final before EffectsRule reads them.
function build(ingredients: Ingredient[], opts: { solvent?: Solvent; outcome?: Outcome } = {}) {
  const solvent = opts.solvent ?? makeOpenSolvent();
  const context = createContext({ ingredients, solvent, outcome: opts.outcome ?? 'concentrate' });
  const matched = solventMatchRule.apply(context);
  if (!matched.ok) throw new Error(`solvent match failed: ${matched.error.reason}`);
  const dosed = doseCurveRule.apply(context);
  if (!dosed.ok) throw new Error(`dose curve failed: ${dosed.error.reason}`);
  return context;
}

function run(ingredients: Ingredient[], data: PipelineData) {
  const context = build(ingredients);
  makeEffectsRule(data).apply(context);
  return context;
}

// A vocabulary and mapping for the memory_recall effect via the mnemonic tag.
const memoryData = () =>
  makePipelineData({
    tags: [makeTagDef({ slug: 'mnemonic', producesEffect: 'memory_recall' })],
    effects: [makeEffectDef('memory_recall', 'memory', 'vivid recollection')],
  });

describe('base effects', () => {
  it('materializes an effect from a producing tag with magnitude = effective potency', () => {
    const context = run(
      [makeIngredient({ id: 'rosemary', synergyTags: ['mnemonic'], potencyBase: 5 })],
      memoryData(),
    );
    expect(context.effects).toHaveLength(1);
    const effect = context.effects[0]!;
    expect(effect.type).toBe('memory_recall');
    expect(effect.domain).toBe('memory');
    expect(effect.descriptor).toBe('vivid recollection');
    expect(effect.magnitude).toBe(5);
    expect(effect.sourceIngredientId).toBe('rosemary');
    expect(effect.emergent).toBe(false);
    expect(effect.subtractive).toBe(false);
    expect(effect.duration).toBe('normal');
  });

  it('produces no effect for a tag with no producesEffect mapping', () => {
    const context = run(
      [makeIngredient({ id: 'a', synergyTags: ['binder'], potencyBase: 5 })],
      makePipelineData({ tags: [makeTagDef({ slug: 'binder' })] }),
    );
    expect(context.effects).toHaveLength(0);
  });

  it('produces two distinct effects when two ingredients carry the same producing tag', () => {
    const context = run(
      [
        makeIngredient({ id: 'a', synergyTags: ['mnemonic'], potencyBase: 5 }),
        makeIngredient({ id: 'b', synergyTags: ['mnemonic'], potencyBase: 5 }),
      ],
      memoryData(),
    );
    expect(context.effects).toHaveLength(2);
    expect(context.effects.map((e) => e.sourceIngredientId).sort()).toEqual(['a', 'b']);
    expect(new Set(context.effects.map((e) => e.id)).size).toBe(2);
  });
});

describe('dose-state gating', () => {
  it('produces no effect for a threshold-inactive ingredient', () => {
    // load 1 * 1 * 4 * 0.5 = 2.0, below the default activation threshold 3.
    const context = run(
      [
        makeIngredient({
          id: 'a',
          synergyTags: ['mnemonic'],
          doseResponse: 'threshold',
          potencyBase: 4,
          compoundClasses: [{ class: 'alkaloid', concentration: 0.5 }],
        }),
      ],
      memoryData(),
    );
    expect(context.effects).toHaveLength(0);
  });

  it('produces no effect for a hormetic-flipped (harmful) ingredient', () => {
    const data = makePipelineData({
      tags: [makeTagDef({ slug: 'warming', producesEffect: 'warming_sensation' })],
      effects: [makeEffectDef('warming_sensation', 'sensation')],
    });
    // Hormetic (lipid load 5 > threshold 1) flips harmful; a linear source keeps the
    // cascade check satisfied.
    const context = run(
      [
        makeIngredient({
          id: 'a',
          synergyTags: ['warming'],
          doseResponse: 'hormetic',
          potencyBase: 5,
          hormeticThreshold: 1,
          compoundClasses: [{ class: 'lipid', concentration: 1 }],
        }),
        makeIngredient({ id: 'b', doseResponse: 'linear', potencyBase: 5 }),
      ],
      data,
    );
    expect(context.ingredients[0]!.weightData.doseState).toBe('hormetic_harmful');
    expect(context.effects).toHaveLength(0);
  });
});

describe('emergent effects', () => {
  it('materializes a synergy-unlocked emergent effect with a null source', () => {
    const data = makePipelineData({
      effects: [makeEffectDef('dream_enhancement', 'perception', 'deepened dreaming')],
    });
    const context = build([makeIngredient({ id: 'a', potencyBase: 5 })]);
    context.emergentEffects.push({ effectType: 'dream_enhancement', magnitude: 3 });
    makeEffectsRule(data).apply(context);

    expect(context.effects).toHaveLength(1);
    const effect = context.effects[0]!;
    expect(effect.type).toBe('dream_enhancement');
    expect(effect.emergent).toBe(true);
    expect(effect.sourceIngredientId).toBeNull();
    expect(effect.magnitude).toBe(3);
  });

  it('skips an effect whose type is not in the vocabulary', () => {
    const context = build([makeIngredient({ id: 'a', potencyBase: 5 })]);
    context.emergentEffects.push({ effectType: 'unknown_effect', magnitude: 3 });
    makeEffectsRule(makePipelineData()).apply(context);
    expect(context.effects).toHaveLength(0);
  });
});
