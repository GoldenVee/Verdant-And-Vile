// Known-case tests for SignatureTransformRule: per-solvent effect transformations, marks,
// narrative wrap, and warnings. Sensory overlays are deferred and not tested here.

import { describe, expect, it } from 'vitest';

import type { Solvent, Toxicity } from '../../src/domain/types.js';
import { createContext } from '../../src/pipeline/context.js';
import { makeSignatureTransformRule } from '../../src/pipeline/rules/signature-transform.js';
import {
  makeEffect,
  makeFictionalSolvent,
  makeIngredient,
  makeOpenSolvent,
  makePipelineData,
} from '../support/fixtures.js';

const ichor = () =>
  makeFictionalSolvent({
    slug: 'ichor',
    signatureTransformation: { type: 'additive-elevation', summary: 'you become more' },
  });
const prism = () =>
  makeFictionalSolvent({
    slug: 'prism',
    signatureTransformation: { type: 'refractive-alteration', summary: 'you become other' },
  });
const lacuna = () => makeFictionalSolvent(); // slug 'lacuna'

function contextWith(solvent: Solvent, ingredientIds: string[] = ['a']) {
  return createContext({
    ingredients: ingredientIds.map((id) => makeIngredient({ id })),
    solvent,
    outcome: 'potion',
  });
}

const safeToxicity: Toxicity = { somatic: 0, psychic: 0, sensory: 0 };

describe('grounded solvents', () => {
  it('skip the rule: no marks, no narrative, effects untouched', () => {
    const context = contextWith(makeOpenSolvent());
    context.effects.push(makeEffect({ id: 'e0', descriptor: 'vivid recollection' }));
    makeSignatureTransformRule(makePipelineData()).apply(context);
    expect(context.marks).toHaveLength(0);
    expect(context.narrativeWrap).toBeNull();
    expect(context.effects[0]!.descriptor).toBe('vivid recollection');
  });
});

describe('Ichor', () => {
  it('elevates effect descriptors and records a golden mark and narrative', () => {
    const context = contextWith(ichor());
    context.toxicity = safeToxicity;
    context.effects.push(makeEffect({ id: 'e0', descriptor: 'vivid recollection' }));
    makeSignatureTransformRule(makePipelineData()).apply(context);

    expect(context.effects[0]!.descriptor).toBe('transcendent vivid recollection');
    expect(context.marks).toEqual([{ solvent: 'ichor', markLevel: expect.any(Number) }]);
    expect(context.narrativeWrap).toContain('Ichor');
  });

  it('warns when somatic toxicity is high', () => {
    const context = contextWith(ichor());
    context.toxicity = { somatic: 6, psychic: 0, sensory: 0 };
    makeSignatureTransformRule(makePipelineData()).apply(context);
    expect(context.warnings).toContain('the divine solvent amplifies harm as readily as benefit');
  });
});

describe('Prism', () => {
  it('duplicates some effects as refracted copies, deterministically', () => {
    const build = () => {
      const context = contextWith(prism());
      for (let i = 0; i < 4; i++) context.effects.push(makeEffect({ id: `e${i}` }));
      makeSignatureTransformRule(makePipelineData()).apply(context);
      return context;
    };
    const first = build();
    const second = build();

    // At least the four originals remain, plus zero or more refracted copies.
    expect(first.effects.length).toBeGreaterThanOrEqual(4);
    expect(first.effects.length).toBe(second.effects.length); // deterministic
    const refracted = first.effects.filter((e) => e.refracted);
    for (const e of refracted) {
      expect(e.id).toMatch(/-refracted$/);
      expect(e.descriptor).toContain('a refraction of');
    }
    expect(first.narrativeWrap).toContain('Prism');
    expect(first.marks[0]!.solvent).toBe('prism');
  });
});

describe('Lacuna', () => {
  it('applies transmute markers, turning effects subtractive', () => {
    const context = contextWith(lacuna());
    context.effects.push(makeEffect({ id: 'e0', sourceIngredientId: 'a', type: 'memory_recall' }));
    context.lacunaTransmuteMarkers.push({
      ingredientId: 'a',
      originalEffect: 'memory_recall',
      transmutedEffect: 'memory_erasure',
      effectDomain: 'memory',
    });
    makeSignatureTransformRule(makePipelineData()).apply(context);

    const effect = context.effects[0]!;
    expect(effect.type).toBe('memory_erasure');
    expect(effect.subtractive).toBe(true);
    expect(context.marks[0]!.solvent).toBe('lacuna');
    expect(context.narrativeWrap).toContain('missing');
  });

  it('makes subtractive effects permanent at permanence scale >= 2.0', () => {
    const context = contextWith(lacuna());
    context.permanenceScale = 2.0;
    context.effects.push(makeEffect({ id: 'e0', sourceIngredientId: 'a', type: 'memory_recall' }));
    context.lacunaTransmuteMarkers.push({
      ingredientId: 'a',
      originalEffect: 'memory_recall',
      transmutedEffect: 'memory_erasure',
      effectDomain: 'memory',
    });
    makeSignatureTransformRule(makePipelineData()).apply(context);

    const effect = context.effects[0]!;
    expect(effect.duration).toBe('permanent');
    expect(effect.reversible).toBe(false);
    expect(context.warnings).toContain('preparation carries permanent absence, consider carefully');
  });

  it('extends subtractive effects at permanence scale in [1.5, 2.0)', () => {
    const context = contextWith(lacuna());
    context.permanenceScale = 1.6;
    context.effects.push(makeEffect({ id: 'e0', sourceIngredientId: 'a', type: 'memory_recall' }));
    context.lacunaTransmuteMarkers.push({
      ingredientId: 'a',
      originalEffect: 'memory_recall',
      transmutedEffect: 'memory_erasure',
      effectDomain: 'memory',
    });
    makeSignatureTransformRule(makePipelineData()).apply(context);

    expect(context.effects[0]!.duration).toBe('extended');
    expect(context.effects[0]!.reversible).toBe(true);
  });
});
