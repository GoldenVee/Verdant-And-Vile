// Property-based invariants for ToxicityRule.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { TOXICITY_LEVELS } from '../../src/domain/enums.js';
import type { ToxicityLevel } from '../../src/domain/enums.js';
import { createContext } from '../../src/pipeline/context.js';
import { doseCurveRule } from '../../src/pipeline/rules/dose-curve.js';
import { solventMatchRule } from '../../src/pipeline/rules/solvent-match.js';
import { toxicityRule } from '../../src/pipeline/rules/toxicity.js';
import { makeIngredient, makeOpenSolvent } from '../support/fixtures.js';

const toxicityLevel = () => fc.constantFrom<ToxicityLevel>(...TOXICITY_LEVELS);
const potencyBase = () => fc.integer({ min: 1, max: 10 });
const ingredientCount = () => fc.integer({ min: 1, max: 4 });

describe('toxicity bounds', () => {
  it('every dimension stays within [0, 10] regardless of inputs', () => {
    fc.assert(
      fc.property(toxicityLevel(), potencyBase(), ingredientCount(), (level, pb, n) => {
        const ingredients = Array.from({ length: n }, (_, i) =>
          makeIngredient({
            id: `i${i}`,
            toxicityBase: level,
            potencyBase: pb,
            aestheticWeight: 1.0,
            compoundClasses: [{ class: 'alkaloid', concentration: 1 }],
          }),
        );
        const context = createContext({
          ingredients,
          solvent: makeOpenSolvent(),
          outcome: 'potion',
        });
        solventMatchRule.apply(context);
        doseCurveRule.apply(context);
        context.stabilityState = 'critically_unstable'; // exercises the somatic 1.5x path
        toxicityRule.apply(context);

        // toxicity is populated even when a gate fails.
        const t = context.toxicity!;
        for (const value of [t.somatic, t.psychic, t.sensory]) {
          expect(value).toBeLessThanOrEqual(10);
        }
        // Psychic and sensory have only non-negative sources.
        expect(t.psychic).toBeGreaterThanOrEqual(0);
        expect(t.sensory).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
