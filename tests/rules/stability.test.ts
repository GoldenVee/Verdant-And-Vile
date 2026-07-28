// Known-case tests for StabilityRule, stage by stage, plus the failure and fictional
// signatures. Most cases use a single ingredient at aesthetic weight 1.0 so the Stage 1
// base equals its stability_base, isolating each later stage.

import { describe, expect, it } from 'vitest';

import type { Outcome } from '../../src/domain/enums.js';
import type { Ingredient, Solvent } from '../../src/domain/types.js';
import { createContext } from '../../src/pipeline/context.js';
import { solventMatchRule } from '../../src/pipeline/rules/solvent-match.js';
import { stabilityRule } from '../../src/pipeline/rules/stability.js';
import { makeFictionalSolvent, makeIngredient, makeOpenSolvent } from '../support/fixtures.js';

// Neutral grounded solvent: stability modifier 1.0, accepts every outcome.
function neutralSolvent(overrides: Partial<Solvent> = {}): Solvent {
  return makeOpenSolvent({ stabilityModifier: 1.0, ...overrides });
}

function run(ingredients: Ingredient[], opts: { solvent?: Solvent; outcome?: Outcome } = {}) {
  const solvent = opts.solvent ?? neutralSolvent();
  const context = createContext({ ingredients, solvent, outcome: opts.outcome ?? 'potion' });
  const matched = solventMatchRule.apply(context);
  if (!matched.ok) throw new Error(`solvent match failed: ${matched.error.reason}`);
  const result = stabilityRule.apply(context);
  return { result, context };
}

const base = (over = {}) =>
  makeIngredient({ id: 'a', stabilityBase: 10, aestheticWeight: 1.0, ...over });

describe('stages', () => {
  it('Stage 1: base stability equals stability_base at full presence and aesthetic', () => {
    const { context } = run([base()]);
    expect(context.stability).toBeCloseTo(10);
    expect(context.stabilityState).toBe('moderately_stable');
  });

  it('Stage 2: mineral category multiplies by 1.5', () => {
    const { context } = run([base({ category: 'mineral', solubility: 'acid-soluble' })]);
    expect(context.stability).toBeCloseTo(15);
  });

  it('Stage 3: concentrate outcome multiplies by 1.5', () => {
    const { context } = run([base()], { outcome: 'concentrate' });
    expect(context.stability).toBeCloseTo(15);
  });

  it('Stage 4: solvent stability modifier applies', () => {
    const { context } = run([base()], { solvent: neutralSolvent({ stabilityModifier: 2.0 }) });
    expect(context.stability).toBeCloseTo(20);
  });

  it('Stage 5: preservative tag multiplies by 1.6 at full aesthetic', () => {
    const { context } = run([base({ synergyTags: ['preservative'] })]);
    expect(context.stability).toBeCloseTo(16);
  });

  it('Stage 6: quiescent multiplies by 1.4', () => {
    const { context } = run([base({ traits: ['quiescent'] })]);
    expect(context.stability).toBeCloseTo(14);
  });

  it('Stage 6: volatile reduces to 0.6 at full aesthetic', () => {
    const { context } = run([base({ traits: ['volatile'] })]);
    expect(context.stability).toBeCloseTo(6);
    expect(context.stabilityState).toBe('unstable');
  });

  it('Stage 6: decaying reduces stability and spreads decay to others', () => {
    const { context } = run([base({ id: 'a', traits: ['decaying'] }), base({ id: 'b' })]);
    // Both contribute base 10 -> weighted average 10, then decaying scales by 0.4.
    expect(context.stability).toBeCloseTo(4);
    // The non-decaying ingredient's presence is reduced by 10%.
    expect(context.ingredients[1]!.weightData.presenceWeight).toBeCloseTo(0.9);
  });

  it('Stage 6: indestructible sets a 30-day floor and marks indefinite', () => {
    const { context } = run([base({ traits: ['indestructible'] })]);
    expect(context.stability).toBe(30);
    expect(context.stabilityState).toBe('indefinite');
  });
});

describe('minimum stability check', () => {
  it('fails with insufficient_stability for a non-transient outcome below 1 day', () => {
    // base 1 * effluvia 0.5 * potion 1.0 * water 0.7 = 0.35.
    const { result } = run([base({ stabilityBase: 1, category: 'effluvia' })], {
      solvent: makeOpenSolvent({ stabilityModifier: 0.7 }),
      outcome: 'potion',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('insufficient_stability');
  });

  it('exempts transient outcomes (vapors) from the failure', () => {
    const { result, context } = run([base({ stabilityBase: 1, category: 'effluvia' })], {
      solvent: makeOpenSolvent({ stabilityModifier: 0.7 }),
      outcome: 'vapors',
    });
    expect(result.ok).toBe(true);
    expect(context.stabilityState).toBe('critically_unstable');
  });

  it('a fictional solvent bypasses the failure', () => {
    const { result } = run([base({ stabilityBase: 1, category: 'effluvia' })], {
      solvent: makeFictionalSolvent({ stabilityModifier: 0.4 }),
      outcome: 'potion',
    });
    expect(result.ok).toBe(true);
  });
});

describe('fictional signatures', () => {
  it('Prism refracts stability deterministically within [0.7, 1.4] of the pre-refraction value', () => {
    const prism = makeFictionalSolvent({
      slug: 'prism',
      stabilityModifier: 1.0,
      signatureTransformation: { type: 'refractive-alteration', summary: 'you become other' },
    });
    const first = run([base()], { solvent: prism });
    const second = run([base()], { solvent: prism });
    expect(first.context.stability).toBe(second.context.stability);
    expect(first.context.stability!).toBeGreaterThanOrEqual(7);
    expect(first.context.stability!).toBeLessThanOrEqual(14);
  });

  it('Lacuna marks a long-lasting preparation as indefinite', () => {
    const lacuna = makeFictionalSolvent({ stabilityModifier: 5.0 }); // slug 'lacuna'
    const { context } = run([base()], { solvent: lacuna });
    expect(context.stability).toBeCloseTo(50);
    expect(context.stabilityState).toBe('indefinite');
  });

  it('mercurial randomizes deterministically under a non-Prism solvent', () => {
    const first = run([base({ traits: ['mercurial'] })]);
    const second = run([base({ traits: ['mercurial'] })]);
    expect(first.context.stability).toBe(second.context.stability);
    expect(first.context.stability!).toBeGreaterThanOrEqual(7);
    expect(first.context.stability!).toBeLessThanOrEqual(14);
  });
});
