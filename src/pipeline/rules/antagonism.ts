// AntagonismRule: detects canceling and destructive interactions, reducing ingredients'
// chemical extraction weight. Runs after SolventMatchRule (weights exist) and before
// SynergyRule (cancellation precedes amplification). Built as a factory closing over the
// static lookup tables it needs. See docs/rules/antagonism.md, reconciled
// with the SynergyRule cross-rule update for Pattern 1.

import { err, ok } from '../../domain/result.js';
import type {
  CombinationIngredient,
  PipelineData,
  SynergyPair,
  TagDefinition,
} from '../../domain/types.js';
import type { BrewingContext } from '../context.js';
import type { Rule } from '../rule.js';

const TOTAL_ANTAGONISM_FLOOR = 0.2;

// Default scaled-pair intensity ceilings when a synergy_pairs row leaves them null.
const DEFAULT_COMPLEMENTARY_CEILING = 0.7;
const DEFAULT_BALANCED_CEILING = 1.4;
const DEFAULT_STRAINING_CEILING = 2.0;

// Every interaction tag an ingredient carries. The tag's mechanical nature (opposite
// pairing, compound targeting, boost vs severity) comes from its TagDefinition, not from
// which array it sits in, so both arrays are considered together.
function tagsOf(ci: CombinationIngredient): string[] {
  return [...new Set([...ci.ingredient.synergyTags, ...ci.ingredient.antagonistTags])];
}

function compoundClassesOf(ci: CombinationIngredient): string[] {
  return ci.ingredient.compoundClasses.map((c) => c.class);
}

function effectiveWeight(ci: CombinationIngredient): number {
  return ci.weightData.chemicalExtractionWeight * ci.ingredient.aestheticWeight;
}

// Pattern 4: an ingredient already resisted by the solvent (negative yield modifier) is
// more susceptible to antagonism. Its reductions are amplified.
function resistanceAmplification(ci: CombinationIngredient): number {
  const modifier = ci.weightData.extractionYieldModifier;
  return modifier < 0 ? 1 + Math.abs(modifier) : 1;
}

// Reduce a single target's weight by an antagonizer, with resistance amplification. The
// factor is floored at 0 so weight never goes negative.
function reduceTarget(
  target: CombinationIngredient,
  antagonizerEffective: number,
  severity: number,
): void {
  const amplified = severity * resistanceAmplification(target);
  const factor = Math.max(0, 1 - amplified * antagonizerEffective);
  target.weightData.chemicalExtractionWeight *= factor;
}

// Mutual antagonism: both ingredients reduce each other simultaneously, using each
// other's pre-reduction effective weight.
function reduceMutual(a: CombinationIngredient, b: CombinationIngredient, severity: number): void {
  const aEffective = effectiveWeight(a);
  const bEffective = effectiveWeight(b);
  reduceTarget(a, bEffective, severity);
  reduceTarget(b, aEffective, severity);
}

// Directional antagonism: only the target is reduced.
function reduceDirectional(
  antagonizer: CombinationIngredient,
  target: CombinationIngredient,
  severity: number,
): void {
  reduceTarget(target, effectiveWeight(antagonizer), severity);
}

function hasTrait(ci: CombinationIngredient, trait: string): boolean {
  return ci.ingredient.traits.includes(trait as never);
}

function fillTemplate(
  template: string,
  a: CombinationIngredient,
  b: CombinationIngredient,
): string {
  return template.replace('{A}', a.ingredient.name).replace('{B}', b.ingredient.name);
}

export function makeAntagonismRule(data: PipelineData): Rule {
  // Index synergy pairs by unordered tag pair for O(1) lookup.
  const pairIndex = new Map<string, SynergyPair>();
  const key = (x: string, y: string) => [x, y].sort().join('|');
  for (const pair of data.synergyPairs) {
    pairIndex.set(key(pair.tagA, pair.tagB), pair);
  }
  const findPair = (x: string, y: string): SynergyPair | undefined => pairIndex.get(key(x, y));
  const def = (tag: string): TagDefinition | undefined => data.tagDefinitions.get(tag);

  // Pattern 1: opposite-tag pairs, classified via synergy_pairs.type.
  function opposingPairs(context: BrewingContext): void {
    const items = context.ingredients;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!;
        const b = items[j]!;
        const bTags = new Set(tagsOf(b));
        for (const tag of tagsOf(a)) {
          const opposite = def(tag)?.oppositeTag;
          if (!opposite || !bTags.has(opposite)) continue;

          const pair = findPair(tag, opposite);
          // No row means a plain always-antagonistic opposite (severity 0.8, mutual).
          if (!pair || pair.type === 'always_antagonistic') {
            reduceMutual(a, b, pair?.severity ?? 0.8);
            context.warnings.push(
              fillTemplate(pair?.warningTemplate ?? '{A} and {B} cancel each other out.', a, b),
            );
          } else if (pair.type === 'scaled') {
            classifyScaled(context, a, b, pair);
          }
          // always_complementary pairs are not opposite-tag pairs, so they never appear here.
        }
      }
    }
  }

  // A scaled pair's behavior depends on the combined intensity of the two ingredients.
  function classifyScaled(
    context: BrewingContext,
    a: CombinationIngredient,
    b: CombinationIngredient,
    pair: SynergyPair,
  ): void {
    const intensity = effectiveWeight(a) + effectiveWeight(b);
    const complementary = pair.complementaryCeiling ?? DEFAULT_COMPLEMENTARY_CEILING;
    const balanced = pair.balancedCeiling ?? DEFAULT_BALANCED_CEILING;
    const straining = pair.strainingCeiling ?? DEFAULT_STRAINING_CEILING;

    if (intensity < complementary) {
      // Complement at low intensity: defer the boost to SynergyRule.
      context.deferredComplementaryPairs.push({ a, b, boost: pair.boost ?? 0.3 });
      context.warnings.push(fillTemplate('{A} and {B} complement at low intensity.', a, b));
    } else if (intensity < balanced) {
      context.warnings.push(fillTemplate('{A} and {B} balance each other.', a, b));
    } else if (intensity < straining) {
      reduceMutual(a, b, pair.severity ?? 0.3);
      context.warnings.push(fillTemplate('{A} and {B} strain against each other.', a, b));
    } else {
      reduceMutual(a, b, 0.8);
      context.warnings.push(fillTemplate('{A} and {B} cancel each other out.', a, b));
    }
  }

  // Pattern 2: a tag that targets compound classes antagonizes ingredients bearing them.
  function tagTargetsCompound(context: BrewingContext): void {
    for (const antagonizer of context.ingredients) {
      for (const tag of tagsOf(antagonizer)) {
        const tagDef = def(tag);
        if (!tagDef || tagDef.severity === null) continue;
        if (!tagDef.targetsAnyCompound && (!tagDef.targets || tagDef.targets.length === 0))
          continue;

        for (const target of context.ingredients) {
          if (target === antagonizer) continue;
          const classes = compoundClassesOf(target);
          const shared = tagDef.targetsAnyCompound
            ? classes
            : classes.filter((c) => tagDef.targets!.includes(c));
          if (shared.length === 0) continue;

          reduceDirectional(antagonizer, target, tagDef.severity);
          context.warnings.push(
            `${antagonizer.ingredient.name} (${tag}) neutralizes ${shared.join(', ')} in ${target.ingredient.name}.`,
          );
        }
      }
    }
  }

  // Pattern 3: trait-driven antagonism.
  function traitDriven(context: BrewingContext): void {
    const prng = context.prngFor('antagonism-rule');
    const items = context.ingredients;

    // explosive x catalyst: dangerous, bidirectional. mercurial x shy: unpredictable,
    // bidirectional with seeded severity. Evaluated per unordered pair.
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!;
        const b = items[j]!;
        const explosivePair =
          (hasTrait(a, 'explosive') && hasTrait(b, 'catalyst')) ||
          (hasTrait(b, 'explosive') && hasTrait(a, 'catalyst'));
        if (explosivePair) {
          reduceMutual(a, b, 0.9);
          context.warnings.push(
            fillTemplate('{A} and {B} react dangerously (explosive and catalyst).', a, b),
          );
        }
        const mercurialPair =
          (hasTrait(a, 'mercurial') && hasTrait(b, 'shy')) ||
          (hasTrait(b, 'mercurial') && hasTrait(a, 'shy'));
        if (mercurialPair) {
          reduceMutual(a, b, prng.float(0.4, 0.7));
          context.warnings.push(fillTemplate('{A} and {B} interact unpredictably.', a, b));
        }
      }
    }

    // decaying: contaminates every other ingredient, directional.
    for (const source of items) {
      if (!hasTrait(source, 'decaying')) continue;
      for (const target of items) {
        if (target === source) continue;
        reduceDirectional(source, target, 0.3);
        context.warnings.push(fillTemplate('{A} spreads decay to {B}.', source, target));
      }
    }
  }

  return {
    name: 'antagonism',

    apply(context: BrewingContext) {
      opposingPairs(context);
      tagTargetsCompound(context);
      traitDriven(context);

      // Total-antagonism check: if every ingredient that extracted has been reduced below
      // the floor, the combination cancels itself out. Fictional solvents and sachets,
      // which do not rely on extraction, bypass it.
      const fictional = context.solvent.signatureTransformation !== null;
      if (!fictional && context.outcome !== 'sachet') {
        const matched = context.ingredients.filter(
          (ci) => ci.weightData.chemicalExtractionWeight > 0,
        );
        if (
          matched.length > 0 &&
          matched.every((ci) => ci.weightData.chemicalExtractionWeight < TOTAL_ANTAGONISM_FLOOR)
        ) {
          return err({
            reason: 'total_antagonism',
            message: 'These ingredients cancel each other out. Try removing an opposing pair.',
          });
        }
      }

      return ok(context);
    },
  };
}
