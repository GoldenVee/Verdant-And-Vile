# Rules Pipeline

One document per rule, in pipeline order. Each takes a `BrewingContext` and returns a
modified context; the pipeline short-circuits on the first `Err` (ADR-004).

| # | Rule | Doc | Can fail with |
|---:|---|---|---|
| 1 | SolventMatchRule | [solvent-match.md](solvent-match.md) | `no_ingredients`, `outcome_incompatible`, `extraction_impossible` |
| 2 | AntagonismRule | [antagonism.md](antagonism.md) | `total_antagonism` |
| 3 | SynergyRule | [synergy.md](synergy.md) | no |
| 4 | DoseCurveRule | [dose-curve.md](dose-curve.md) | `extraction_impossible` |
| 5 | EffectsRule | [effects.md](effects.md) | no |
| 6 | StabilityRule | [stability.md](stability.md) | `insufficient_stability` |
| 7 | ToxicityRule | [toxicity.md](toxicity.md) | `lethal_somatic`, `lethal_psychic`, `lethal_sensory` |
| 8 | SensoryRule | [sensory.md](sensory.md) | no |
| 9 | SignatureTransformRule | [signature-transform.md](signature-transform.md) | no |
| 10 | DescriptionRule | [description.md](description.md) | no |

Rules 1 to 9 are implemented. Rule 10 is designed but not built.

## Reading order

`../design-reference.md` is canonical for anything these docs disagree on, with two
exceptions that supersede it: [effects.md](effects.md) for the effect model, and
[sensory.md](sensory.md) for the sensory model. Both stubs in the design reference point
here.

The docs for rules 1 to 4, 6, 7, and 9 were written before implementation and describe the
specification. [effects.md](effects.md), [sensory.md](sensory.md), and
[description.md](description.md) were written in the same session as their implementation
and also carry the reasoning behind decisions, including options that were rejected.

## Notes on the split

These were one 3484-line `rules.md` until the docs cleanup. Splitting matched the structure
CLAUDE.md already described, and made it obvious that EffectsRule and SensoryRule had never
been documented here at all.

Heading levels were inconsistent across the original sections and are normalised to one `#`
title per file.
