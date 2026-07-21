// Deterministic seeded PRNG (ADR-005). Never use Math.random() anywhere in the
// pipeline or domain code.
//
// The master seed is derived from the combination inputs, so the same combination
// always resolves identically. Each rule that needs randomness derives its own
// independent sub-stream via prngFor(ruleName), which makes cross-rule state
// pollution structurally impossible.

// mulberry32: a fast 32-bit generator. Given a 32-bit integer seed, returns a
// function producing floats in [0, 1).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// xmur3: string hash used to turn a seed string into a 32-bit integer seed for
// mulberry32. Standard pairing for seeding.
function xmur3(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

// A seeded stream with small convenience helpers. Rules draw from this rather than
// calling the raw generator, so intent (a uniform float in a range, an int) is explicit.
export interface Prng {
  // Raw float in [0, 1).
  next(): number;
  // Uniform float in [min, max).
  float(min: number, max: number): number;
  // Uniform integer in [min, max] inclusive.
  int(min: number, max: number): number;
  // Uniform element of a non-empty array.
  pick<T>(items: readonly T[]): T;
}

function makePrng(seedString: string): Prng {
  const gen = mulberry32(xmur3(seedString));
  return {
    next: gen,
    float: (min, max) => min + gen() * (max - min),
    int: (min, max) => min + Math.floor(gen() * (max - min + 1)),
    pick: (items) => {
      if (items.length === 0) throw new Error('prng.pick: cannot pick from an empty array');
      const index = Math.floor(gen() * items.length);
      return items[index] as (typeof items)[number];
    },
  };
}

// Master seed string for a combination. Sorted ingredient ids make the seed
// order-independent in the ingredient set, per the design reference.
export function combinationSeed(
  ingredientIds: readonly string[],
  solventId: string,
  outcome: string,
): string {
  const sorted = [...ingredientIds].sort();
  return `${sorted.join('|')}|${solventId}|${outcome}`;
}

// Derive an independent sub-PRNG for a named rule from the master seed string.
// Same combination + same rule name always yields the same stream; different rules
// get disjoint streams.
export function prngFor(masterSeed: string, ruleName: string): Prng {
  return makePrng(`${masterSeed}|${ruleName}`);
}
