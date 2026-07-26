// SolventMatchRule: the pipeline's gatekeeper. Validates the combination is
// attemptable and assigns the per-ingredient weights every downstream rule reads.
// See docs/rules/rules.md (SolventMatchRule) for the full specification.

import type { Polarity, Solubility } from '../../domain/enums.js';
import { err, ok } from '../../domain/result.js';
import type { Solvent } from '../../domain/types.js';
import type { BrewingContext } from '../context.js';
import type { Rule } from '../rule.js';

// Grounded solvents never carry anti-solvent polarity (that is Lacuna, which is
// fictional and bypasses the matrix), so the table only needs the four real columns.
type GroundedPolarity = Exclude<Polarity, 'anti-solvent'>;

// Solubility x polarity adjacency. Determines chemical_extraction_weight for a
// grounded solvent: 1.0 perfect match, 0.7 adjacent, 0.5 universal, 0.3 poor, 0.0 none.
const ADJACENCY: Record<Solubility, Record<GroundedPolarity, number>> = {
  polar: { polar: 1.0, nonpolar: 0.3, 'acid-soluble': 0.7, universal: 1.0 },
  nonpolar: { polar: 0.3, nonpolar: 1.0, 'acid-soluble': 0.3, universal: 1.0 },
  'acid-soluble': { polar: 0.7, nonpolar: 0.3, 'acid-soluble': 1.0, universal: 1.0 },
  universal: { polar: 0.5, nonpolar: 0.5, 'acid-soluble': 0.5, universal: 1.0 },
  insoluble: { polar: 0.0, nonpolar: 0.0, 'acid-soluble': 0.0, universal: 0.5 },
};

// Fictional solvents are exactly those carrying a signature transformation.
function isFictional(solvent: Solvent): boolean {
  return solvent.signatureTransformation !== null;
}

function adjacencyWeight(solubility: Solubility, polarity: Polarity): number {
  // Only reached for grounded solvents, whose polarity is never anti-solvent. The
  // guard keeps the type honest rather than asserting non-null.
  if (polarity === 'anti-solvent') return 0;
  return ADJACENCY[solubility][polarity];
}

export const solventMatchRule: Rule = {
  name: 'solvent-match',

  apply(context: BrewingContext) {
    // Check 1: ingredient count.
    if (context.ingredients.length === 0) {
      return err({ reason: 'no_ingredients', message: 'Add at least one ingredient.' });
    }

    const { solvent, outcome } = context;
    const fictional = isFictional(solvent);

    // Check 2: solvent/outcome compatibility. Sachet uses no solvent; fictional solvents
    // bypass outcome gates.
    if (outcome !== 'sachet' && !fictional && !solvent.compatibleOutcomes.includes(outcome)) {
      return err({
        reason: 'outcome_incompatible',
        message: `${solvent.name} cannot produce a ${outcome}.`,
      });
    }

    let anyMatched = false;

    for (const ci of context.ingredients) {
      const { ingredient, weightData } = ci;

      // Check 3: solubility x polarity. Sachet and fictional solvents bypass the matrix
      // and get full weight.
      if (outcome === 'sachet' || fictional) {
        weightData.chemicalExtractionWeight = 1.0;
        weightData.presenceWeight = 1.0;
        anyMatched = true;
      } else {
        const weight = adjacencyWeight(ingredient.solubility, solvent.polarity);
        weightData.chemicalExtractionWeight = weight;
        weightData.presenceWeight = 1.0;
        if (weight > 0) anyMatched = true;
        if (weight > 0 && weight < 1.0) weightData.warnings.push('partial extraction only');
      }

      // Check 4: category affinity and resistance. A category sits in at most one tier.
      const category = ingredient.category;
      if (solvent.categoryAffinity.strong.includes(category)) {
        weightData.extractionYieldModifier += 0.3;
      } else if (solvent.categoryAffinity.weak.includes(category)) {
        weightData.extractionYieldModifier += 0.15;
      } else if (solvent.categoryResistance.strong.includes(category)) {
        weightData.extractionYieldModifier -= 0.5;
        weightData.warnings.push(`solvent strongly resists ${category} category`);
      } else if (solvent.categoryResistance.weak.includes(category)) {
        weightData.extractionYieldModifier -= 0.25;
        weightData.warnings.push(`solvent resists ${category} category`);
      }
    }

    // Check 5: total-extraction failure. If nothing extracts into a grounded solvent, the
    // combination is impossible. Fictional solvents and sachets bypass this.
    if (!anyMatched && !fictional && outcome !== 'sachet') {
      return err({
        reason: 'extraction_impossible',
        message: 'None of these ingredients dissolve in this solvent.',
      });
    }

    context.solventValidated = true;
    return ok(context);
  },
};
