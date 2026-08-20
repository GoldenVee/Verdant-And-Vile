// Property-based invariants for SensoryRule.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { BLEND_STATES, LUMINOSITIES, SOLUBILITIES } from '../../src/domain/enums.js';
import type { Luminosity, Solubility } from '../../src/domain/enums.js';
import type { Ingredient, Solvent } from '../../src/domain/types.js';
import { createContext } from '../../src/pipeline/context.js';
import { sensoryRule } from '../../src/pipeline/rules/sensory.js';
import { solventMatchRule } from '../../src/pipeline/rules/solvent-match.js';
import { combinationPh } from '../../src/sensory/index.js';
import { makeFictionalSolvent, makeIngredient, makeOpenSolvent } from '../support/fixtures.js';

const HEX = /^#[0-9A-F]{6}$/;

const hex = () =>
  fc
    .integer({ min: 0, max: 0xffffff })
    .map((n) => `#${n.toString(16).padStart(6, '0').toUpperCase()}`);
const solubility = () => fc.constantFrom<Solubility>(...SOLUBILITIES);
const luminosity = () => fc.constantFrom<Luminosity>(...LUMINOSITIES);
const weight = () => fc.double({ min: 0.1, max: 1, noNaN: true });
const concentration = () => fc.double({ min: 0, max: 1, noNaN: true });

const ingredient = () =>
  fc
    .record({
      color: hex(),
      sol: solubility(),
      lum: luminosity(),
      aw: weight(),
      ph: fc.integer({ min: -3, max: 3 }),
      tannin: concentration(),
      oxide: concentration(),
      flavonoid: concentration(),
    })
    .map((r) =>
      makeIngredient({
        colorBase: r.color,
        solubility: r.sol,
        luminosity: r.lum,
        aestheticWeight: r.aw,
        phContribution: r.ph,
        compoundClasses: [
          { class: 'tannin', concentration: r.tannin },
          { class: 'oxide', concentration: r.oxide },
          { class: 'flavonoid', concentration: r.flavonoid },
        ],
      }),
    );

// Ingredient ids must be distinct or the master seed collapses; assign them at build time.
const combination = () =>
  fc
    .array(ingredient(), { minLength: 1, maxLength: 4 })
    .map((list) => list.map((ing, i) => ({ ...ing, id: `ing-${i}`, slug: `ing-${i}` })));

// Returns the populated context, or null when the combination cannot be extracted at all.
function run(ingredients: Ingredient[], solvent: Solvent) {
  const context = createContext({ ingredients, solvent, outcome: 'concentrate' });
  if (!solventMatchRule.apply(context).ok) return null;
  sensoryRule.apply(context);
  return context;
}

describe('output shape', () => {
  it('always produces a valid hex base colour', () => {
    fc.assert(
      fc.property(combination(), (ingredients) => {
        const context = run(ingredients, makeOpenSolvent());
        if (context === null) return;
        expect(context.sensoryOutput!.colorBase).toMatch(HEX);
      }),
    );
  });

  it('produces a secondary that is null or valid hex, never malformed', () => {
    fc.assert(
      fc.property(combination(), (ingredients) => {
        const context = run(ingredients, makeOpenSolvent());
        if (context === null) return;
        const secondary = context.sensoryOutput!.colorSecondary;
        if (secondary !== null) expect(secondary).toMatch(HEX);
      }),
    );
  });

  it('always reports a known blend state and luminosity', () => {
    fc.assert(
      fc.property(combination(), (ingredients) => {
        const context = run(ingredients, makeOpenSolvent());
        if (context === null) return;
        expect(BLEND_STATES).toContain(context.sensoryOutput!.blendState);
        expect(LUMINOSITIES).toContain(context.sensoryOutput!.luminosity);
      }),
    );
  });
});

describe('determinism', () => {
  it('produces identical output across repeated runs', () => {
    fc.assert(
      fc.property(combination(), (ingredients) => {
        const first = run(ingredients, makeOpenSolvent());
        const second = run(ingredients, makeOpenSolvent());
        if (first === null || second === null) return;
        expect(first.sensoryOutput).toEqual(second.sensoryOutput);
      }),
    );
  });

  it('does not depend on ingredient order', () => {
    fc.assert(
      fc.property(combination(), (ingredients) => {
        const forward = run(ingredients, makeOpenSolvent());
        const reversed = run([...ingredients].reverse(), makeOpenSolvent());
        if (forward === null || reversed === null) return;
        expect(reversed.sensoryOutput!.colorBase).toBe(forward.sensoryOutput!.colorBase);
        expect(reversed.sensoryOutput!.blendState).toBe(forward.sensoryOutput!.blendState);
        expect(reversed.sensoryOutput!.luminosity).toBe(forward.sensoryOutput!.luminosity);
      }),
    );
  });
});

describe('combination pH', () => {
  it('stays within the 0 to 14 range whenever it is defined', () => {
    fc.assert(
      fc.property(
        combination(),
        fc.double({ min: 0, max: 14, noNaN: true }),
        (ingredients, base) => {
          const context = run(ingredients, makeOpenSolvent({ basePh: base }));
          if (context === null) return;
          const ph = combinationPh(context.ingredients, context.solvent);
          expect(ph).not.toBeNull();
          expect(ph!).toBeGreaterThanOrEqual(0);
          expect(ph!).toBeLessThanOrEqual(14);
        },
      ),
    );
  });

  it('is null exactly when the solvent has none', () => {
    fc.assert(
      fc.property(combination(), (ingredients) => {
        const context = run(ingredients, makeOpenSolvent({ basePh: null }));
        if (context === null) return;
        expect(combinationPh(context.ingredients, context.solvent)).toBeNull();
      }),
    );
  });

  it('leaves colour untouched by flavonoid load when pH is null', () => {
    fc.assert(
      fc.property(combination(), (ingredients) => {
        const solvent = makeOpenSolvent({ basePh: null });
        const stripped = ingredients.map((ing) => ({
          ...ing,
          compoundClasses: ing.compoundClasses.filter((c) => c.class !== 'flavonoid'),
        }));
        const withFlavonoid = run(ingredients, solvent);
        const without = run(stripped, solvent);
        if (withFlavonoid === null || without === null) return;
        expect(without.sensoryOutput!.colorBase).toBe(withFlavonoid.sensoryOutput!.colorBase);
      }),
    );
  });
});

describe('fictional solvents', () => {
  it('always homogenize, because they extract everything at full weight', () => {
    fc.assert(
      fc.property(combination(), (ingredients) => {
        const context = run(ingredients, makeFictionalSolvent());
        if (context === null) return;
        expect(context.sensoryOutput!.blendState).toBe('homogeneous');
      }),
    );
  });
});
