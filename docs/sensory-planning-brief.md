# Sensory Algorithm (Phase 9): Planning Brief

A handoff brief for a fresh Claude Code session. Open this repo in the desktop app and
either paste this file's contents as the opening message, or say "read
docs/sensory-planning-brief.md and let's start." Everything below is a proposal to work
through with the user, not settled fact.

## The task

Design and then implement the sensory algorithm (Phase 9). Work doc-first: write a
`docs/sensory.md` design doc, get it agreed, then implement it as a new `SensoryRule`
following the repo's conventions in `CLAUDE.md`. This is a "stop and flag" area per
CLAUDE.md, so lead with design discussion and options, not code.

## Read these first (to ground yourself in the actual state)

- `CLAUDE.md`: project, stack, architectural conventions, working style.
- `docs/design-reference.md`: the "Sensory Algorithm" section holds the current placeholder
  shape (subtractive color blend + reactive shifts, perfumery aroma layering, weighted taste,
  dominant texture, motion, and the three fictional overlays). That is the skeleton to flesh out.
- `docs/effects.md`: the most recent model doc. Mirror its structure and rigor: schema,
  vocabulary, rule spec, pipeline placement, ADR, open questions. The effects work is the
  template for how a new rule was added.
- `docs/rules/rules.md`: the SignatureTransformRule section, whose fictional sensory overlays
  are currently deferred no-op sites (Ichor color/luminosity, Prism iridescence + aroma
  expansion, Lacuna progressive erasure).
- `src/pipeline/index.ts`: `buildRules`, the current eight-rule pipeline.
- `src/pipeline/context.ts`: `BrewingContext`, what is available to read, and where
  `sensory_output` would be set.
- `src/domain/types.ts`: the `Ingredient` sensory fields and `WeightData`.
- `src/pipeline/rules/effects.ts` and `src/pipeline/rules/signature-transform.ts`: the rule
  patterns to follow (a factory rule and a plain rule; how the deferred sensory sites are marked).

## Current state (as of this brief)

- All eight pipeline rules are implemented and tested: SolventMatch, Antagonism, Synergy
  (with pass 2), DoseCurve, Effects, Stability, Toxicity, SignatureTransform.
- `POST /combinations` runs the real pipeline against the DB and returns the resolved
  preparation. `sensoryOutput`, `name`, and `lore` are `null` pending Phases 9 and 10.
- The sensory algorithm's dependencies are all satisfied: final weights, effects, and the
  fictional scalars (`synergy_scope_multiplier`, `sensory_erasure_count`) all exist.
- Tests: known-case plus fast-check invariants per rule. Full suite currently green.

## Output shape

`SensoryRule` produces `context.sensory_output`:

```
{
  color_base,        // hex
  color_secondary,   // hex or null
  aroma_profile,     // { top: [...notes], heart: [...notes], base: [...notes] }
  taste_profile,     // 8 keys 0.0-1.0 (sweet, bitter, sour, salty, umami, astringent, metallic, bright)
  texture,           // { type, intensity } or a "separates" state
  motion_tendency,   // one of the 10 motion enums
  luminosity,        // dull | glossy | phosphorescent | light-swallowing
  temperature_feel,  // cold | neutral | warming | burning
  sound              // string or null
}
```

Inputs available per ingredient: `color_base`, `color_secondary`, `aroma_notes` (note +
position top/heart/base), `taste_profile`, `texture`, `temperature_feel`, `luminosity`,
`motion_tendency`, `sound`, `aesthetic_weight`, plus `compound_classes` (with concentration)
and `ph_contribution`. Plus pipeline weights: `presence_weight`, `aesthetic_weight`,
`effective_potency`. Plus `context.solvent` (has `base_ph`, `aesthetic_base`) and the
fictional scalars.

## Three structural decisions to settle first (proposed; confirm with the user)

1. **A new `SensoryRule`, placed just before `SignatureTransformRule`** (pipeline grows to
   nine rules; new ADR, call it ADR-008). It computes the base sensory output. The fictional
   overlays fill the deferred sites inside `SignatureTransformRule`, not a second sensory pass.
   This mirrors how base effects are materialized by EffectsRule and transformed by
   SignatureTransformRule.
2. **Contribution weighting:** scale each ingredient's sensory contribution by
   `presence_weight * aesthetic_weight`. Presence for "is it physically there" (insoluble
   ingredients still color and scent the mix), aesthetic for "how much it dominates the character."
3. **Determinism:** base sensory is fully deterministic from the data. The only randomness is
   Prism's iridescent secondary, which already uses the seeded PRNG in SignatureTransformRule.
   Do not add new PRNG streams. Never use `Math.random()`.

## Sub-algorithms to design (each needs a concrete, testable method)

- **Color** (the meatiest): the weighted subtractive blend (decide CMY-space weighted mix vs a
  simpler RGB average), then the reactive shifts from `docs/design-reference.md`: `tannin`-heavy
  amber/brown shift, `oxide` + `tannin` black shift (iron-gall ink logic), `flavonoid` + low pH
  red shift / high pH blue-green shift (anthocyanin). This forces a **pH sub-decision**: there is
  no pHRule (it is a v2 hook), so define combination pH here, likely `solvent.base_ph` plus a
  weighted sum of ingredient `ph_contribution`, for the flavonoid shift.
- **Aroma:** merge each ingredient's notes by top/heart/base position across ingredients. Decide
  weighting (by contribution weight), dedupe, and whether to cap the number of notes per position.
  Prism later expands notes per `synergy_scope_multiplier`.
- **Taste:** weighted average across the 8 dimensions. Antagonistic masking (bitter masks sweet)
  is explicitly deferred to v2 / a FlavorBalanceRule. This one is the least contentious.
- **Texture:** dominant texture by contribution weight, with a rule for what counts as clashing
  (for example viscous vs thin, oily vs crystalline) producing a "separates / does not blend"
  result.
- **Motion:** the fuzziest. Pick a `motion_tendency` from density gradient, reaction activity,
  base ingredient tendencies, with `seeking` unlocked by Aberrant/Pneuma content. Needs a concrete
  scoring or priority model.
- **Scalars** (`luminosity`, `temperature_feel`, `sound`): dominant or weighted selection.
  `temperature_feel` can also read `warming`/`cooling` presence. Luminosity is later adjusted by
  the fictional overlays.

## Fictional overlays (implement inside SignatureTransformRule, filling its deferred sites)

- **Ichor:** shift `color_base` toward gold, default `color_secondary` to `#FFD700` if empty,
  boost luminosity from dull/glossy to phosphorescent.
- **Prism:** iridescent quality on `color_base`, generate an iridescent `color_secondary` via the
  seeded PRNG, force luminosity to phosphorescent, expand aroma notes per `synergy_scope_multiplier`.
- **Lacuna:** progressive erasure driven by `sensory_erasure_count`: 1 luminosity dulled, 2 color
  desaturated, 3 aroma flattened, 4 texture generic, 5 motion still, 6+ taste muted.

## Suggested sequence

Design and implement in this order, one sub-algorithm at a time into `docs/sensory.md` and then
`SensoryRule`: color first (most specified, and it pulls in the pH decision), then taste and the
scalars (quick wins), then aroma, texture, and motion, then the fictional overlays in
SignatureTransformRule. Add `sensory_output` to `BrewingContext`, register `SensoryRule` in
`buildRules` before `signature-transform`, and serialize `sensory_output` in the combinations
route (it currently returns `null`).

## Working-style reminders (from CLAUDE.md)

- Doc-first, then implement with tests: known-case tests plus fast-check invariants, same as the
  existing rules. Run typecheck, eslint, prettier, and the full vitest suite before committing.
- Present 2 to 4 options with tradeoffs for real choices; wait for a green light before producing
  large amounts of code.
- No em dashes anywhere, including docs and comments. Deterministic seeded PRNG only. Rules take a
  context and return a context; no HTTP or DB coupling in rule code.
- Reuse the test fixtures in `tests/support/fixtures.ts` (extend `makeIngredient` etc. as needed).
