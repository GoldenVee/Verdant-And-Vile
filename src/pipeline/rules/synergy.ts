// SynergyRule: detects reinforcing interactions and accumulates a potency multiplier per
// ingredient. Runs after AntagonismRule (synergy amplifies what survived) and before
// DoseCurveRule. Built as a factory over the static lookup tables.
//
// This is pass 1: the five grounded patterns plus the per-solvent cap. Fictional-solvent
// signatures (Prism scope, Lacuna transmutation and permanence) land in pass 2. See
// docs/rules/rules.md (SynergyRule).

import { ok } from '../../domain/result.js';
import type { CombinationIngredient, PipelineData, SynergyPair } from '../../domain/types.js';
import type { BrewingContext } from '../context.js';
import type { Rule } from '../rule.js';

// Synergy caps by solvent: Ichor amplifies further, everything else is standard.
const GROUNDED_CAP = 2.5;
const ICHOR_CAP = 5.0;

const RELATED_FAMILY_BOOST = 0.3;
const CATALYST_BOOST = 0.5;
const CARRIER_BOOST = 0.6;
const QUIESCENT_BOOST = 0.3;
const DEFAULT_COMPLEMENTARY_BOOST = 0.4;

function tagsOf(ci: CombinationIngredient): string[] {
  return [...new Set([...ci.ingredient.synergyTags, ...ci.ingredient.antagonistTags])];
}

function compoundClassesOf(ci: CombinationIngredient): string[] {
  return ci.ingredient.compoundClasses.map((c) => c.class);
}

function effectiveWeight(ci: CombinationIngredient): number {
  return ci.weightData.chemicalExtractionWeight * ci.ingredient.aestheticWeight;
}

function hasTrait(ci: CombinationIngredient, trait: string): boolean {
  return ci.ingredient.traits.includes(trait as never);
}

function isAmplifierTag(tag: string): boolean {
  return tag.endsWith('-amplifier');
}

// Shared compound-class synergy diminishes: each additional shared class contributes 60%
// of the previous. Self-bounded around 0.375, so no hard cap is needed.
function diminishingBoost(count: number): number {
  let total = 0;
  let current = 0.15;
  for (let i = 0; i < count; i++) {
    total += current;
    current *= 0.6;
  }
  return total;
}

export function makeSynergyRule(data: PipelineData): Rule {
  const complementaryPairs = data.synergyPairs.filter((p) => p.type === 'always_complementary');

  // Boost accumulates on potencyMultiplier (separate from extraction weight). The booster's
  // effective weight uses extraction weight, which synergy never changes, so the order of
  // application within the rule does not matter.
  function boostOne(target: CombinationIngredient, boosterEffective: number, boost: number): void {
    target.weightData.potencyMultiplier *= 1 + boost * boosterEffective;
  }

  function boostMutual(a: CombinationIngredient, b: CombinationIngredient, boost: number): void {
    const aEffective = effectiveWeight(a);
    const bEffective = effectiveWeight(b);
    boostOne(a, bEffective, boost);
    boostOne(b, aEffective, boost);
  }

  function boostDirectional(
    booster: CombinationIngredient,
    target: CombinationIngredient,
    boost: number,
  ): void {
    boostOne(target, effectiveWeight(booster), boost);
  }

  // Pattern 1: shared related_family.
  function relatedFamily(context: BrewingContext): void {
    const items = context.ingredients;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!;
        const b = items[j]!;
        const fam = a.ingredient.relatedFamily;
        if (fam !== null && fam === b.ingredient.relatedFamily) {
          boostMutual(a, b, RELATED_FAMILY_BOOST);
          context.warnings.push(
            `${a.ingredient.name} and ${b.ingredient.name} share related family: ${fam}.`,
          );
        }
      }
    }
  }

  // Pattern 2: shared compound classes, diminishing.
  function sharedCompoundClass(context: BrewingContext): void {
    const items = context.ingredients;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!;
        const b = items[j]!;
        const bClasses = new Set(compoundClassesOf(b));
        const shared = compoundClassesOf(a).filter((c) => bClasses.has(c));
        if (shared.length > 0) {
          boostMutual(a, b, diminishingBoost(shared.length));
          context.warnings.push(
            `${a.ingredient.name} and ${b.ingredient.name} share compound classes: ${shared.join(', ')}.`,
          );
        }
      }
    }
  }

  // Pattern 3: a tag that targets compound classes boosts ingredients bearing them.
  // Effect-target tags (stimulant-amplifier, etc.) have no compound targets and no backing
  // ingredient effect data yet, so they naturally do not fire here.
  function tagTargetsCompound(context: BrewingContext): void {
    for (const booster of context.ingredients) {
      for (const tag of tagsOf(booster)) {
        const def = data.tagDefinitions.get(tag);
        if (!def || def.boost === null) continue;
        if (!def.targetsAnyCompound && (!def.targets || def.targets.length === 0)) continue;

        for (const target of context.ingredients) {
          if (target === booster) continue;
          const classes = compoundClassesOf(target);
          const shared = def.targetsAnyCompound
            ? classes
            : classes.filter((c) => def.targets!.includes(c));
          if (shared.length === 0) continue;

          boostDirectional(booster, target, def.boost);
          context.warnings.push(
            `${booster.ingredient.name} (${tag}) amplifies ${shared.join(', ')} in ${target.ingredient.name}.`,
          );
        }
      }
    }
  }

  // Pattern 4: complementary tag pairs (curated always-complementary) plus scaled pairs
  // that AntagonismRule deferred as complementary.
  function complementaryTags(context: BrewingContext): void {
    const items = context.ingredients;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!;
        const b = items[j]!;
        const aTags = new Set(tagsOf(a));
        const bTags = new Set(tagsOf(b));
        for (const pair of complementaryPairs) {
          if (pairMatches(pair, aTags, bTags)) {
            boostMutual(a, b, pair.boost ?? DEFAULT_COMPLEMENTARY_BOOST);
            context.warnings.push(
              `${a.ingredient.name} and ${b.ingredient.name} complement (${pair.tagA} + ${pair.tagB}).`,
            );
          }
        }
      }
    }

    for (const deferred of context.deferredComplementaryPairs) {
      boostMutual(deferred.a, deferred.b, deferred.boost);
      context.warnings.push(
        `${deferred.a.ingredient.name} and ${deferred.b.ingredient.name} complement at balanced intensity.`,
      );
    }
  }

  // Pattern 5: trait-driven synergy.
  function traitDriven(context: BrewingContext): void {
    for (const booster of context.ingredients) {
      for (const target of context.ingredients) {
        if (target === booster) continue;

        if (hasTrait(booster, 'catalyst') && tagsOf(target).some(isAmplifierTag)) {
          boostDirectional(booster, target, CATALYST_BOOST);
          context.warnings.push(`${booster.ingredient.name} catalyzes ${target.ingredient.name}.`);
        }
        if (hasTrait(booster, 'carrier')) {
          boostDirectional(booster, target, CARRIER_BOOST);
          context.warnings.push(`${booster.ingredient.name} carries ${target.ingredient.name}.`);
        }
        if (hasTrait(booster, 'quiescent') && hasTrait(target, 'volatile')) {
          boostDirectional(booster, target, QUIESCENT_BOOST);
          context.warnings.push(`${booster.ingredient.name} stabilizes ${target.ingredient.name}.`);
        }
      }
    }
  }

  function applyCap(context: BrewingContext): void {
    const cap = context.solvent.slug === 'ichor' ? ICHOR_CAP : GROUNDED_CAP;
    for (const ci of context.ingredients) {
      ci.weightData.potencyMultiplier = Math.min(ci.weightData.potencyMultiplier, cap);
    }
  }

  return {
    name: 'synergy',

    apply(context: BrewingContext) {
      relatedFamily(context);
      sharedCompoundClass(context);
      tagTargetsCompound(context);
      complementaryTags(context);
      traitDriven(context);
      applyCap(context);
      return ok(context);
    },
  };
}

function pairMatches(pair: SynergyPair, aTags: Set<string>, bTags: Set<string>): boolean {
  return (
    (aTags.has(pair.tagA) && bTags.has(pair.tagB)) || (aTags.has(pair.tagB) && bTags.has(pair.tagA))
  );
}
