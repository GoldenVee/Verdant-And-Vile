// Known-case tests for SolventMatchRule: hand-authored combinations with expected
// weights and failures, locking in specific mechanical decisions.

import { describe, expect, it } from 'vitest';

import { createContext } from '../../src/pipeline/context.js';
import { solventMatchRule } from '../../src/pipeline/rules/solvent-match.js';
import type { Ingredient, Solvent } from '../../src/domain/types.js';
import type { Outcome } from '../../src/domain/enums.js';
import {
  makeFictionalSolvent,
  makeIngredient,
  makeOpenSolvent,
  makeSolvent,
} from '../support/fixtures.js';

// Runs the rule against a fresh context and returns both the Result and the (mutated)
// context, since weights are written in place before any short-circuit.
function run(ingredients: Ingredient[], solvent: Solvent, outcome: Outcome) {
  const context = createContext({ ingredients, solvent, outcome });
  const result = solventMatchRule.apply(context);
  return { result, context };
}

describe('failure checks', () => {
  it('fails with no_ingredients on an empty combination', () => {
    const { result } = run([], makeSolvent(), 'potion');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('no_ingredients');
  });

  it('fails with outcome_incompatible for a grounded solvent that cannot make the outcome', () => {
    // Water does not make balm.
    const { result } = run([makeIngredient()], makeSolvent(), 'balm');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('outcome_incompatible');
  });

  it('fails with extraction_impossible when nothing dissolves', () => {
    // Insoluble ingredient in polar water extracts at 0.0.
    const { result } = run([makeIngredient({ solubility: 'insoluble' })], makeSolvent(), 'potion');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('extraction_impossible');
  });
});

describe('adjacency matrix weights', () => {
  it('gives a perfect match weight 1.0 (polar in polar)', () => {
    const { result, context } = run(
      [makeIngredient({ solubility: 'polar' })],
      makeSolvent(),
      'potion',
    );
    expect(result.ok).toBe(true);
    expect(context.ingredients[0]!.weightData.chemicalExtractionWeight).toBe(1.0);
  });

  it('gives a poor match weight 0.3 and a partial-extraction warning (polar in nonpolar oil)', () => {
    const oil = makeOpenSolvent({ id: 'oil', slug: 'oil', name: 'Oil', polarity: 'nonpolar' });
    const { context } = run([makeIngredient({ solubility: 'polar' })], oil, 'concentrate');
    const wd = context.ingredients[0]!.weightData;
    expect(wd.chemicalExtractionWeight).toBeCloseTo(0.3);
    expect(wd.warnings).toContain('partial extraction only');
  });

  it('gives an adjacent match weight 0.7 (acid-soluble in polar)', () => {
    const { context } = run(
      [makeIngredient({ solubility: 'acid-soluble' })],
      makeSolvent(),
      'potion',
    );
    expect(context.ingredients[0]!.weightData.chemicalExtractionWeight).toBeCloseTo(0.7);
  });
});

describe('bypasses', () => {
  it('gives all ingredients weight 1.0 under a fictional solvent, ignoring polarity and outcome gates', () => {
    const { result, context } = run(
      [makeIngredient({ solubility: 'insoluble' })],
      makeFictionalSolvent(),
      'balm',
    );
    expect(result.ok).toBe(true);
    expect(context.ingredients[0]!.weightData.chemicalExtractionWeight).toBe(1.0);
    expect(context.solventValidated).toBe(true);
  });

  it('gives all ingredients weight 1.0 for a sachet, with no polarity check', () => {
    const { result, context } = run(
      [makeIngredient({ solubility: 'insoluble' })],
      makeSolvent(),
      'sachet',
    );
    expect(result.ok).toBe(true);
    expect(context.ingredients[0]!.weightData.chemicalExtractionWeight).toBe(1.0);
  });
});

describe('category affinity and resistance modifiers', () => {
  it('adds +0.30 for strong affinity (botanical in water)', () => {
    const { context } = run([makeIngredient({ category: 'botanical' })], makeSolvent(), 'potion');
    expect(context.ingredients[0]!.weightData.extractionYieldModifier).toBeCloseTo(0.3);
  });

  it('adds +0.15 for weak affinity (mineral in water)', () => {
    // Mineral is acid-soluble by nature; keep it soluble enough to pass and isolate the modifier.
    const { context } = run(
      [makeIngredient({ category: 'mineral', solubility: 'acid-soluble' })],
      makeSolvent(),
      'potion',
    );
    expect(context.ingredients[0]!.weightData.extractionYieldModifier).toBeCloseTo(0.15);
  });

  it('subtracts 0.50 and warns for strong resistance (effluvia in water)', () => {
    const { context } = run([makeIngredient({ category: 'effluvia' })], makeSolvent(), 'potion');
    const wd = context.ingredients[0]!.weightData;
    expect(wd.extractionYieldModifier).toBeCloseTo(-0.5);
    expect(wd.warnings).toContain('solvent strongly resists effluvia category');
  });

  it('subtracts 0.25 and warns for weak resistance (cosmic in water)', () => {
    const { context } = run([makeIngredient({ category: 'cosmic' })], makeSolvent(), 'potion');
    const wd = context.ingredients[0]!.weightData;
    expect(wd.extractionYieldModifier).toBeCloseTo(-0.25);
    expect(wd.warnings).toContain('solvent resists cosmic category');
  });

  it('leaves the modifier at 0 for a neutral category (alchemical in water)', () => {
    const { context } = run([makeIngredient({ category: 'alchemical' })], makeSolvent(), 'potion');
    expect(context.ingredients[0]!.weightData.extractionYieldModifier).toBe(0);
  });
});
