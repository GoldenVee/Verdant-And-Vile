// Known-case tests for AntagonismRule across its four patterns, the total-antagonism
// failure, and the fictional/sachet bypass.

import { describe, expect, it } from 'vitest';

import type { Outcome } from '../../src/domain/enums.js';
import type { Ingredient, PipelineData, Solvent } from '../../src/domain/types.js';
import { createContext } from '../../src/pipeline/context.js';
import { makeAntagonismRule } from '../../src/pipeline/rules/antagonism.js';
import { solventMatchRule } from '../../src/pipeline/rules/solvent-match.js';
import {
  makeFictionalSolvent,
  makeIngredient,
  makeOppositeTags,
  makeOpenSolvent,
  makePipelineData,
  makeSynergyPair,
  makeTagDef,
} from '../support/fixtures.js';

// Runs SolventMatchRule (to populate weights) then AntagonismRule, returning both.
function run(
  ingredients: Ingredient[],
  data: PipelineData,
  opts: { solvent?: Solvent; outcome?: Outcome } = {},
) {
  const solvent = opts.solvent ?? makeOpenSolvent();
  const outcome = opts.outcome ?? 'concentrate';
  const context = createContext({ ingredients, solvent, outcome });
  const matched = solventMatchRule.apply(context);
  if (!matched.ok) throw new Error(`solvent match unexpectedly failed: ${matched.error.reason}`);
  const result = makeAntagonismRule(data).apply(context);
  return { result, context };
}

const chem = (ci: { weightData: { chemicalExtractionWeight: number } }) =>
  ci.weightData.chemicalExtractionWeight;

describe('Pattern 1: opposite-tag pairs', () => {
  const oxidizerReducer = makePipelineData({
    tags: makeOppositeTags('oxidizer', 'reducer'),
    pairs: [
      makeSynergyPair({
        tagA: 'oxidizer',
        tagB: 'reducer',
        type: 'always_antagonistic',
        severity: 0.7,
        warningTemplate: '{A} and {B} cancel each other out.',
      }),
    ],
  });

  it('reduces both ingredients mutually', () => {
    // Severity 0.7 at full aesthetic weight leaves each at 1 - 0.7 = 0.3, clear of the
    // 0.20 total-antagonism floor.
    const { result, context } = run(
      [
        makeIngredient({ id: 'a', synergyTags: ['oxidizer'], aestheticWeight: 1.0 }),
        makeIngredient({ id: 'b', synergyTags: ['reducer'], aestheticWeight: 1.0 }),
      ],
      oxidizerReducer,
    );
    expect(result.ok).toBe(true);
    expect(chem(context.ingredients[0]!)).toBeCloseTo(0.3);
    expect(chem(context.ingredients[1]!)).toBeCloseTo(0.3);
    expect(context.warnings.some((w) => w.includes('cancel each other out'))).toBe(true);
  });

  it('fails with total_antagonism when every match drops below the floor', () => {
    const strong = makePipelineData({
      tags: makeOppositeTags('oxidizer', 'reducer'),
      pairs: [
        makeSynergyPair({
          tagA: 'oxidizer',
          tagB: 'reducer',
          type: 'always_antagonistic',
          severity: 0.95,
        }),
      ],
    });
    const { result } = run(
      [
        makeIngredient({ id: 'a', synergyTags: ['oxidizer'], aestheticWeight: 1.0 }),
        makeIngredient({ id: 'b', synergyTags: ['reducer'], aestheticWeight: 1.0 }),
      ],
      strong,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('total_antagonism');
  });

  it('a fictional solvent bypasses the total-antagonism failure', () => {
    const strong = makePipelineData({
      tags: makeOppositeTags('oxidizer', 'reducer'),
      pairs: [
        makeSynergyPair({
          tagA: 'oxidizer',
          tagB: 'reducer',
          type: 'always_antagonistic',
          severity: 0.95,
        }),
      ],
    });
    const { result, context } = run(
      [
        makeIngredient({ id: 'a', synergyTags: ['oxidizer'], aestheticWeight: 1.0 }),
        makeIngredient({ id: 'b', synergyTags: ['reducer'], aestheticWeight: 1.0 }),
      ],
      strong,
      { solvent: makeFictionalSolvent() },
    );
    expect(result.ok).toBe(true);
    expect(chem(context.ingredients[0]!)).toBeLessThan(0.2);
  });
});

describe('Pattern 2: tag-targets-compound', () => {
  it('directionally reduces the ingredient bearing the targeted compound class', () => {
    const data = makePipelineData({
      tags: [makeTagDef({ slug: 'chelator', severity: 0.7, targets: ['alkaloid'] })],
    });
    const { context } = run(
      [
        makeIngredient({ id: 'a', synergyTags: ['chelator'], aestheticWeight: 0.6 }),
        makeIngredient({
          id: 'b',
          compoundClasses: [{ class: 'alkaloid', concentration: 0.8 }],
          aestheticWeight: 1.0,
        }),
      ],
      data,
    );
    // Antagonizer (A) untouched; target (B) reduced by 1 - 0.7 * 0.6 = 0.58.
    expect(chem(context.ingredients[0]!)).toBe(1.0);
    expect(chem(context.ingredients[1]!)).toBeCloseTo(0.58);
  });

  it('amplifies the reduction for a solvent-resisted target (Pattern 4)', () => {
    const data = makePipelineData({
      tags: [makeTagDef({ slug: 'chelator', severity: 0.7, targets: ['alkaloid'] })],
    });
    // Cosmic is weakly resisted by the open (water-based) solvent: modifier -0.25,
    // amplification 1.25, so severity 0.7 becomes 0.875.
    const { context } = run(
      [
        makeIngredient({ id: 'a', synergyTags: ['chelator'], aestheticWeight: 1.0 }),
        makeIngredient({
          id: 'b',
          category: 'cosmic',
          compoundClasses: [{ class: 'alkaloid', concentration: 0.9 }],
          aestheticWeight: 1.0,
        }),
      ],
      data,
    );
    expect(chem(context.ingredients[1]!)).toBeCloseTo(0.125);
  });
});

describe('Pattern 3: trait-driven', () => {
  it('explosive and catalyst react dangerously (bidirectional 0.9)', () => {
    const { context } = run(
      [
        makeIngredient({ id: 'a', traits: ['explosive'], aestheticWeight: 0.5 }),
        makeIngredient({ id: 'b', traits: ['catalyst'], aestheticWeight: 0.5 }),
      ],
      makePipelineData(),
    );
    expect(chem(context.ingredients[0]!)).toBeCloseTo(0.55);
    expect(chem(context.ingredients[1]!)).toBeCloseTo(0.55);
  });

  it('decaying spreads to others directionally, leaving itself intact', () => {
    const { context } = run(
      [
        makeIngredient({ id: 'a', traits: ['decaying'], aestheticWeight: 0.5 }),
        makeIngredient({ id: 'b', aestheticWeight: 1.0 }),
      ],
      makePipelineData(),
    );
    expect(chem(context.ingredients[0]!)).toBe(1.0);
    expect(chem(context.ingredients[1]!)).toBeCloseTo(0.85);
  });

  it('mercurial and shy produce a seeded severity that is deterministic and in range', () => {
    const ingredients = () => [
      makeIngredient({ id: 'a', traits: ['mercurial'], aestheticWeight: 0.5 }),
      makeIngredient({ id: 'b', traits: ['shy'], aestheticWeight: 0.5 }),
    ];
    const first = run(ingredients(), makePipelineData());
    const second = run(ingredients(), makePipelineData());
    const w1 = chem(first.context.ingredients[0]!);
    const w2 = chem(second.context.ingredients[0]!);
    expect(w1).toBe(w2); // deterministic across runs
    // severity in [0.4, 0.7], effective weight 0.5 -> factor in [0.65, 0.8].
    expect(w1).toBeGreaterThanOrEqual(0.65);
    expect(w1).toBeLessThanOrEqual(0.8);
  });
});

describe('scaled pairs (reconciled Pattern 1)', () => {
  const scaled = () =>
    makePipelineData({
      tags: makeOppositeTags('warming', 'cooling'),
      pairs: [
        makeSynergyPair({
          tagA: 'warming',
          tagB: 'cooling',
          type: 'scaled',
          boost: 0.3,
          complementaryCeiling: 0.7,
          balancedCeiling: 1.4,
          strainingCeiling: 2.0,
        }),
      ],
    });

  it('complements at low intensity: no reduction, deferred to SynergyRule', () => {
    const { context } = run(
      [
        makeIngredient({ id: 'a', synergyTags: ['warming'], aestheticWeight: 0.3 }),
        makeIngredient({ id: 'b', synergyTags: ['cooling'], aestheticWeight: 0.3 }),
      ],
      scaled(),
    );
    expect(chem(context.ingredients[0]!)).toBe(1.0);
    expect(chem(context.ingredients[1]!)).toBe(1.0);
    expect(context.deferredComplementaryPairs).toHaveLength(1);
    expect(context.deferredComplementaryPairs[0]!.boost).toBe(0.3);
  });

  it('cancels at high intensity: full mutual reduction, nothing deferred', () => {
    const { context } = run(
      [
        makeIngredient({ id: 'a', synergyTags: ['warming'], aestheticWeight: 1.0 }),
        makeIngredient({ id: 'b', synergyTags: ['cooling'], aestheticWeight: 1.0 }),
      ],
      scaled(),
    );
    expect(chem(context.ingredients[0]!)).toBeCloseTo(0.2);
    expect(context.deferredComplementaryPairs).toHaveLength(0);
  });

  it('weakly strains at middling intensity (severity 0.3)', () => {
    const { context } = run(
      [
        makeIngredient({ id: 'a', synergyTags: ['warming'], aestheticWeight: 0.8 }),
        makeIngredient({ id: 'b', synergyTags: ['cooling'], aestheticWeight: 0.8 }),
      ],
      scaled(),
    );
    // intensity 1.6 -> straining; factor 1 - 0.3 * 0.8 = 0.76.
    expect(chem(context.ingredients[0]!)).toBeCloseTo(0.76);
  });
});
