// Known-case tests for DoseCurveRule: the four response types, cumulative load, the
// hormetic cascade failure, and the fictional-solvent signatures.

import { describe, expect, it } from 'vitest';

import type { Outcome } from '../../src/domain/enums.js';
import type { Ingredient, Solvent } from '../../src/domain/types.js';
import { createContext } from '../../src/pipeline/context.js';
import { doseCurveRule } from '../../src/pipeline/rules/dose-curve.js';
import { solventMatchRule } from '../../src/pipeline/rules/solvent-match.js';
import { makeFictionalSolvent, makeIngredient, makeOpenSolvent } from '../support/fixtures.js';

// Builds a context and runs SolventMatchRule (populating chem weight at 1.0 for polar
// ingredients in an open solvent). Synergy is not run, so potencyMultiplier stays 1.0.
function build(ingredients: Ingredient[], opts: { solvent?: Solvent; outcome?: Outcome } = {}) {
  const solvent = opts.solvent ?? makeOpenSolvent();
  const context = createContext({ ingredients, solvent, outcome: opts.outcome ?? 'concentrate' });
  const matched = solventMatchRule.apply(context);
  if (!matched.ok) throw new Error(`solvent match failed: ${matched.error.reason}`);
  return context;
}

function run(ingredients: Ingredient[], opts: { solvent?: Solvent } = {}) {
  const context = build(ingredients, opts);
  const result = doseCurveRule.apply(context);
  return { result, context };
}

const wd = (ci: { weightData: { effectivePotency: number | null; doseState: string | null } }) =>
  ci.weightData;

describe('response types', () => {
  it('linear: effective potency is chem x multiplier x base', () => {
    const { context } = run([makeIngredient({ id: 'a', doseResponse: 'linear', potencyBase: 5 })]);
    expect(wd(context.ingredients[0]!).effectivePotency).toBe(5);
    expect(wd(context.ingredients[0]!).doseState).toBe('linear');
  });

  it('hormetic beneficial below threshold', () => {
    // Single ingredient: load = 1 x 1 x 4 x 0.5 = 2.0, below the default threshold 5.
    const { context } = run([
      makeIngredient({
        id: 'a',
        doseResponse: 'hormetic',
        potencyBase: 4,
        compoundClasses: [{ class: 'alkaloid', concentration: 0.5 }],
      }),
    ]);
    expect(wd(context.ingredients[0]!).effectivePotency).toBe(4);
    expect(wd(context.ingredients[0]!).doseState).toBe('hormetic_beneficial');
  });

  it('hormetic harmful above threshold: negative potency at grounded severity 0.5', () => {
    // Two linear alkaloid sources plus a hormetic one push alkaloid load to ~21.6,
    // above threshold 5. Positive potency (16) exceeds negative (4), so no cascade fail.
    const linear = (id: string) =>
      makeIngredient({
        id,
        doseResponse: 'linear',
        potencyBase: 8,
        compoundClasses: [{ class: 'alkaloid', concentration: 0.9 }],
      });
    const { result, context } = run([
      linear('a'),
      linear('b'),
      makeIngredient({
        id: 'c',
        doseResponse: 'hormetic',
        potencyBase: 8,
        compoundClasses: [{ class: 'alkaloid', concentration: 0.9 }],
      }),
    ]);
    expect(result.ok).toBe(true);
    const hormetic = wd(context.ingredients[2]!);
    expect(hormetic.effectivePotency).toBeCloseTo(-4); // -(8 * 0.5)
    expect(hormetic.doseState).toBe('hormetic_harmful');
  });

  it('threshold inactive below activation, active above', () => {
    const inactive = run([
      makeIngredient({
        id: 'a',
        doseResponse: 'threshold',
        potencyBase: 4,
        compoundClasses: [{ class: 'alkaloid', concentration: 0.5 }], // load 2.0 < 3
      }),
    ]);
    expect(wd(inactive.context.ingredients[0]!).effectivePotency).toBe(0);
    expect(wd(inactive.context.ingredients[0]!).doseState).toBe('threshold_inactive');

    const active = run([
      makeIngredient({
        id: 'a',
        doseResponse: 'threshold',
        potencyBase: 8,
        compoundClasses: [{ class: 'alkaloid', concentration: 0.9 }], // load 7.2 >= 3
      }),
    ]);
    expect(wd(active.context.ingredients[0]!).effectivePotency).toBe(8);
    expect(wd(active.context.ingredients[0]!).doseState).toBe('threshold_active');
  });

  it('ceiling caps potency at the ceiling value', () => {
    const below = run([makeIngredient({ id: 'a', doseResponse: 'ceiling', potencyBase: 3 })]);
    expect(wd(below.context.ingredients[0]!).effectivePotency).toBe(3);
    expect(wd(below.context.ingredients[0]!).doseState).toBe('ceiling_below');

    const hit = run([makeIngredient({ id: 'a', doseResponse: 'ceiling', potencyBase: 8 })]);
    expect(wd(hit.context.ingredients[0]!).effectivePotency).toBe(4); // default ceiling
    expect(wd(hit.context.ingredients[0]!).doseState).toBe('ceiling_hit');
  });
});

describe('cumulative load', () => {
  it('sums per compound class across ingredients', () => {
    const { context } = run([
      makeIngredient({
        id: 'a',
        potencyBase: 4,
        compoundClasses: [{ class: 'alkaloid', concentration: 0.5 }],
      }),
      makeIngredient({
        id: 'b',
        potencyBase: 6,
        compoundClasses: [{ class: 'alkaloid', concentration: 0.5 }],
      }),
    ]);
    // 1*1*4*0.5 + 1*1*6*0.5 = 2 + 3 = 5.
    expect(context.cumulativeLoads.get('alkaloid')).toBeCloseTo(5);
  });
});

describe('hormetic cascade failure', () => {
  it('fails with extraction_impossible when negative potency dominates', () => {
    const hormetic = (id: string) =>
      makeIngredient({
        id,
        doseResponse: 'hormetic',
        potencyBase: 8,
        hormeticThreshold: 3,
        compoundClasses: [{ class: 'alkaloid', concentration: 0.9 }],
      });
    const { result } = run([hormetic('a'), hormetic('b')]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('extraction_impossible');
  });

  it('a fictional solvent bypasses the cascade failure', () => {
    const hormetic = (id: string) =>
      makeIngredient({
        id,
        doseResponse: 'hormetic',
        potencyBase: 8,
        hormeticThreshold: 3,
        compoundClasses: [{ class: 'alkaloid', concentration: 0.9 }],
      });
    const { result, context } = run([hormetic('a'), hormetic('b')], {
      solvent: makeFictionalSolvent(),
    });
    expect(result.ok).toBe(true);
    // Fictional flip severity is 0.7: -(8 * 0.7) = -5.6.
    expect(wd(context.ingredients[0]!).effectivePotency).toBeCloseTo(-5.6);
  });
});

describe('fictional signatures', () => {
  it('Ichor raises the hormetic threshold so a mid load stays beneficial', () => {
    const ichor = makeFictionalSolvent({
      id: 'ichor',
      slug: 'ichor',
      signatureTransformation: { type: 'additive-elevation', summary: 'you become more' },
    });
    // Load = 1*1*8*0.75 = 6.0. Grounded threshold 5 would flip; Ichor makes it 7.
    const { context } = run(
      [
        makeIngredient({
          id: 'a',
          doseResponse: 'hormetic',
          potencyBase: 8,
          compoundClasses: [{ class: 'alkaloid', concentration: 0.75 }],
        }),
      ],
      { solvent: ichor },
    );
    expect(wd(context.ingredients[0]!).doseState).toBe('hormetic_beneficial');
    expect(wd(context.ingredients[0]!).effectivePotency).toBe(8);
  });

  it('Prism refraction is deterministic and yields a valid response type', () => {
    const prism = makeFictionalSolvent({
      id: 'prism',
      slug: 'prism',
      signatureTransformation: { type: 'refractive-alteration', summary: 'you become other' },
    });
    const ingredient = () => [makeIngredient({ id: 'a', doseResponse: 'linear' })];
    const first = run(ingredient(), { solvent: prism });
    const second = run(ingredient(), { solvent: prism });
    const r1 = first.context.ingredients[0]!.refractedResponse;
    expect(r1).toBe(second.context.ingredients[0]!.refractedResponse);
    expect(['linear', 'hormetic', 'threshold', 'ceiling']).toContain(r1);
  });

  it('Lacuna rewards a subtractive ingredient and penalizes a building one (threshold)', () => {
    const lacuna = makeFictionalSolvent(); // slug 'lacuna'
    // Load 1*1*5*0.5 = 2.5. Default activation 3: inactive under a grounded solvent.
    const thresholdIng = (id: string, tag: string) =>
      makeIngredient({
        id,
        doseResponse: 'threshold',
        potencyBase: 5,
        synergyTags: [tag],
        compoundClasses: [{ class: 'alkaloid', concentration: 0.5 }],
      });

    // Subtractive (chelator): activation 3 - 1 = 2, so 2.5 activates.
    const sub = run([thresholdIng('a', 'chelator')], { solvent: lacuna });
    expect(wd(sub.context.ingredients[0]!).doseState).toBe('threshold_active');

    // Building (warming): activation 3 + 1.5 = 4.5, so 2.5 stays inactive.
    const build2 = run([thresholdIng('a', 'warming')], { solvent: lacuna });
    expect(wd(build2.context.ingredients[0]!).doseState).toBe('threshold_inactive');
  });
});
