// Property-based invariants for AntagonismRule.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

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
} from '../support/fixtures.js';

const weight = () => fc.double({ min: 0, max: 1, noNaN: true });
const severity = () => fc.double({ min: 0, max: 1, noNaN: true });

function opposeData(sev: number) {
  return makePipelineData({
    tags: makeOppositeTags('oxidizer', 'reducer'),
    pairs: [
      makeSynergyPair({
        tagA: 'oxidizer',
        tagB: 'reducer',
        type: 'always_antagonistic',
        severity: sev,
      }),
    ],
  });
}

describe('weight bounds', () => {
  it('antagonism never increases a weight and never drives it negative', () => {
    fc.assert(
      fc.property(weight(), weight(), severity(), (aw, bw, sev) => {
        const context = createContext({
          ingredients: [
            makeIngredient({ id: 'a', synergyTags: ['oxidizer'], aestheticWeight: aw }),
            makeIngredient({ id: 'b', synergyTags: ['reducer'], aestheticWeight: bw }),
          ],
          solvent: makeOpenSolvent(),
          outcome: 'concentrate',
        });
        solventMatchRule.apply(context);
        // Post solvent-match, a polar ingredient in a polar solvent extracts at 1.0.
        makeAntagonismRule(opposeData(sev)).apply(context);
        for (const ci of context.ingredients) {
          const w = ci.weightData.chemicalExtractionWeight;
          expect(w).toBeGreaterThanOrEqual(0);
          expect(w).toBeLessThanOrEqual(1);
        }
      }),
    );
  });
});

describe('bypass', () => {
  it('a fictional solvent never fails with total_antagonism, however strong the cancellation', () => {
    fc.assert(
      fc.property(severity(), (sev) => {
        const context = createContext({
          ingredients: [
            makeIngredient({ id: 'a', synergyTags: ['oxidizer'], aestheticWeight: 1 }),
            makeIngredient({ id: 'b', synergyTags: ['reducer'], aestheticWeight: 1 }),
          ],
          solvent: makeFictionalSolvent(),
          outcome: 'potion',
        });
        solventMatchRule.apply(context);
        const result = makeAntagonismRule(opposeData(sev)).apply(context);
        expect(result.ok).toBe(true);
      }),
    );
  });
});
