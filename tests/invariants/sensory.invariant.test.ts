// Property-based invariants for SensoryRule.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  AROMA_POSITIONS,
  BLEND_STATES,
  LUMINOSITIES,
  SOLUBILITIES,
  MOTION_TENDENCIES,
  TASTE_KEYS,
  TEMPERATURE_FEELS,
} from '../../src/domain/enums.js';
import type { Luminosity, Solubility, TemperatureFeel } from '../../src/domain/enums.js';
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
const temperature = () => fc.constantFrom<TemperatureFeel>(...TEMPERATURE_FEELS);
const tags = () => fc.subarray(['warming', 'cooling', 'stabilizer'], { maxLength: 2 });
const tasteValue = () => fc.double({ min: 0, max: 1, noNaN: true });
const NOTES = ['citrus', 'mint', 'earth', 'wood', 'mineral', 'musk'];
const aromaNotes = () =>
  fc.array(
    fc.record({ note: fc.constantFrom(...NOTES), position: fc.constantFrom(...AROMA_POSITIONS) }),
    { maxLength: 3 },
  );

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
      temp: temperature(),
      tagList: tags(),
      sound: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
      aroma: aromaNotes(),
      taste: fc.record(Object.fromEntries(TASTE_KEYS.map((k) => [k, tasteValue()]))),
    })
    .map((r) =>
      makeIngredient({
        colorBase: r.color,
        solubility: r.sol,
        luminosity: r.lum,
        aestheticWeight: r.aw,
        phContribution: r.ph,
        temperatureFeel: r.temp,
        synergyTags: r.tagList,
        sound: r.sound,
        tasteProfile: r.taste as Ingredient['tasteProfile'],
        aromaNotes: r.aroma,
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

describe('taste', () => {
  it('reports all eight dimensions, every one within range', () => {
    fc.assert(
      fc.property(combination(), (ingredients) => {
        const context = run(ingredients, makeOpenSolvent());
        if (context === null) return;
        const taste = context.sensoryOutput!.tasteProfile!;
        for (const key of TASTE_KEYS) {
          expect(taste[key]).toBeGreaterThanOrEqual(0);
          expect(taste[key]).toBeLessThanOrEqual(1);
        }
      }),
    );
  });

  it('does not depend on ingredient order', () => {
    fc.assert(
      fc.property(combination(), (ingredients) => {
        const forward = run(ingredients, makeOpenSolvent());
        const reversed = run([...ingredients].reverse(), makeOpenSolvent());
        if (forward === null || reversed === null) return;
        for (const key of TASTE_KEYS) {
          expect(reversed.sensoryOutput!.tasteProfile![key]).toBeCloseTo(
            forward.sensoryOutput!.tasteProfile![key],
          );
        }
      }),
    );
  });
});

describe('temperature and sound', () => {
  it('always reports a known temperature', () => {
    fc.assert(
      fc.property(combination(), (ingredients) => {
        const context = run(ingredients, makeOpenSolvent());
        if (context === null) return;
        expect(TEMPERATURE_FEELS).toContain(context.sensoryOutput!.temperatureFeel);
      }),
    );
  });

  it('only ever reports a sound some ingredient actually carries', () => {
    fc.assert(
      fc.property(combination(), (ingredients) => {
        const context = run(ingredients, makeOpenSolvent());
        if (context === null) return;
        const sound = context.sensoryOutput!.sound;
        if (sound === null) return;
        expect(ingredients.map((i) => i.sound)).toContain(sound);
      }),
    );
  });

  it('resolves temperature and sound independently of ingredient order', () => {
    fc.assert(
      fc.property(combination(), (ingredients) => {
        const forward = run(ingredients, makeOpenSolvent());
        const reversed = run([...ingredients].reverse(), makeOpenSolvent());
        if (forward === null || reversed === null) return;
        expect(reversed.sensoryOutput!.temperatureFeel).toBe(
          forward.sensoryOutput!.temperatureFeel,
        );
        expect(reversed.sensoryOutput!.sound).toBe(forward.sensoryOutput!.sound);
      }),
    );
  });
});

describe('insoluble ingredients cannot weaken a preparation', () => {
  // Extraction weighting means an insoluble ingredient contributes 0 to both the numerator
  // and the denominator of the taste average, so it claims no share of the character. This
  // is structural rather than a special case: nothing in the code checks for stones.
  const inert = (id: string) =>
    makeIngredient({
      id,
      slug: id,
      solubility: 'insoluble',
      tasteProfile: {
        sweet: 0,
        bitter: 0,
        sour: 0,
        salty: 0,
        umami: 0,
        astringent: 0,
        metallic: 0,
        bright: 0,
      },
    });

  it('adding a tasteless insoluble never changes the taste profile', () => {
    fc.assert(
      fc.property(combination(), (ingredients) => {
        const solvent = makeOpenSolvent();
        const without = run(ingredients, solvent);
        const with_ = run([...ingredients, inert('quartz')], solvent);
        if (without === null || with_ === null) return;
        for (const key of TASTE_KEYS) {
          expect(with_.sensoryOutput!.tasteProfile![key]).toBeCloseTo(
            without.sensoryOutput!.tasteProfile![key],
          );
        }
      }),
    );
  });

  it('holds no matter how many are added', () => {
    fc.assert(
      fc.property(combination(), fc.integer({ min: 1, max: 3 }), (ingredients, count) => {
        const solvent = makeOpenSolvent();
        const stones = Array.from({ length: count }, (_, i) => inert(`quartz-${i}`));
        const without = run(ingredients, solvent);
        const with_ = run([...ingredients, ...stones], solvent);
        if (without === null || with_ === null) return;
        for (const key of TASTE_KEYS) {
          expect(with_.sensoryOutput!.tasteProfile![key]).toBeCloseTo(
            without.sensoryOutput!.tasteProfile![key],
          );
        }
      }),
    );
  });

  it('still lets them colour the mix, since presence and extraction differ', () => {
    // The same ingredient that cannot touch taste must still be visible: you see what is
    // present, you taste what dissolved. An insoluble ingredient pushes extraction spread to
    // its maximum, so it surfaces as a separated second phase rather than tinting the first.
    const solvent = makeOpenSolvent();
    const soluble = () => makeIngredient({ id: 'a', slug: 'a', colorBase: '#FFE066' });
    const without = run([soluble()], solvent);
    const with_ = run([soluble(), { ...inert('charcoal'), colorBase: '#1A1A1A' }], solvent);

    expect(without!.sensoryOutput!.blendState).toBe('homogeneous');
    expect(without!.sensoryOutput!.colorSecondary).toBeNull();

    expect(with_!.sensoryOutput!.blendState).toBe('separated');
    expect(with_!.sensoryOutput!.colorSecondary).not.toBeNull();
  });
});

describe('aroma', () => {
  it('never repeats a note within a position and respects the cap', () => {
    fc.assert(
      fc.property(combination(), (ingredients) => {
        const context = run(ingredients, makeOpenSolvent());
        if (context === null) return;
        const aroma = context.sensoryOutput!.aromaProfile!;
        for (const position of AROMA_POSITIONS) {
          const notes = aroma[position];
          expect(new Set(notes).size).toBe(notes.length);
          expect(notes.length).toBeLessThanOrEqual(4);
        }
      }),
    );
  });

  it('only ever reports notes some participant carries', () => {
    fc.assert(
      fc.property(combination(), (ingredients) => {
        const solvent = makeOpenSolvent();
        const context = run(ingredients, solvent);
        if (context === null) return;
        const offered = new Set([
          ...ingredients.flatMap((i) => i.aromaNotes.map((a) => a.note)),
          ...solvent.aromaNotes.map((a) => a.note),
        ]);
        const aroma = context.sensoryOutput!.aromaProfile!;
        for (const position of AROMA_POSITIONS) {
          for (const note of aroma[position]) expect(offered).toContain(note);
        }
      }),
    );
  });

  it('does not depend on ingredient order', () => {
    fc.assert(
      fc.property(combination(), (ingredients) => {
        const forward = run(ingredients, makeOpenSolvent());
        const reversed = run([...ingredients].reverse(), makeOpenSolvent());
        if (forward === null || reversed === null) return;
        expect(reversed.sensoryOutput!.aromaProfile).toEqual(forward.sensoryOutput!.aromaProfile);
      }),
    );
  });
});

describe('motion', () => {
  it('always reports a known tendency', () => {
    fc.assert(
      fc.property(combination(), (ingredients) => {
        const context = run(ingredients, makeOpenSolvent());
        if (context === null) return;
        expect(MOTION_TENDENCIES).toContain(context.sensoryOutput!.motionTendency);
      }),
    );
  });

  it('does not depend on ingredient order', () => {
    fc.assert(
      fc.property(combination(), (ingredients) => {
        const forward = run(ingredients, makeOpenSolvent());
        const reversed = run([...ingredients].reverse(), makeOpenSolvent());
        if (forward === null || reversed === null) return;
        expect(reversed.sensoryOutput!.motionTendency).toBe(forward.sensoryOutput!.motionTendency);
      }),
    );
  });
});
