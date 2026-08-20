// Known-case tests for SensoryRule: the subtractive blend, blend state, combination pH, the
// three reactive shifts, luminosity selection, and the fictional colour overlays.

import { describe, expect, it } from 'vitest';

import type { Ingredient, Solvent } from '../../src/domain/types.js';
import { createContext } from '../../src/pipeline/context.js';
import { sensoryRule } from '../../src/pipeline/rules/sensory.js';
import { signatureTransformRule } from '../../src/pipeline/rules/signature-transform.js';
import { solventMatchRule } from '../../src/pipeline/rules/solvent-match.js';
import { combinationPh } from '../../src/sensory/index.js';
import { blend, luminance } from '../../src/sensory/color.js';
import { makeFictionalSolvent, makeIngredient, makeOpenSolvent } from '../support/fixtures.js';

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
    signatureTransformRule.apply(context);
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
