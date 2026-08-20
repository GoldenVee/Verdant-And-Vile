// SensoryRule: materializes the preparation's perceived qualities. Runs after ToxicityRule
// so every weight it reads is final, and before SignatureTransformRule so the fictional
// solvents have a base sensory output to transform. See docs/sensory.md.
//
// Fully deterministic. The rule introduces no PRNG stream of its own; the only randomness in
// the sensory path is Prism's spectrum, drawn from the existing signature-transform stream.

import { ok } from '../../domain/result.js';
import { computeSensory } from '../../sensory/index.js';
import type { BrewingContext } from '../context.js';
import type { Rule } from '../rule.js';

export const sensoryRule: Rule = {
  name: 'sensory',

  apply(context: BrewingContext) {
    context.sensoryOutput = computeSensory(context.ingredients, context.solvent);
    return ok(context);
  },
};
