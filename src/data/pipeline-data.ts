// Loads the static lookup tables into an in-memory PipelineData structure, once per
// pipeline run. This is how the "static vocabulary lives in DB tables, rules query them at
// runtime" thesis is realized: the tables are read here and injected into the rule factories.

import { db } from '../db/client.js';
import {
  effectDefinitions,
  effectSubtractiveEquivalents,
  synergyPairs,
  tagDefinitions,
} from '../db/schema.js';
import type {
  EffectDefinition,
  PipelineData,
  SynergyPair,
  TagDefinition,
} from '../domain/types.js';

export async function loadPipelineData(): Promise<PipelineData> {
  const [tags, pairs, effects, equivalents] = await Promise.all([
    db.select().from(tagDefinitions),
    db.select().from(synergyPairs),
    db.select().from(effectDefinitions),
    db.select().from(effectSubtractiveEquivalents),
  ]);

  const tagMap = new Map<string, TagDefinition>();
  for (const t of tags) {
    tagMap.set(t.slug, {
      slug: t.slug,
      category: t.category,
      targets: t.targets,
      targetsAnyCompound: t.targetsAnyCompound,
      effectTargets: t.effectTargets,
      producesEffect: t.producesEffect,
      boost: t.boost,
      severity: t.severity,
      oppositeTag: t.oppositeTag,
    });
  }

  const synergyPairRows: SynergyPair[] = pairs.map((p) => ({
    tagA: p.tagA,
    tagB: p.tagB,
    type: p.type,
    boost: p.boost,
    severity: p.severity,
    complementaryCeiling: p.complementaryCeiling,
    balancedCeiling: p.balancedCeiling,
    strainingCeiling: p.strainingCeiling,
    unlocksEffect: p.unlocksEffect,
    warningTemplate: p.warningTemplate,
  }));

  const effectMap = new Map<string, EffectDefinition>();
  for (const e of effects) {
    effectMap.set(e.type, {
      type: e.type,
      domain: e.domain,
      defaultDescriptor: e.defaultDescriptor,
    });
  }

  const equivalentMap = new Map<string, string>();
  for (const eq of equivalents) equivalentMap.set(eq.standardEffect, eq.subtractiveEquivalent);

  return {
    tagDefinitions: tagMap,
    synergyPairs: synergyPairRows,
    effectDefinitions: effectMap,
    effectSubtractiveEquivalents: equivalentMap,
  };
}
