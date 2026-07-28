// Known-case tests for SynergyRule (pass 1): the five grounded patterns and the cap.

import { describe, expect, it } from 'vitest';

import type { Outcome } from '../../src/domain/enums.js';
import type { Ingredient, PipelineData, Solvent } from '../../src/domain/types.js';
import { createContext } from '../../src/pipeline/context.js';
import { solventMatchRule } from '../../src/pipeline/rules/solvent-match.js';
import { makeSynergyRule } from '../../src/pipeline/rules/synergy.js';
import {
  makeIngredient,
  makeOpenSolvent,
  makePipelineData,
  makeSynergyPair,
  makeTagDef,
} from '../support/fixtures.js';

function build(ingredients: Ingredient[], opts: { solvent?: Solvent; outcome?: Outcome } = {}) {
  const solvent = opts.solvent ?? makeOpenSolvent();
  const context = createContext({ ingredients, solvent, outcome: opts.outcome ?? 'concentrate' });
  const matched = solventMatchRule.apply(context);
  if (!matched.ok) throw new Error(`solvent match failed: ${matched.error.reason}`);
  return context;
}

function run(ingredients: Ingredient[], data: PipelineData, opts: { solvent?: Solvent } = {}) {
  const context = build(ingredients, opts);
  makeSynergyRule(data).apply(context);
  return context;
}

const potency = (ci: { weightData: { potencyMultiplier: number } }) =>
  ci.weightData.potencyMultiplier;

describe('Pattern 1: related family', () => {
  it('mutually boosts two ingredients of the same family by 0.3', () => {
    const context = run(
      [
        makeIngredient({ id: 'a', relatedFamily: 'Solanaceae', aestheticWeight: 1.0 }),
        makeIngredient({ id: 'b', relatedFamily: 'Solanaceae', aestheticWeight: 1.0 }),
      ],
      makePipelineData(),
    );
    expect(potency(context.ingredients[0]!)).toBeCloseTo(1.3);
    expect(potency(context.ingredients[1]!)).toBeCloseTo(1.3);
  });

  it('does not boost across different families', () => {
    const context = run(
      [
        makeIngredient({ id: 'a', relatedFamily: 'Solanaceae' }),
        makeIngredient({ id: 'b', relatedFamily: 'Asteraceae' }),
      ],
      makePipelineData(),
    );
    expect(potency(context.ingredients[0]!)).toBe(1.0);
  });
});

describe('Pattern 2: shared compound classes (diminishing)', () => {
  it('boosts by 0.15 for one shared class', () => {
    const context = run(
      [
        makeIngredient({
          id: 'a',
          aestheticWeight: 1.0,
          compoundClasses: [{ class: 'alkaloid', concentration: 0.5 }],
        }),
        makeIngredient({
          id: 'b',
          aestheticWeight: 1.0,
          compoundClasses: [{ class: 'alkaloid', concentration: 0.5 }],
        }),
      ],
      makePipelineData(),
    );
    expect(potency(context.ingredients[0]!)).toBeCloseTo(1.15);
  });

  it('boosts by 0.24 for two shared classes (diminishing returns)', () => {
    const classes = [
      { class: 'alkaloid', concentration: 0.5 },
      { class: 'glycoside', concentration: 0.5 },
    ];
    const context = run(
      [
        makeIngredient({ id: 'a', aestheticWeight: 1.0, compoundClasses: classes }),
        makeIngredient({ id: 'b', aestheticWeight: 1.0, compoundClasses: classes }),
      ],
      makePipelineData(),
    );
    expect(potency(context.ingredients[0]!)).toBeCloseTo(1.24);
  });
});

describe('Pattern 3: tag targets compound', () => {
  it('directionally boosts an ingredient bearing a targeted compound', () => {
    const data = makePipelineData({
      tags: [makeTagDef({ slug: 'bioavailability-booster', boost: 0.6, targetsAnyCompound: true })],
    });
    const context = run(
      [
        makeIngredient({ id: 'a', synergyTags: ['bioavailability-booster'], aestheticWeight: 0.5 }),
        makeIngredient({
          id: 'b',
          compoundClasses: [{ class: 'alkaloid', concentration: 0.5 }],
          aestheticWeight: 1.0,
        }),
      ],
      data,
    );
    // Booster (A) unchanged; target (B) boosted by 1 + 0.6 * 0.5 = 1.3.
    expect(potency(context.ingredients[0]!)).toBe(1.0);
    expect(potency(context.ingredients[1]!)).toBeCloseTo(1.3);
  });
});

describe('Pattern 4: complementary tag pairs', () => {
  it('boosts a curated always-complementary pair', () => {
    const data = makePipelineData({
      pairs: [
        makeSynergyPair({
          tagA: 'emulsifier',
          tagB: 'binder',
          type: 'always_complementary',
          boost: 0.4,
        }),
      ],
    });
    const context = run(
      [
        makeIngredient({ id: 'a', synergyTags: ['emulsifier'], aestheticWeight: 1.0 }),
        makeIngredient({ id: 'b', synergyTags: ['binder'], aestheticWeight: 1.0 }),
      ],
      data,
    );
    expect(potency(context.ingredients[0]!)).toBeCloseTo(1.4);
    expect(potency(context.ingredients[1]!)).toBeCloseTo(1.4);
  });

  it('consumes a scaled pair deferred from AntagonismRule', () => {
    const context = build([
      makeIngredient({ id: 'a', aestheticWeight: 1.0 }),
      makeIngredient({ id: 'b', aestheticWeight: 1.0 }),
    ]);
    context.deferredComplementaryPairs.push({
      a: context.ingredients[0]!,
      b: context.ingredients[1]!,
      boost: 0.3,
    });
    makeSynergyRule(makePipelineData()).apply(context);
    expect(potency(context.ingredients[0]!)).toBeCloseTo(1.3);
    expect(potency(context.ingredients[1]!)).toBeCloseTo(1.3);
  });
});

describe('Pattern 5: trait-driven', () => {
  it('catalyst directionally boosts an ingredient carrying an amplifier tag', () => {
    const context = run(
      [
        makeIngredient({ id: 'a', traits: ['catalyst'], aestheticWeight: 0.5 }),
        makeIngredient({ id: 'b', synergyTags: ['stimulant-amplifier'], aestheticWeight: 1.0 }),
      ],
      makePipelineData(),
    );
    expect(potency(context.ingredients[0]!)).toBe(1.0);
    expect(potency(context.ingredients[1]!)).toBeCloseTo(1.25);
  });

  it('carrier directionally boosts other ingredients', () => {
    const context = run(
      [
        makeIngredient({ id: 'a', traits: ['carrier'], aestheticWeight: 0.5 }),
        makeIngredient({ id: 'b', aestheticWeight: 1.0 }),
      ],
      makePipelineData(),
    );
    expect(potency(context.ingredients[0]!)).toBe(1.0);
    expect(potency(context.ingredients[1]!)).toBeCloseTo(1.3);
  });

  it('quiescent directionally stabilizes a volatile ingredient', () => {
    const context = run(
      [
        makeIngredient({ id: 'a', traits: ['quiescent'], aestheticWeight: 0.5 }),
        makeIngredient({ id: 'b', traits: ['volatile'], aestheticWeight: 1.0 }),
      ],
      makePipelineData(),
    );
    expect(potency(context.ingredients[1]!)).toBeCloseTo(1.15);
  });
});

describe('synergy cap', () => {
  // Three ingredients sharing a family and three compound classes push each multiplier
  // above 2.5 before the cap.
  const stacked = () =>
    ['a', 'b', 'c'].map((id) =>
      makeIngredient({
        id,
        relatedFamily: 'shared-family',
        aestheticWeight: 1.0,
        compoundClasses: [
          { class: 'alkaloid', concentration: 0.5 },
          { class: 'glycoside', concentration: 0.5 },
          { class: 'tannin', concentration: 0.5 },
        ],
      }),
    );

  it('caps grounded solvents at 2.5', () => {
    const context = run(stacked(), makePipelineData());
    for (const ci of context.ingredients) {
      expect(potency(ci)).toBe(2.5);
    }
  });

  it('allows Ichor up to 5.0 (uncapped below it)', () => {
    const ichor = makeOpenSolvent({
      id: 'ichor',
      slug: 'ichor',
      signatureTransformation: { type: 'additive-elevation', summary: 'you become more' },
    });
    const context = run(stacked(), makePipelineData(), { solvent: ichor });
    for (const ci of context.ingredients) {
      expect(potency(ci)).toBeGreaterThan(2.5);
      expect(potency(ci)).toBeLessThanOrEqual(5.0);
    }
  });
});
