// Property-based invariants for DoseCurveRule.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createContext } from '../../src/pipeline/context.js';
import { doseCurveRule } from '../../src/pipeline/rules/dose-curve.js';
import { solventMatchRule } from '../../src/pipeline/rules/solvent-match.js';
import { makeFictionalSolvent, makeIngredient, makeOpenSolvent } from '../support/fixtures.js';

const potencyBase = () => fc.integer({ min: 1, max: 10 });
const concentration = () => fc.double({ min: 0, max: 1, noNaN: true });

describe('cumulative load', () => {
  it('is never negative', () => {
    fc.assert(
      fc.property(
        potencyBase(),
        concentration(),
        potencyBase(),
        concentration(),
        (pa, ca, pb, cb) => {
          const context = createContext({
            ingredients: [
              makeIngredient({
                id: 'a',
                potencyBase: pa,
                compoundClasses: [{ class: 'alkaloid', concentration: ca }],
              }),
              makeIngredient({
                id: 'b',
                potencyBase: pb,
                compoundClasses: [{ class: 'alkaloid', concentration: cb }],
              }),
            ],
            solvent: makeOpenSolvent(),
            outcome: 'concentrate',
          });
          solventMatchRule.apply(context);
          doseCurveRule.apply(context);
          for (const load of context.cumulativeLoads.values()) {
            expect(load).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });
});

describe('linear potency', () => {
  it('is non-negative and never exceeds base potency', () => {
    fc.assert(
      fc.property(potencyBase(), (base) => {
        const context = createContext({
          ingredients: [makeIngredient({ id: 'a', doseResponse: 'linear', potencyBase: base })],
          solvent: makeOpenSolvent(),
          outcome: 'concentrate',
        });
        solventMatchRule.apply(context);
        doseCurveRule.apply(context);
        const p = context.ingredients[0]!.weightData.effectivePotency ?? 0;
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(base);
      }),
    );
  });
});

describe('fictional bypass', () => {
  it('a fictional solvent never fails, even when every ingredient flips harmful', () => {
    fc.assert(
      fc.property(potencyBase(), (base) => {
        const hormetic = (id: string) =>
          makeIngredient({
            id,
            doseResponse: 'hormetic',
            potencyBase: base,
            hormeticThreshold: 0,
            compoundClasses: [{ class: 'alkaloid', concentration: 1 }],
          });
        const context = createContext({
          ingredients: [hormetic('a'), hormetic('b')],
          solvent: makeFictionalSolvent(),
          outcome: 'potion',
        });
        solventMatchRule.apply(context);
        const result = doseCurveRule.apply(context);
        expect(result.ok).toBe(true);
      }),
    );
  });
});
