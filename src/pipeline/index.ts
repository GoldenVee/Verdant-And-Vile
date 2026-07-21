// Pipeline composition. Runs rules in order, short-circuiting on the first Err. The
// rule list is intentionally empty for now; the seven v1 rules land here one file at a
// time:
//
//   SolventMatchRule -> AntagonismRule -> SynergyRule -> DoseCurveRule
//     -> StabilityRule -> ToxicityRule -> SignatureTransformRule

import { ok, type Result } from '../domain/result.js';
import type { BrewingContext } from './context.js';
import type { Failure, Rule } from './rule.js';

export const RULES: Rule[] = [];

export function runPipeline(
  context: BrewingContext,
  rules: Rule[] = RULES,
): Result<BrewingContext, Failure> {
  let current = context;
  for (const rule of rules) {
    const result = rule.apply(current);
    if (!result.ok) return result;
    current = result.value;
  }
  return ok(current);
}

export type { BrewingContext } from './context.js';
export { createContext } from './context.js';
export type { Failure, Rule } from './rule.js';
