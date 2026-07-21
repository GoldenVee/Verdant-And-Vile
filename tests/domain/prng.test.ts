// Determinism guarantees for the seeded PRNG (ADR-005): same inputs produce the same
// stream, ingredient order does not matter, distinct rules get distinct streams, and
// deriving a rule's stream never leaks state from a previously derived one.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { combinationSeed, prngFor } from '../../src/domain/prng.js';

function sequence(seed: string, rule: string, n: number): number[] {
  const prng = prngFor(seed, rule);
  return Array.from({ length: n }, () => prng.next());
}

describe('combinationSeed', () => {
  it('is independent of ingredient order', () => {
    const a = combinationSeed(['foxglove', 'valerian', 'belladonna'], 'water', 'potion');
    const b = combinationSeed(['belladonna', 'foxglove', 'valerian'], 'water', 'potion');
    expect(a).toBe(b);
  });

  it('varies with solvent and outcome', () => {
    const base = combinationSeed(['foxglove'], 'water', 'potion');
    expect(combinationSeed(['foxglove'], 'spirits', 'potion')).not.toBe(base);
    expect(combinationSeed(['foxglove'], 'water', 'reduction')).not.toBe(base);
  });
});

describe('prngFor', () => {
  it('is deterministic for the same seed and rule', () => {
    const seed = combinationSeed(['foxglove', 'valerian'], 'water', 'potion');
    expect(sequence(seed, 'stability-rule', 5)).toEqual(sequence(seed, 'stability-rule', 5));
  });

  it('gives independent streams to different rules', () => {
    const seed = combinationSeed(['foxglove', 'valerian'], 'water', 'potion');
    expect(sequence(seed, 'stability-rule', 5)).not.toEqual(sequence(seed, 'antagonism-rule', 5));
  });

  it('does not leak state between derived streams (A, then B, then A again)', () => {
    const seed = combinationSeed(['foxglove', 'valerian'], 'water', 'potion');
    const firstA = sequence(seed, 'rule-a', 4);
    sequence(seed, 'rule-b', 4); // draw from B in between
    const secondA = sequence(seed, 'rule-a', 4);
    expect(secondA).toEqual(firstA);
  });
});

describe('prng helpers stay in range', () => {
  it('next() is always in [0, 1)', () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const prng = prngFor(seed, 'range-check');
        for (let i = 0; i < 20; i++) {
          const v = prng.next();
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
        }
      }),
    );
  });

  it('int(min, max) stays within inclusive bounds', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: -50, max: 0 }),
        fc.integer({ min: 1, max: 50 }),
        (seed, min, max) => {
          const prng = prngFor(seed, 'int-check');
          for (let i = 0; i < 20; i++) {
            const v = prng.int(min, max);
            expect(v).toBeGreaterThanOrEqual(min);
            expect(v).toBeLessThanOrEqual(max);
            expect(Number.isInteger(v)).toBe(true);
          }
        },
      ),
    );
  });
});
