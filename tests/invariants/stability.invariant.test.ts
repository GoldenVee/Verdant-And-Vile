// Property-based invariants for StabilityRule.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { CATEGORIES, OUTCOMES } from '../../src/domain/enums.js';
import type { Category, Outcome } from '../../src/domain/enums.js';
import { createContext } from '../../src/pipeline/context.js';
import { solventMatchRule } from '../../src/pipeline/rules/solvent-match.js';
import { stabilityRule } from '../../src/pipeline/rules/stability.js';
import { makeFictionalSolvent, makeIngredient, makeOpenSolvent } from '../support/fixtures.js';

const stabilityBase = () => fc.integer({ min: 1, max: 10 });
const aesthetic = () => fc.double({ min: 0.01, max: 1, noNaN: true });
const category = () => fc.constantFrom<Category>(...CATEGORIES);
const outcome = () => fc.constantFrom<Outcome>(...OUTCOMES);

describe('stability value', () => {
  it('is never negative for any grounded combination', () => {
    fc.assert(
      fc.property(stabilityBase(), aesthetic(), category(), outcome(), (sb, aw, cat, out) => {
        const context = createContext({
          ingredients: [
            makeIngredient({
              id: 'a',
              stabilityBase: sb,
              aestheticWeight: aw,
              category: cat,
              solubility: 'universal',
            }),
          ],
          solvent: makeOpenSolvent({ stabilityModifier: 1.0 }),
          outcome: out,
        });
        solventMatchRule.apply(context);
        const result = stabilityRule.apply(context);
        if (result.ok) {
          expect(context.stability!).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });
});

describe('indestructible floor', () => {
  it('guarantees at least 30 days and an indefinite state', () => {
    fc.assert(
      fc.property(stabilityBase(), outcome(), (sb, out) => {
        const context = createContext({
          ingredients: [
            makeIngredient({
              id: 'a',
              stabilityBase: sb,
              aestheticWeight: 1.0,
              traits: ['indestructible'],
            }),
          ],
          solvent: makeOpenSolvent({ stabilityModifier: 0.4 }),
          outcome: out,
        });
        solventMatchRule.apply(context);
        const result = stabilityRule.apply(context);
        expect(result.ok).toBe(true);
        expect(context.stability!).toBeGreaterThanOrEqual(30);
        expect(context.stabilityState).toBe('indefinite');
      }),
    );
  });
});

describe('fictional bypass', () => {
  it('a fictional solvent never fails on insufficient stability', () => {
    fc.assert(
      fc.property(outcome(), (out) => {
        const context = createContext({
          ingredients: [
            makeIngredient({
              id: 'a',
              stabilityBase: 1,
              aestheticWeight: 0.05,
              category: 'effluvia',
            }),
          ],
          solvent: makeFictionalSolvent({ stabilityModifier: 0.4 }),
          outcome: out,
        });
        solventMatchRule.apply(context);
        const result = stabilityRule.apply(context);
        expect(result.ok).toBe(true);
      }),
    );
  });
});
