// Known-case tests for SensoryRule: the subtractive blend, blend state, combination pH, the
// three reactive shifts, luminosity selection, and the fictional colour overlays.

import { describe, expect, it } from 'vitest';

import type { Ingredient, Solvent } from '../../src/domain/types.js';
import { createContext } from '../../src/pipeline/context.js';
import { sensoryRule } from '../../src/pipeline/rules/sensory.js';
import { makeSignatureTransformRule } from '../../src/pipeline/rules/signature-transform.js';
import { solventMatchRule } from '../../src/pipeline/rules/solvent-match.js';
import { combinationPh } from '../../src/sensory/index.js';
import { blend, luminance } from '../../src/sensory/color.js';
import {
  makeFictionalSolvent,
  makeIngredient,
  makeOpenSolvent,
  makePipelineData,
} from '../support/fixtures.js';

// Runs SolventMatchRule so the weights SensoryRule reads are populated, then SensoryRule.
function run(ingredients: Ingredient[], solvent: Solvent = makeOpenSolvent()) {
  const context = createContext({ ingredients, solvent, outcome: 'concentrate' });
  const matched = solventMatchRule.apply(context);
  if (!matched.ok) throw new Error(`solvent match failed: ${matched.error.reason}`);
  sensoryRule.apply(context);
  return context;
}

const plain = (id: string, colorBase: string, overrides: Partial<Ingredient> = {}) =>
  makeIngredient({ id, slug: id, colorBase, ...overrides });

describe('subtractive blend', () => {
  it('returns the same colour when every participant shares it', () => {
    // The solvent participates too, so it is given the same colour to isolate the mix.
    const solvent = makeOpenSolvent({
      aestheticBase: { color: '#4A6B3A', viscosity: 'thin', luminosity: 'glossy' },
    });
    const context = run([plain('a', '#4A6B3A'), plain('b', '#4A6B3A')], solvent);
    expect(context.sensoryOutput!.colorBase).toBe('#4A6B3A');
  });

  it('lets a dense pigment dominate a pale one rather than averaging to mud', () => {
    // Chamomile yellow against Belladonna near-black. A channel average lands around
    // #8D7542, a washed tan resembling neither. Kubelka-Munk keeps it dark.
    const mixed = blend(['#FFE066', '#1A0B1F'], [0.5, 0.5]);
    expect(luminance(mixed)).toBeLessThan(luminance('#8D7542'));
  });

  it('is commutative in ingredient order', () => {
    const a = plain('a', '#FFE066');
    const b = plain('b', '#3A5F2D');
    expect(run([a, b]).sensoryOutput!.colorBase).toBe(run([b, a]).sensoryOutput!.colorBase);
  });
});

describe('blend state', () => {
  it('is homogeneous when every ingredient extracts equally', () => {
    const context = run([plain('a', '#FFE066'), plain('b', '#3A5F2D')]);
    expect(context.sensoryOutput!.blendState).toBe('homogeneous');
    expect(context.sensoryOutput!.colorSecondary).toBeNull();
  });

  it('separates when an insoluble ingredient sits in a polar solvent', () => {
    // Polar extracts at 1.0, insoluble at 0.0, so spread is 1.0.
    const context = run([
      plain('nettle', '#3A5F2D', { solubility: 'polar' }),
      plain('charcoal', '#1A1A1A', { solubility: 'insoluble' }),
    ]);
    expect(context.sensoryOutput!.blendState).toBe('separated');
    expect(context.sensoryOutput!.colorSecondary).not.toBeNull();
  });

  it('reads a gradient for a polar and nonpolar pairing', () => {
    // Polar 1.0 against nonpolar 0.3 gives spread 0.7.
    const context = run([
      plain('nettle', '#3A5F2D', { solubility: 'polar' }),
      plain('beeswax', '#F5D580', { solubility: 'nonpolar' }),
    ]);
    expect(['gradient', 'separated']).toContain(context.sensoryOutput!.blendState);
  });

  it('reads a uniform suspension when nothing dissolves well but spread is zero', () => {
    // Two insolubles in a universal solvent both extract at 0.5: spread 0, mean 0.5.
    const solvent = makeOpenSolvent({ polarity: 'universal' });
    const context = run(
      [
        plain('a', '#2C4A2C', { solubility: 'insoluble' }),
        plain('b', '#8B6F3A', { solubility: 'insoluble' }),
      ],
      solvent,
    );
    expect(context.sensoryOutput!.blendState).toBe('suspension');
  });

  it('is always homogeneous under a fictional solvent, which extracts everything at 1.0', () => {
    const context = run(
      [
        plain('a', '#3A5F2D', { solubility: 'polar' }),
        plain('b', '#1A1A1A', { solubility: 'insoluble' }),
      ],
      makeFictionalSolvent(),
    );
    expect(context.sensoryOutput!.blendState).toBe('homogeneous');
  });
});

describe('combination pH', () => {
  it('is null when the solvent has no aqueous phase', () => {
    const context = run([plain('a', '#FFE066')], makeOpenSolvent({ basePh: null }));
    expect(combinationPh(context.ingredients, context.solvent)).toBeNull();
  });

  it('sums ingredient contributions scaled by extraction weight', () => {
    const context = run([
      plain('woodash', '#CCCCCC', { phContribution: 3 }),
      plain('coral', '#FFDDDD', { phContribution: 2 }),
    ]);
    // Both polar in a polar solvent, so both extract at 1.0: 7 + 3 + 2.
    expect(combinationPh(context.ingredients, context.solvent)).toBeCloseTo(12);
  });

  it('mutes an insoluble ingredient, because pH follows what dissolved', () => {
    // Paired with something soluble, since a lone insoluble ingredient fails extraction.
    const context = run([
      plain('bonechar', '#1A1A1A', { phContribution: 3, solubility: 'insoluble' }),
      plain('carrier', '#CCCCCC', { phContribution: 0 }),
    ]);
    expect(combinationPh(context.ingredients, context.solvent)).toBeCloseTo(7);
  });

  it('clamps to the 0 to 14 range', () => {
    const context = run([
      plain('a', '#CCCCCC', { phContribution: 3 }),
      plain('b', '#CCCCCC', { phContribution: 3 }),
      plain('c', '#CCCCCC', { phContribution: 3 }),
    ]);
    expect(combinationPh(context.ingredients, context.solvent)).toBe(14);
  });
});

describe('reactive shifts', () => {
  const tannin = (id = 'tannin-bearer') =>
    plain(id, '#B0B0B0', { compoundClasses: [{ class: 'tannin', concentration: 0.5 }] });

  it('darkens toward ink when tannin meets a dark metal oxide', () => {
    const withIron = run([
      tannin(),
      plain('iron', '#3B3B3B', { compoundClasses: [{ class: 'oxide', concentration: 0.3 }] }),
    ]);
    const withoutIron = run([tannin(), plain('inert', '#3B3B3B')]);
    expect(luminance(withIron.sensoryOutput!.colorBase)).toBeLessThan(
      luminance(withoutIron.sensoryOutput!.colorBase),
    );
  });

  it('barely darkens when the oxide bearer is a white powder', () => {
    // Arsenic carries oxide at 0.75 but is near-white, so it makes a pale lake, not ink.
    // This is the case that a naive `oxide` + `tannin` trigger would get wrong.
    const withArsenic = run([
      tannin(),
      plain('arsenic', '#FAFAF5', { compoundClasses: [{ class: 'oxide', concentration: 0.75 }] }),
    ]);
    const withIron = run([
      tannin(),
      plain('iron', '#3B3B3B', { compoundClasses: [{ class: 'oxide', concentration: 0.3 }] }),
    ]);
    expect(luminance(withArsenic.sensoryOutput!.colorBase)).toBeGreaterThan(
      luminance(withIron.sensoryOutput!.colorBase),
    );
  });

  it('browns residual tannin toward amber when no oxide is present', () => {
    const browned = run([tannin()]);
    const plainMix = run([plain('inert', '#B0B0B0')]);
    // Amber is warmer than the grey it started from: red rises above blue.
    const hex = browned.sensoryOutput!.colorBase;
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    expect(r).toBeGreaterThan(b);
    expect(browned.sensoryOutput!.colorBase).not.toBe(plainMix.sensoryOutput!.colorBase);
  });

  it('shifts flavonoids red in acid and blue-green in alkali', () => {
    const flavonoid = plain('flav', '#F0EDE5', {
      compoundClasses: [{ class: 'flavonoid', concentration: 0.6 }],
    });
    const acid = run([flavonoid], makeOpenSolvent({ basePh: 2.5 }));
    const alkali = run([flavonoid], makeOpenSolvent({ basePh: 9.5 }));

    const redness = (hex: string) =>
      Number.parseInt(hex.slice(1, 3), 16) - Number.parseInt(hex.slice(5, 7), 16);
    expect(redness(acid.sensoryOutput!.colorBase)).toBeGreaterThan(
      redness(alkali.sensoryOutput!.colorBase),
    );
  });

  it('skips the flavonoid shift entirely when pH is null', () => {
    const flavonoid = plain('flav', '#F0EDE5', {
      compoundClasses: [{ class: 'flavonoid', concentration: 0.6 }],
    });
    const inert = plain('flav', '#F0EDE5');
    const solvent = makeOpenSolvent({ basePh: null });
    expect(run([flavonoid], solvent).sensoryOutput!.colorBase).toBe(
      run([inert], solvent).sensoryOutput!.colorBase,
    );
  });
});

describe('luminosity', () => {
  it('picks the weighted-dominant ingredient value', () => {
    const context = run([
      plain('a', '#FFE066', { luminosity: 'phosphorescent', aestheticWeight: 0.9 }),
      plain('b', '#3A5F2D', { luminosity: 'dull', aestheticWeight: 0.4 }),
    ]);
    expect(context.sensoryOutput!.luminosity).toBe('phosphorescent');
  });

  it('lets the solvent carry light-swallowing, which no ingredient has', () => {
    const solvent = makeFictionalSolvent({
      aestheticBase: { color: '#1A1A1A', viscosity: 'thin', luminosity: 'light-swallowing' },
    });
    const context = run(
      [plain('a', '#3A5F2D', { luminosity: 'dull', aestheticWeight: 0.1 })],
      solvent,
    );
    expect(context.sensoryOutput!.luminosity).toBe('light-swallowing');
  });
});

describe('fictional overlays', () => {
  const ichor = () =>
    makeFictionalSolvent({
      id: 'ichor',
      slug: 'ichor',
      name: 'Ichor',
      polarity: 'polar',
      basePh: 7.4,
      signatureTransformation: { type: 'additive-elevation', summary: 'you become more' },
      aestheticBase: { color: '#FFD700', viscosity: 'viscous', luminosity: 'phosphorescent' },
    });

  const prism = () =>
    makeFictionalSolvent({
      id: 'prism',
      slug: 'prism',
      name: 'Prism',
      polarity: 'universal',
      basePh: 9.5,
      signatureTransformation: { type: 'refractive-alteration', summary: 'you become other' },
      aestheticBase: { color: '#F5F0FA', viscosity: 'thin', luminosity: 'phosphorescent' },
    });

  function overlay(ingredients: Ingredient[], solvent: Solvent, erasure = 0) {
    const context = createContext({ ingredients, solvent, outcome: 'concentrate' });
    solventMatchRule.apply(context);
    context.sensoryErasureCount = erasure;
    sensoryRule.apply(context);
    makeSignatureTransformRule(makePipelineData()).apply(context);
    return context;
  }

  it('floods toward gold under Ichor while still carrying the ingredients', () => {
    const dark = overlay([plain('a', '#1A0B1F')], ichor());
    const pale = overlay([plain('a', '#FFE066')], ichor());
    const redness = (hex: string) => Number.parseInt(hex.slice(1, 3), 16);
    // Both read as gold, but the dark ingredient yields a dirtier one.
    expect(redness(dark.sensoryOutput!.colorBase)).toBeGreaterThan(100);
    expect(luminance(dark.sensoryOutput!.colorBase)).toBeLessThan(
      luminance(pale.sensoryOutput!.colorBase),
    );
    expect(dark.sensoryOutput!.colorSecondary).toBe('#FFD700');
    expect(dark.sensoryOutput!.luminosity).toBe('phosphorescent');
  });

  it('generates a spectrum and a secondary under Prism', () => {
    const context = overlay([plain('a', '#3A5F2D')], prism());
    expect(context.sensoryOutput!.colorSecondary).not.toBeNull();
    expect(context.sensoryOutput!.colorSecondary).not.toBe(context.sensoryOutput!.colorBase);
    expect(context.sensoryOutput!.luminosity).toBe('phosphorescent');
  });

  it('erases progressively under Lacuna', () => {
    const none = overlay([plain('a', '#4A6B3A')], makeFictionalSolvent(), 0);
    const some = overlay([plain('a', '#4A6B3A')], makeFictionalSolvent(), 2);
    const most = overlay([plain('a', '#4A6B3A')], makeFictionalSolvent(), 6);

    expect(some.sensoryOutput!.colorBase).not.toBe(none.sensoryOutput!.colorBase);
    // The ground darkens as erasure climbs.
    expect(luminance(most.sensoryOutput!.colorBase)).toBeLessThan(
      luminance(some.sensoryOutput!.colorBase),
    );
    // What survives fringes toward one of the two remaining subtractive primaries.
    expect(['#FF00FF', '#00FFFF']).toContain(most.sensoryOutput!.colorSecondary);
  });

  it('leaves luminosity dulled at the first erasure step', () => {
    const context = overlay(
      [plain('a', '#4A6B3A', { luminosity: 'phosphorescent' })],
      makeFictionalSolvent({
        aestheticBase: { color: '#1A1A1A', viscosity: 'thin', luminosity: 'phosphorescent' },
      }),
      1,
    );
    expect(context.sensoryOutput!.luminosity).toBe('glossy');
  });
});

describe('taste', () => {
  const tasty = (id: string, profile: Partial<Record<string, number>>, overrides = {}) =>
    plain(id, '#CCCCCC', {
      tasteProfile: {
        sweet: 0,
        bitter: 0,
        sour: 0,
        salty: 0,
        umami: 0,
        astringent: 0,
        metallic: 0,
        bright: 0,
        ...profile,
      },
      ...overrides,
    });

  it('averages each dimension across participants', () => {
    const context = run([tasty('a', { bitter: 1 }), tasty('b', { sweet: 1 })]);
    const taste = context.sensoryOutput!.tasteProfile!;
    // Equal weights, plus a flat solvent, so both land at the same reduced value.
    expect(taste.bitter).toBeCloseTo(taste.sweet);
    expect(taste.bitter).toBeGreaterThan(0);
    expect(taste.bitter).toBeLessThan(1);
  });

  it('carries the solvent through, so a sweet solvent makes a sweet preparation', () => {
    const honey = makeOpenSolvent({
      basePh: 4,
      tasteProfile: {
        sweet: 0.9,
        bitter: 0,
        sour: 0.2,
        salty: 0,
        umami: 0.1,
        astringent: 0,
        metallic: 0,
        bright: 0.3,
      },
    });
    const inWater = run([tasty('a', { bitter: 0.5 })]);
    const inHoney = run([tasty('a', { bitter: 0.5 })], honey);
    expect(inHoney.sensoryOutput!.tasteProfile!.sweet).toBeGreaterThan(
      inWater.sensoryOutput!.tasteProfile!.sweet,
    );
  });

  it('is not diluted by an insoluble ingredient that has no taste', () => {
    // The three quartzes are insoluble with all-zero taste profiles. Under presence
    // weighting a stone in the jar would weaken the liquor, which is wrong. Extraction
    // weighting zeroes it out with no special case.
    const alone = run([tasty('a', { bitter: 0.8 })]);
    const withStone = run([
      tasty('a', { bitter: 0.8 }),
      tasty('stone', {}, { solubility: 'insoluble' }),
    ]);
    expect(withStone.sensoryOutput!.tasteProfile!.bitter).toBeCloseTo(
      alone.sensoryOutput!.tasteProfile!.bitter,
    );
  });

  it('reports every dimension within range', () => {
    const context = run([tasty('a', { bitter: 1, astringent: 1 }), tasty('b', { salty: 1 })]);
    for (const value of Object.values(context.sensoryOutput!.tasteProfile!)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('temperature', () => {
  it('takes the weighted-dominant authored value', () => {
    const context = run([
      plain('a', '#CCCCCC', { temperatureFeel: 'warming', aestheticWeight: 0.9 }),
      plain('b', '#CCCCCC', { temperatureFeel: 'cold', aestheticWeight: 0.3 }),
    ]);
    expect(context.sensoryOutput!.temperatureFeel).toBe('warming');
  });

  it('shifts one step up when warming tag load clears the threshold', () => {
    const untagged = run([
      plain('a', '#CCCCCC', { temperatureFeel: 'neutral' }),
      plain('b', '#CCCCCC', { temperatureFeel: 'neutral' }),
    ]);
    const tagged = run([
      plain('a', '#CCCCCC', { temperatureFeel: 'neutral', synergyTags: ['warming'] }),
      plain('b', '#CCCCCC', { temperatureFeel: 'neutral' }),
    ]);
    expect(untagged.sensoryOutput!.temperatureFeel).toBe('neutral');
    expect(tagged.sensoryOutput!.temperatureFeel).toBe('warming');
  });

  it('shifts one step down on cooling tag load', () => {
    const context = run([
      plain('a', '#CCCCCC', { temperatureFeel: 'warming', synergyTags: ['cooling'] }),
      plain('b', '#CCCCCC', { temperatureFeel: 'warming', synergyTags: ['cooling'] }),
    ]);
    expect(context.sensoryOutput!.temperatureFeel).toBe('neutral');
  });

  it('keeps the field primary when a tag contradicts it', () => {
    // Wormwood is tagged warming but reads cold. It should come out cold that warms
    // slightly, one step, not flipped to warming outright.
    const context = run([
      plain('a', '#CCCCCC', { temperatureFeel: 'cold', synergyTags: ['warming'] }),
      plain('b', '#CCCCCC', { temperatureFeel: 'cold', synergyTags: ['warming'] }),
    ]);
    expect(context.sensoryOutput!.temperatureFeel).toBe('neutral');
  });

  it('does not shift on tag load below the threshold', () => {
    const context = run([
      plain('a', '#CCCCCC', { temperatureFeel: 'cold', synergyTags: ['warming'] }),
      plain('b', '#CCCCCC', { temperatureFeel: 'cold' }),
      plain('c', '#CCCCCC', { temperatureFeel: 'cold' }),
      plain('d', '#CCCCCC', { temperatureFeel: 'cold' }),
    ]);
    expect(context.sensoryOutput!.temperatureFeel).toBe('cold');
  });

  it('clamps at the ends of the scale', () => {
    const context = run([
      plain('a', '#CCCCCC', { temperatureFeel: 'burning', synergyTags: ['warming'] }),
      plain('b', '#CCCCCC', { temperatureFeel: 'burning', synergyTags: ['warming'] }),
    ]);
    expect(context.sensoryOutput!.temperatureFeel).toBe('burning');
  });
});

describe('sound', () => {
  it('is null when nothing carries one', () => {
    expect(run([plain('a', '#CCCCCC'), plain('b', '#CCCCCC')]).sensoryOutput!.sound).toBeNull();
  });

  it('takes the dominant bearer rather than merging', () => {
    const context = run([
      plain('a', '#CCCCCC', { sound: 'faint metallic ring', aestheticWeight: 0.9 }),
      plain('b', '#CCCCCC', { sound: 'distant surf', aestheticWeight: 0.2 }),
    ]);
    expect(context.sensoryOutput!.sound).toBe('faint metallic ring');
  });

  it('stays silent when the only bearer is a trace presence', () => {
    const context = run([
      plain('a', '#CCCCCC', { sound: 'faint high tone', aestheticWeight: 0.1 }),
      plain('b', '#CCCCCC', { aestheticWeight: 1 }),
      plain('c', '#CCCCCC', { aestheticWeight: 1 }),
      plain('d', '#CCCCCC', { aestheticWeight: 1 }),
    ]);
    expect(context.sensoryOutput!.sound).toBeNull();
  });

  it('does not depend on ingredient order', () => {
    const a = plain('a', '#CCCCCC', { sound: 'first', aestheticWeight: 0.6 });
    const b = plain('b', '#CCCCCC', { sound: 'second', aestheticWeight: 0.6 });
    expect(run([a, b]).sensoryOutput!.sound).toBe(run([b, a]).sensoryOutput!.sound);
  });
});

describe('aroma', () => {
  const scented = (id: string, notes: Array<[string, 'top' | 'heart' | 'base']>, overrides = {}) =>
    plain(id, '#CCCCCC', {
      aromaNotes: notes.map(([note, position]) => ({ note, position })),
      ...overrides,
    });

  it('merges notes by position', () => {
    const context = run([
      scented('a', [
        ['citrus', 'top'],
        ['wood', 'base'],
      ]),
      scented('b', [['floral', 'top']]),
    ]);
    const aroma = context.sensoryOutput!.aromaProfile!;
    expect(aroma.top.sort()).toEqual(['citrus', 'floral']);
    expect(aroma.base).toEqual(['wood']);
    expect(aroma.heart).toEqual([]);
  });

  it('keeps a note at every position any ingredient assigns it to', () => {
    // 22 of the 38 notes in use sit at different positions on different ingredients. A
    // preparation of several earthy ingredients should read earthy the whole way down
    // rather than having one position arbitrarily win.
    const context = run([
      scented('a', [['earth', 'top']]),
      scented('b', [['earth', 'heart']]),
      scented('c', [['earth', 'base']]),
    ]);
    const aroma = context.sensoryOutput!.aromaProfile!;
    expect(aroma.top).toContain('earth');
    expect(aroma.heart).toContain('earth');
    expect(aroma.base).toContain('earth');
  });

  it('does not duplicate a note within one position', () => {
    const context = run([scented('a', [['earth', 'top']]), scented('b', [['earth', 'top']])]);
    expect(context.sensoryOutput!.aromaProfile!.top).toEqual(['earth']);
  });

  it('lets the solvent contribute without leading', () => {
    const honey = makeOpenSolvent({
      aromaNotes: [{ note: 'honied', position: 'top' }],
    });
    const bare = run([scented('a', [['citrus', 'top']])], honey);
    expect(bare.sensoryOutput!.aromaProfile!.top).toContain('honied');
    // Muted: an ingredient carrying its own note outranks the solvent's.
    expect(bare.sensoryOutput!.aromaProfile!.top[0]).toBe('citrus');
  });

  it('caps how many notes a position carries', () => {
    const context = run([
      scented('a', [
        ['citrus', 'top'],
        ['mint', 'top'],
        ['green', 'top'],
      ]),
      scented('b', [
        ['ozone', 'top'],
        ['floral', 'top'],
        ['sweet', 'top'],
      ]),
    ]);
    expect(context.sensoryOutput!.aromaProfile!.top.length).toBeLessThanOrEqual(4);
  });

  it('does not depend on ingredient order', () => {
    const a = scented('a', [['citrus', 'top']], { aestheticWeight: 0.5 });
    const b = scented('b', [['mint', 'top']], { aestheticWeight: 0.5 });
    expect(run([a, b]).sensoryOutput!.aromaProfile).toEqual(
      run([b, a]).sensoryOutput!.aromaProfile,
    );
  });
});

describe('fictional aroma overlays', () => {
  const families = () =>
    new Map([
      ['citrus', 'fresh-bright'],
      ['mint', 'fresh-bright'],
      ['green', 'fresh-bright'],
      ['ozone', 'fresh-bright'],
    ]);

  function overlay(
    ingredients: Ingredient[],
    solvent: Solvent,
    opts: { erasure?: number; scope?: number } = {},
  ) {
    const context = createContext({ ingredients, solvent, outcome: 'concentrate' });
    solventMatchRule.apply(context);
    context.sensoryErasureCount = opts.erasure ?? 0;
    context.synergyScopeMultiplier = opts.scope ?? 0;
    sensoryRule.apply(context);
    makeSignatureTransformRule(makePipelineData({ aromaFamilies: families() })).apply(context);
    return context;
  }

  const prism = () =>
    makeFictionalSolvent({
      id: 'prism',
      slug: 'prism',
      name: 'Prism',
      polarity: 'universal',
      signatureTransformation: { type: 'refractive-alteration', summary: 'you become other' },
    });

  const withCitrus = () =>
    plain('a', '#CCCCCC', { aromaNotes: [{ note: 'citrus', position: 'top' }] });

  it('expands Prism aroma with siblings from the same family', () => {
    const none = overlay([withCitrus()], prism(), { scope: 0 });
    const wide = overlay([withCitrus()], prism(), { scope: 3 });

    expect(none.sensoryOutput!.aromaProfile!.top).toEqual(['citrus']);
    expect(wide.sensoryOutput!.aromaProfile!.top.length).toBeGreaterThan(1);
    // Everything added is a fresh-bright sibling, drawn from the vocabulary rather than invented.
    for (const note of wide.sensoryOutput!.aromaProfile!.top) {
      expect(families().get(note)).toBe('fresh-bright');
    }
  });

  it('expands deterministically for a given seed', () => {
    const first = overlay([withCitrus()], prism(), { scope: 3 });
    const second = overlay([withCitrus()], prism(), { scope: 3 });
    expect(first.sensoryOutput!.aromaProfile).toEqual(second.sensoryOutput!.aromaProfile);
  });

  it('flattens Lacuna aroma from the top down', () => {
    const scented = () =>
      plain('a', '#CCCCCC', {
        aromaNotes: [
          { note: 'citrus', position: 'top' },
          { note: 'wood', position: 'heart' },
          { note: 'earth', position: 'base' },
        ],
      });

    const intact = overlay([scented()], makeFictionalSolvent(), { erasure: 2 });
    const flattened = overlay([scented()], makeFictionalSolvent(), { erasure: 3 });
    const gone = overlay([scented()], makeFictionalSolvent(), { erasure: 6 });

    expect(intact.sensoryOutput!.aromaProfile!.top).toEqual(['citrus']);
    // Volatiles lift off first.
    expect(flattened.sensoryOutput!.aromaProfile!.top).toEqual([]);
    expect(flattened.sensoryOutput!.aromaProfile!.heart).toEqual(['wood']);
    // At the far end only the base remains.
    expect(gone.sensoryOutput!.aromaProfile!.heart).toEqual([]);
    expect(gone.sensoryOutput!.aromaProfile!.base).toEqual(['earth']);
  });
});
