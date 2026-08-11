# Effects Model: Design Reference

How a combination produces its `effects`: the experiential outcomes a preparation has on
whoever uses it. This is the missing piece the fictional-solvent layer depends on, and it
is the source of `combination.effects` in the API response.

This document is canonical for the effects model. Where it conflicts with the older
Effect Schema stub in `design-reference.md`, this document wins, and that stub should be
backported.

---

## Core principle: effects are tag-driven

An ingredient's base effects are derived from the interaction tags it already carries. No
new per-ingredient authoring is required. A small authored mapping says which tags produce
which effects; an ingredient produces the effects its effect-producing tags imply.

This choice follows the project thesis that tags are the behavioral vocabulary ("what an
ingredient does") and that fictional and real ingredients run the same algorithm. Real
ingredients are the primary effect producers: ginger's `warming` produces a warming
sensation, rosemary's `mnemonic` produces memory recall, valerian's `sedative-amplifier`
produces sedation.

Two related ideas are kept separate:

- **The base effect vocabulary** is the set of effects that effect-producing tags yield.
- **`effect_subtractive_equivalents`** is a partial overlay used only by Lacuna. It maps
  the effects that have a subtractive form. Effects without one simply do not transmute.

---

## Where effects are shaped in the pipeline

Effects are influenced by the interaction rules, but they are materialized once, after the
dose curve is resolved. The reasoning:

- **Antagonism and synergy already shape effects through the weights.** Antagonism reduces
  `chemical_extraction_weight`; synergy raises `potency_multiplier`. Both flow into
  `effective_potency` at DoseCurveRule. A canceled ingredient ends up with low effective
  potency and therefore a weak or absent effect; a synergized one ends up stronger. No
  effect object needs to be threaded through those rules for magnitude.
- **The dose curve decides whether an effect exists at all.** A `threshold`-inactive
  ingredient contributes nothing, so it must produce no effect. A `hormetic`-flipped
  ingredient has turned harmful. That state does not exist until after DoseCurveRule, so
  materializing effects any earlier would be wrong.
- **Synergy does create effects that weights cannot express.** Curated complementary pairs
  unlock emergent effects (for example `boundary-thinner` + `dream-inducer` unlocks lucid
  dreaming). That is a genuine synergy contribution, carried as intent from SynergyRule and
  realized in EffectsRule.

So the interaction rules shape effects (through weights and emergent-effect intent), and a
single **EffectsRule** materializes them at the first point where the dose state is final.

### Updated pipeline

EffectsRule is a new rule inserted immediately after DoseCurveRule, as close to the
interaction rules as dose-curve correctness allows. The pipeline grows from seven rules to
eight:

```
SolventMatchRule
AntagonismRule
SynergyRule
DoseCurveRule
EffectsRule          ← new
StabilityRule
ToxicityRule
SignatureTransformRule
```

StabilityRule and ToxicityRule do not read materialized effects. ToxicityRule already reads
`lacuna_transmute_markers`, which SynergyRule pass 2 produces (see Synergy coupling below),
so the ordering holds.

---

## Effect Schema

Each effect is an instance attached to `context.effects`.

| Field | Type | Set by | Notes |
| --- | --- | --- | --- |
| `id` | string | EffectsRule | Stable within the combination |
| `sourceIngredientId` | string, nullable | EffectsRule | The producing ingredient; null for emergent (pair-produced) effects |
| `type` | effect-type enum | EffectsRule | From the vocabulary; changed to a subtractive type by Lacuna |
| `domain` | effect-domain enum | EffectsRule | Routes psychic vs sensory toxicity; drives Lacuna markers |
| `descriptor` | string | EffectsRule | Default from vocabulary; elevated by Ichor, refracted by Prism, transmuted by Lacuna |
| `magnitude` | float | EffectsRule | The source ingredient's `effective_potency` (0 for emergent, or the pair's combined potency) |
| `emergent` | boolean | EffectsRule | True for synergy-unlocked effects |
| `subtractive` | boolean | SignatureTransformRule (Lacuna) | Set true when transmuted |
| `refracted` | boolean | SignatureTransformRule (Prism) | Set true on a duplicated effect |
| `duration` | `normal` \| `extended` \| `permanent` | SignatureTransformRule (Lacuna) | Extended/permanent from `permanence_scale` |
| `reversible` | boolean | SignatureTransformRule (Lacuna) | Set false when permanent |

`magnitude` is not in the older stub. It is added so downstream description and ordering can
rank effects by strength. `domain` is added so the effect carries its own toxicity-routing
and Lacuna classification rather than recomputing it.

---

## Effect vocabulary (v1)

The vocabulary is tiered. The **transmutable core** is the ten effects Lacuna can transmute
(each has a subtractive equivalent). The **additional experiential effects** are produced by
further effect-producing tags but have no subtractive form yet, so they pass through Lacuna
unchanged. Every type is producible by a tag that ingredients carry.

### Transmutable core

| Effect type | Domain | Default descriptor | Subtractive equivalent |
| --- | --- | --- | --- |
| `memory_recall` | memory | vivid recollection | `memory_erasure` |
| `sedation` | emotion | spreading calm | `emotional_absence` |
| `stimulation` | sensation | quickened energy | `motivational_erasure` |
| `perceptual_enhancement` | perception | heightened perception | `sensory_removal` |
| `dream_enhancement` | perception | deepened dreaming | `dream_erasure` |
| `time_dilation` | time | stretched time | `time_erasure` |
| `warming_sensation` | sensation | inner warmth | `warmth_absence` |
| `cooling_sensation` | sensation | cooling clarity | `coolness_absence` |
| `emotional_amplification` | emotion | amplified feeling | `emotional_muting` |
| `concealment` | other | drawn concealment | `unfindability` |

### Additional experiential effects

Produced by building/experiential tags that were previously treated as modifiers, plus two
natively subtractive effects (`memory_erasure`, `imposed_silence`) produced by removal tags.
None has a subtractive equivalent, so Lacuna leaves them unchanged.

| Effect type | Domain | Default descriptor | Nature |
| --- | --- | --- | --- |
| `boundary_dissolution` | identity | loosened self-boundary | building |
| `echo_capture` | identity | captured resonance | building |
| `revelation` | perception | pierced concealment | building |
| `disinhibition` | emotion | loosened restraint | building |
| `attraction` | other | drawing pull | building |
| `memory_erasure` | memory | clean forgetting | natively subtractive |
| `imposed_silence` | sound | removed hearing | natively subtractive |

`memory_erasure` appears in both tables: it is the subtractive equivalent of `memory_recall`
(produced by Lacuna transmutation) and also a base effect an `amnesiac` ingredient produces
directly under any solvent.

The domains match the sets ToxicityRule already uses: `memory`, `emotion`, `identity` route to
psychic; `sight`, `sound`, `perception`, `sensation` route to sensory; `time` and `other` route
to neither. The additional effects carry no subtractive equivalents, so they generate no Lacuna
transmute markers and do not double-count against the tag-interaction toxicity ToxicityRule
already computes. Further expansion (physical/medicinal effects, subtractive forms for the
additional effects) is a v2 authoring task and requires only new rows, not new code.

---

## Effect-producing tag mapping (v1)

The authored mapping from a tag to the base effect it produces. Amplifier tags are their own
producers: `stimulant-amplifier` both produces `stimulation` and (via SynergyRule Pattern 3)
amplifies other stimulation producers.

| Tag | Produces |
| --- | --- |
| `mnemonic` | `memory_recall` |
| `sedative-amplifier` | `sedation` |
| `stimulant-amplifier` | `stimulation` |
| `hallucinogenic-amplifier` | `perceptual_enhancement` |
| `perception-shifter` | `perceptual_enhancement` |
| `dream-inducer` | `dream_enhancement` |
| `time-dilator` | `time_dilation` |
| `warming` | `warming_sensation` |
| `cooling` | `cooling_sensation` |
| `resonance-tuner` | `emotional_amplification` |
| `veil-drawer` | `concealment` |
| `boundary-thinner` | `boundary_dissolution` |
| `echo-binder` | `echo_capture` |
| `veil-piercer` | `revelation` |
| `disinhibitor` | `disinhibition` |
| `magnetizer` | `attraction` |
| `amnesiac` | `memory_erasure` |
| `silencer` | `imposed_silence` |

Two tags (`hallucinogenic-amplifier`, `perception-shifter`) map to the same effect type. That
is intentional: they are different routes to enhanced perception, and it lets Pattern 3's
`hallucinogenic-amplifier` amplify `perception-shifter` ingredients cleanly.

The tags that still produce no base effect are of two kinds. **Mechanical tags** (`binder`,
`emulsifier`, `preservative`, `chelator`, `stabilizer`, `bioavailability-booster`, and so on)
shape chemistry and stability, not experience. **Defensive and anchor tags** (`reality-anchor`,
`boundary-sealer`, `lucidity-guard`, `will-fortifier`, `moment-anchor`, `echo-dampener`,
`repeller`, `concentrator`, `diffuser`) suppress or bound other effects rather than producing
their own; they are the anchoring counterparts of producing tags and are correctly modeled as
modifiers, not producers. Both groups can gain base effects later by adding a row, with no code
change.

---

## Effect-target resolution (closes the parked gap)

SynergyRule Pattern 3 has effect-target tags that target "stimulant-effect ingredients" and
the like. This was parked because ingredients had no effect data. The tag mapping closes it
without an ordering problem: an ingredient "produces effect E" exactly when it carries a tag
that maps to E. Pattern 3 resolves its targets through the same mapping, at synergy time, with
no materialized effects required.

The effect-target labels map to effect types:

| Effect-target label | Effect type |
| --- | --- |
| `stimulant-effect` | `stimulation` |
| `sedative-effect` | `sedation` |
| `perceptual-effect` | `perceptual_enhancement` |
| `memory-effect` | `memory_recall` |
| `warming-effect` | `warming_sensation` |
| `cooling-effect` | `cooling_sensation` |

So `stimulant-amplifier` (effect-target `stimulant-effect`) boosts any ingredient carrying a
tag that produces `stimulation`.

---

## EffectsRule specification

**Position:** fifth, after DoseCurveRule, before StabilityRule.

**Inputs:** each ingredient's tags, `dose_state`, `effective_potency`; the tag→effect mapping
and effect vocabulary; the synergy emergent-effect intents on the context.

**Outputs:** `context.effects` populated. No failure states.

### Suppression by dose state

An ingredient produces its effects only when the dose curve let it act:

- `threshold_inactive` or `effective_potency <= 0`: produces no effect (the ingredient did
  not manifest, or turned harmful; harm is captured in toxicity).
- Otherwise: produces its effects at `magnitude = effective_potency`.

### Phases

```
function EffectsRule(context):
  effects = []

  // Phase 1: per-ingredient base effects
  for each I in context.ingredients:
    if I.weight_data.dose_state == 'threshold_inactive': continue
    if I.weight_data.effective_potency <= 0: continue
    for each tag in (I.synergy_tags ∪ I.antagonist_tags):
      effect_type = tag_produces_effect[tag]
      if effect_type is null: continue
      def = effect_vocabulary[effect_type]
      effects.push({
        id: newId(),
        sourceIngredientId: I.id,
        type: effect_type,
        domain: def.domain,
        descriptor: def.default_descriptor,
        magnitude: I.weight_data.effective_potency,
        emergent: false,
        subtractive: false, refracted: false,
        duration: 'normal', reversible: true
      })

  // Phase 2: emergent effects unlocked by synergy
  for each intent in context.emergent_effects:
    def = effect_vocabulary[intent.effect_type]
    effects.push({
      id: newId(),
      sourceIngredientId: null,
      type: intent.effect_type,
      domain: def.domain,
      descriptor: def.default_descriptor,
      magnitude: intent.magnitude,
      emergent: true,
      subtractive: false, refracted: false,
      duration: 'normal', reversible: true
    })

  context.effects = effects
  return context
```

Multiplicity is intentional: two ingredients that both carry `mnemonic` produce two
`memory_recall` effects with different `sourceIngredientId`s. That matters for Lacuna, which
transmutes per source, and for description, which can name each contribution.

---

## Synergy coupling (what SynergyRule pass 2 must produce)

EffectsRule and the fictional layer depend on SynergyRule pass 2, which is still deferred.
This model pins down exactly what it must write, all of it derivable from tags and pairs
without materialized effects:

- **`context.emergent_effects`**: for each curated complementary pair that fires and names an
  unlocked effect, an intent `{ effect_type, magnitude }`. `magnitude` is the pair's combined
  potency contribution.
- **`context.synergy_scope_multiplier`** (Prism): the count of synergies that fired.
- **`context.sensory_erasure_count`** (Lacuna): the count of synergies that fired.
- **`context.permanence_scale`** (Lacuna): from cumulative synergy strength.
- **`context.lacuna_transmute_markers`** (Lacuna): one per (ingredient, effect-producing tag)
  whose effect has a subtractive equivalent: `{ ingredient_id, original_effect,
  transmuted_effect, effect_domain }`. ToxicityRule already reads these.

Curated complementary pairs gain an `unlocks_effect` field (nullable) so a pair can name the
emergent effect it produces.

---

## Fictional overlays (consumed by SignatureTransformRule)

SignatureTransformRule (rule 8, still deferred) reads `context.effects` and transforms them
per solvent. Summarized here so EffectsRule produces the right shape:

- **Ichor** elevates each effect's `descriptor` (you become more).
- **Prism** duplicates and refracts effects, setting `refracted = true` on the copies, scaled
  by `synergy_scope_multiplier`.
- **Lacuna** transmutes each effect whose type has a subtractive equivalent: `type` becomes the
  equivalent, `subtractive = true`, `descriptor` becomes the transmuted form. Then, from
  `permanence_scale`, it sets `duration` to `extended` or `permanent` and `reversible = false`
  when permanent. Effects with no subtractive equivalent pass through unchanged.

Grounded solvents skip SignatureTransformRule, so their effects are the base effects as
materialized.

---

## Data and seed additions

Consistent with keeping static vocabulary in DB tables:

- **`effect_definitions`** (new table, `seed/tables/effect_definitions.json`): the vocabulary,
  `{ type, domain, default_descriptor }`.
- **`tag_definitions.produces_effect`** (new nullable column): the tag→effect mapping.
- **`synergy_pairs.unlocks_effect`** (new nullable column): emergent effect for a complementary
  pair.
- **`effect_subtractive_equivalents`** (exists): the Lacuna overlay, unchanged.

The effect-target label to effect-type mapping is small and fixed; it can live as a constant in
the rule, like the Lacuna subtractive/building classification in DoseCurveRule.

---

## Design notes

**Why one EffectsRule rather than threading effects through every rule:** the doc's "effects
produced across rules" is satisfied in substance without the surface area. Antagonism and
synergy influence arrives through the weights, synergy's unique contribution (emergent effects)
arrives as intent, and the dose curve gates existence. Materializing once, after the dose curve,
keeps mutation in a single place and guarantees effects reflect the final numeric state.

**Why effects are gated by dose state:** an effect that never activated is not a real outcome. A
`threshold`-inactive sedative produces no calm; a flipped hormetic produces harm, not its
intended effect. Tying effect existence to `dose_state` keeps the experiential layer honest to
the chemistry layer.

**Why the vocabulary is tiered:** the transmutable core is exactly the effects with a subtractive
form, so Lacuna's overlay stays total over that set. The additional experiential effects extend
coverage to more of the tags real ingredients carry (so `boundary-thinner`, `disinhibitor`,
`amnesiac`, and the rest register as felt outcomes) without forcing a matching subtractive form
for each; those simply pass through Lacuna. This keeps the core clean while letting the felt
vocabulary grow tag by tag. Defensive and anchor tags remain non-producers on purpose: they are
the bounding counterparts to producing tags, and their contribution is suppression, not a felt
effect of their own.

**Why amplifier tags are their own producers:** it avoids needing a separate "base stimulant"
tag. An amplifier produces its effect and, through Pattern 3, strengthens other producers of the
same effect. One tag, two consistent roles.

**Why emergent effects are separate from per-ingredient effects:** a lucid-dreaming effect from
`boundary-thinner` + `dream-inducer` belongs to neither ingredient alone. Marking it `emergent`
with a null source records that it came from the combination, which the description layer can
surface honestly.

---

## ADR proposal

**ADR-007: EffectsRule and the eight-rule pipeline.** Add EffectsRule as a distinct rule after
DoseCurveRule. Effects are materialized once, from tags gated by dose state plus synergy emergent
intents. Rationale: interaction influence already flows through the weights, dose state must gate
effect existence, and a single materialization point is simpler and more testable than a mutable
effects array threaded through five rules. Consequence: the canonical pipeline is eight rules, not
seven; SynergyRule pass 2's responsibilities are fixed to the scalar and marker outputs listed
above, with no direct effect mutation.

---

## Open questions

- **Emergent effect magnitude.** Defined here as the pair's combined potency contribution. The
  exact formula should be settled when SynergyRule pass 2 is built.
- **Lacuna on effects with no subtractive equivalent.** This model passes them through unchanged.
  The alternative is dropping them (absence has nothing to transmute). Pass-through is the safer
  default; revisit when SignatureTransformRule is built.
- **Descriptor authoring.** Default descriptors here are first-pass. Voice-of-apothecary polish
  belongs with the description algorithm (Phase 10).
