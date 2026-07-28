// Property-based invariants for SynergyRule (pass 1).

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { CompoundRef } from '../../src/domain/types.js';
import { createContext } from '../../src/pipeline/context.js';
import { solventMatchRule } from '../../src/pipeline/rules/solvent-match.js';
import { makeSynergyRule } from '../../src/pipeline/rules/synergy.js';
import { makeIngredient, makeOpenSolvent, makePipelineData } from '../support/fixtures.js';

const CLASS_POOL = ['alkaloid', 'glycoside', 'tannin', 'resin', 'lipid'];
const weight = () => fc.double({ min: 0, max: 1, noNaN: true });
const sharedCount = () => fc.integer({ min: 0, max: 5 });

function compounds(n: number): CompoundRef[] {
  return CLASS_POOL.slice(0, n).map((c) => ({ class: c, concentration: 0.5 }));
}

describe('potency bounds', () => {
  it('synergy never lowers a multiplier below 1.0 and never exceeds the grounded cap 2.5', () => {
    fc.assert(
      fc.property(weight(), weight(), sharedCount(), (aw, bw, n) => {
        const shared = compounds(n);
        const context = createContext({
          ingredients: [
            makeIngredient({
              id: 'a',
              relatedFamily: 'fam',
              aestheticWeight: aw,
              compoundClasses: shared,
            }),
            makeIngredient({
              id: 'b',
              relatedFamily: 'fam',
              aestheticWeight: bw,
              compoundClasses: shared,
            }),
          ],
          solvent: makeOpenSolvent(),
          outcome: 'concentrate',
        });
        solventMatchRule.apply(context);
        makeSynergyRule(makePipelineData()).apply(context);
        for (const ci of context.ingredients) {
          const m = ci.weightData.potencyMultiplier;
          expect(m).toBeGreaterThanOrEqual(1.0);
          expect(m).toBeLessThanOrEqual(2.5);
        }
      }),
    );
  });
});
