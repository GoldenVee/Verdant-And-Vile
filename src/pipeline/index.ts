// Pipeline composition. `buildRules` is the composition root: it wires each rule with
// the dependencies it needs (rules that need lookup tables are factories closing over
// them; dependency-free rules are plain objects). `runPipeline` stays ignorant of
// dependencies and simply runs rules in order, short-circuiting on the first Err.
//
// Rule order:
//   SolventMatchRule -> AntagonismRule -> SynergyRule -> DoseCurveRule
//     -> StabilityRule -> ToxicityRule -> SignatureTransformRule

import { ok, type Result } from '../domain/result.js';
import type { PipelineData } from '../domain/types.js';
import type { BrewingContext } from './context.js';
import type { Failure, Rule } from './rule.js';
import { makeAntagonismRule } from './rules/antagonism.js';
import { doseCurveRule } from './rules/dose-curve.js';
import { solventMatchRule } from './rules/solvent-match.js';
import { stabilityRule } from './rules/stability.js';
import { makeSynergyRule } from './rules/synergy.js';
import { toxicityRule } from './rules/toxicity.js';

// Assembles the ordered rule list, injecting static data into the rules that need it.
export function buildRules(data: PipelineData): Rule[] {
  return [
    solventMatchRule,
    makeAntagonismRule(data),
    makeSynergyRule(data),
    doseCurveRule,
    stabilityRule,
    toxicityRule,
  ];
}

export function runPipeline(
  context: BrewingContext,
  rules: Rule[],
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
