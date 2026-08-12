// EffectsRule: materializes the preparation's experiential effects. Base effects come from
// each ingredient's effect-producing tags, gated by the dose state so an ingredient that
// did not manifest produces nothing. Emergent effects come from synergy intents. Runs
// after DoseCurveRule (so effective potency is final) and before StabilityRule. See
// docs/effects.md.
//
// A factory over the static effect vocabulary and tag->effect mapping (in PipelineData).
// Antagonism and synergy influence arrives through the weights, so this rule reads only
// the final per-ingredient state.

import { ok } from '../../domain/result.js';
import type { CombinationIngredient, Effect, PipelineData } from '../../domain/types.js';
import type { BrewingContext } from '../context.js';
import type { Rule } from '../rule.js';

function tagsOf(ci: CombinationIngredient): string[] {
  return [...new Set([...ci.ingredient.synergyTags, ...ci.ingredient.antagonistTags])];
}

export function makeEffectsRule(data: PipelineData): Rule {
  return {
    name: 'effects',

    apply(context: BrewingContext) {
      const effects: Effect[] = [];
      let counter = 0;
      const nextId = () => `effect-${counter++}`;

      // Phase 1: per-ingredient base effects, gated by dose state.
      for (const ci of context.ingredients) {
        const potency = ci.weightData.effectivePotency;
        // An ingredient that stayed inactive or turned harmful produces no effect; its
        // harm is captured in toxicity, not as a felt effect.
        if (ci.weightData.doseState === 'threshold_inactive') continue;
        if (potency === null || potency <= 0) continue;

        for (const tag of tagsOf(ci)) {
          const producesEffect = data.tagDefinitions.get(tag)?.producesEffect;
          if (!producesEffect) continue;
          const def = data.effectDefinitions.get(producesEffect);
          if (!def) continue;

          effects.push({
            id: nextId(),
            sourceIngredientId: ci.ingredient.id,
            type: def.type,
            domain: def.domain,
            descriptor: def.defaultDescriptor,
            magnitude: potency,
            emergent: false,
            subtractive: false,
            refracted: false,
            duration: 'normal',
            reversible: true,
          });
        }
      }

      // Phase 2: emergent effects unlocked by synergy.
      for (const intent of context.emergentEffects) {
        const def = data.effectDefinitions.get(intent.effectType);
        if (!def) continue;
        effects.push({
          id: nextId(),
          sourceIngredientId: null,
          type: def.type,
          domain: def.domain,
          descriptor: def.defaultDescriptor,
          magnitude: intent.magnitude,
          emergent: true,
          subtractive: false,
          refracted: false,
          duration: 'normal',
          reversible: true,
        });
      }

      context.effects = effects;
      return ok(context);
    },
  };
}
