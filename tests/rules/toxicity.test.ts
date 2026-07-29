// Known-case tests for ToxicityRule: the three dimensions, outcome gates, warnings, and
// state categorization.

import { describe, expect, it } from 'vitest';

import type { Outcome, StabilityState } from '../../src/domain/enums.js';
import type { Ingredient, Solvent } from '../../src/domain/types.js';
import { createContext } from '../../src/pipeline/context.js';
import { doseCurveRule } from '../../src/pipeline/rules/dose-curve.js';
import { solventMatchRule } from '../../src/pipeline/rules/solvent-match.js';
import { toxicityRule } from '../../src/pipeline/rules/toxicity.js';
import { makeIngredient, makeOpenSolvent } from '../support/fixtures.js';

// Runs SolventMatchRule + DoseCurveRule to populate effective potency and cumulative
// loads, then sets a stability state (Toxicity reads it), then runs ToxicityRule.
function run(
  ingredients: Ingredient[],
  opts: { solvent?: Solvent; outcome?: Outcome; stabilityState?: StabilityState } = {},
) {
  const solvent = opts.solvent ?? makeOpenSolvent();
  const context = createContext({ ingredients, solvent, outcome: opts.outcome ?? 'potion' });
  const matched = solventMatchRule.apply(context);
  if (!matched.ok) throw new Error(`solvent match failed: ${matched.error.reason}`);
  const dosed = doseCurveRule.apply(context);
  if (!dosed.ok) throw new Error(`dose curve failed: ${dosed.error.reason}`);
  context.stabilityState = opts.stabilityState ?? 'moderately_stable';
  const result = toxicityRule.apply(context);
  return { result, context };
}

// potencyBase 5 gives effective potency 5, so the somatic potency factor is exactly 1.0.
const tox = (over = {}) =>
  makeIngredient({ id: 'a', potencyBase: 5, aestheticWeight: 1.0, ...over });

describe('somatic', () => {
  it('maps toxicity_base and normalizes by potency and aesthetic', () => {
    const { result, context } = run([tox({ toxicityBase: 'lethal' })], { outcome: 'aromatic' });
    expect(result.ok).toBe(true);
    expect(context.toxicity!.somatic).toBeCloseTo(8);
    expect(context.toxicityState!.somatic).toBe('dangerous');
    expect(context.warnings).toContain('dangerous physical toxicity');
  });

  it('caps at 10 (and the value is set even when the gate fails)', () => {
    const { result, context } = run(
      [tox({ id: 'a', toxicityBase: 'lethal' }), tox({ id: 'b', toxicityBase: 'lethal' })],
      { outcome: 'aromatic' },
    );
    expect(context.toxicity!.somatic).toBe(10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('lethal_somatic');
  });

  it('adds compound-load stacking above the alkaloid threshold', () => {
    // Two alkaloid sources: load 5 + 5 = 10, which is 4 over the threshold of 6.
    const src = (id: string) =>
      tox({ id, toxicityBase: 'none', compoundClasses: [{ class: 'alkaloid', concentration: 1 }] });
    const { context } = run([src('a'), src('b')]);
    expect(context.toxicity!.somatic).toBeCloseTo(4);
    expect(context.toxicityState!.somatic).toBe('mild');
  });

  it('adds a flat contribution for a hormetic flip', () => {
    // Hormetic (lipid load 5 > threshold 1) flips harmful; a linear source keeps positive
    // potency dominant so the dose-curve cascade check passes.
    const { context } = run([
      tox({
        id: 'a',
        toxicityBase: 'none',
        doseResponse: 'hormetic',
        hormeticThreshold: 1,
        compoundClasses: [{ class: 'lipid', concentration: 1 }],
      }),
      tox({ id: 'b', toxicityBase: 'none', doseResponse: 'linear' }),
    ]);
    expect(context.ingredients[0]!.weightData.doseState).toBe('hormetic_harmful');
    expect(context.toxicity!.somatic).toBeCloseTo(2);
  });

  it('multiplies by 1.5 when critically unstable', () => {
    const { context } = run([tox({ toxicityBase: 'medium' })], {
      outcome: 'aromatic',
      stabilityState: 'critically_unstable',
    });
    expect(context.toxicity!.somatic).toBeCloseTo(4.5); // 3 * 1.5
  });
});

describe('psychic', () => {
  it('adds 1 for a disinhibitor', () => {
    const { context } = run([tox({ toxicityBase: 'none', synergyTags: ['disinhibitor'] })]);
    expect(context.toxicity!.psychic).toBeCloseTo(1);
  });

  it('adds 2 for an unbounded boundary-thinner, but cancels with a sealer', () => {
    const open = run([tox({ toxicityBase: 'none', synergyTags: ['boundary-thinner'] })]);
    expect(open.context.toxicity!.psychic).toBeCloseTo(2);

    const sealed = run([
      tox({ id: 'a', toxicityBase: 'none', synergyTags: ['boundary-thinner'] }),
      tox({ id: 'b', toxicityBase: 'none', synergyTags: ['boundary-sealer'] }),
    ]);
    expect(sealed.context.toxicity!.psychic).toBe(0);
  });

  it('fails with lethal_psychic when the outcome gate is exceeded', () => {
    // eye-drops psychic gate is 6. Stack interactions to 7.
    const { result } = run(
      [
        tox({
          id: 'a',
          toxicityBase: 'none',
          synergyTags: ['amnesiac', 'disinhibitor', 'boundary-thinner', 'mnemonic'],
        }),
        tox({ id: 'b', toxicityBase: 'none', synergyTags: ['bioavailability-booster'] }),
      ],
      { outcome: 'eye-drops' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('lethal_psychic');
  });
});

describe('sensory', () => {
  it('adds hallucinogenic stacking plus an unbounded penalty without a reality anchor', () => {
    const { context } = run([
      tox({ toxicityBase: 'none', synergyTags: ['hallucinogenic-amplifier'] }),
    ]);
    expect(context.toxicity!.sensory).toBeCloseTo(3); // 1 (count) + 2 (unbounded)
  });

  it('a reality anchor removes the unbounded penalty', () => {
    const { context } = run([
      tox({ id: 'a', toxicityBase: 'none', synergyTags: ['hallucinogenic-amplifier'] }),
      tox({ id: 'b', toxicityBase: 'none', synergyTags: ['reality-anchor'] }),
    ]);
    expect(context.toxicity!.sensory).toBeCloseTo(1);
  });

  it('adds 2 for meaningful silencer intensity', () => {
    const { context } = run([tox({ toxicityBase: 'none', synergyTags: ['silencer'] })]);
    expect(context.toxicity!.sensory).toBeCloseTo(2);
  });
});
