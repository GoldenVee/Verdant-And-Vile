// Property-based invariants for SolventMatchRule: properties that must hold across all
// generated inputs, not just hand-picked cases.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { CATEGORIES, OUTCOMES, SOLUBILITIES } from '../../src/domain/enums.js';
import type { Category, Outcome, Solubility } from '../../src/domain/enums.js';
import { createContext } from '../../src/pipeline/context.js';
import { solventMatchRule } from '../../src/pipeline/rules/solvent-match.js';
import {
  makeFictionalSolvent,
  makeIngredient,
  makeOpenSolvent,
  makeSolvent,
} from '../support/fixtures.js';

const solubility = () => fc.constantFrom<Solubility>(...SOLUBILITIES);
const category = () => fc.constantFrom<Category>(...CATEGORIES);
const outcome = () => fc.constantFrom<Outcome>(...OUTCOMES);
// The four grounded polarities (anti-solvent belongs only to fictional Lacuna).
const groundedPolarity = () =>
  fc.constantFrom('polar', 'nonpolar', 'acid-soluble', 'universal' as const);

describe('weight bounds', () => {
  it('chemical extraction weight is always within [0, 1]', () => {
    fc.assert(
      fc.property(solubility(), groundedPolarity(), outcome(), (sol, pol, out) => {
        const context = createContext({
          ingredients: [makeIngredient({ solubility: sol })],
          solvent: makeOpenSolvent({ polarity: pol }),
          outcome: out,
        });
        solventMatchRule.apply(context);
        const w = context.ingredients[0]!.weightData.chemicalExtractionWeight;
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('extraction yield modifier is always within [-0.50, 0.30]', () => {
    fc.assert(
      fc.property(category(), (cat) => {
        const context = createContext({
          ingredients: [makeIngredient({ category: cat, solubility: 'polar' })],
          solvent: makeOpenSolvent(),
          outcome: 'potion',
        });
        solventMatchRule.apply(context);
        const m = context.ingredients[0]!.weightData.extractionYieldModifier;
        expect(m).toBeGreaterThanOrEqual(-0.5);
        expect(m).toBeLessThanOrEqual(0.3);
      }),
    );
  });
});

describe('bypass invariants', () => {
  it('a fictional solvent gives every ingredient weight 1.0 and always validates', () => {
    fc.assert(
      fc.property(solubility(), outcome(), (sol, out) => {
        const context = createContext({
          ingredients: [makeIngredient({ solubility: sol })],
          solvent: makeFictionalSolvent(),
          outcome: out,
        });
        const result = solventMatchRule.apply(context);
        expect(result.ok).toBe(true);
        expect(context.ingredients[0]!.weightData.chemicalExtractionWeight).toBe(1.0);
        expect(context.solventValidated).toBe(true);
      }),
    );
  });

  it('a sachet gives every ingredient weight 1.0 regardless of solvent polarity', () => {
    fc.assert(
      fc.property(solubility(), groundedPolarity(), (sol, pol) => {
        const context = createContext({
          ingredients: [makeIngredient({ solubility: sol })],
          solvent: makeSolvent({ polarity: pol }),
          outcome: 'sachet',
        });
        const result = solventMatchRule.apply(context);
        expect(result.ok).toBe(true);
        expect(context.ingredients[0]!.weightData.chemicalExtractionWeight).toBe(1.0);
      }),
    );
  });
});

describe('validation flag', () => {
  it('solventValidated is true exactly when the rule succeeds', () => {
    fc.assert(
      fc.property(solubility(), groundedPolarity(), outcome(), (sol, pol, out) => {
        const context = createContext({
          ingredients: [makeIngredient({ solubility: sol })],
          solvent: makeOpenSolvent({ polarity: pol }),
          outcome: out,
        });
        const result = solventMatchRule.apply(context);
        expect(context.solventValidated).toBe(result.ok);
      }),
    );
  });
});
