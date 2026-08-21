<!-- Rule 9 of 9. Part of the rules pipeline; see ../design-reference.md for the
     pipeline overview and ./README.md for the full rule list. -->

# SignatureTransformRule

The seventh and final rule in the combination pipeline. Applies the three fictional solvents' signature transformations to the resolved combination. Grounded solvents skip this rule entirely.

---

## Purpose

Layer the fictional solvents' signature transformations on top of a resolved result. This rule operates almost entirely on presentation, description, and narrative markers. Chemistry, potency, safety, and stability were finalized by earlier rules. This rule handles the "how does it manifest?" work — the visible and perceptual signatures the fictional solvents leave on the preparation and its recipient.

Runs last in the pipeline because its transformations layer on top of the resolved result rather than modifying the chemistry underneath.

## Pipeline Position

```
→ SolventMatchRule
→ AntagonismRule
→ SynergyRule
→ DoseCurveRule
→ StabilityRule
→ ToxicityRule
→ SignatureTransformRule   ← this rule
```

---

## Inputs

Reads from `context`:

- `context.solvent`: determines whether the rule does anything and which branch runs
- `context.ingredients`: for final composition context in warnings
- `context.effects`: the resolved effects (which get transformed)
- `context.sensory_output`: the resolved sensory presentation (which gets modified)
- `context.stability`, `context.stability_state`: for context in narrative wraps
- `context.toxicity`, `context.toxicity_state`: for context in narrative wraps

Lacuna-specific:

- `context.lacuna_transmute_markers`
- `context.sensory_erasure_count`
- `context.permanence_scale`

Prism-specific:

- The combination's seeded PRNG (for effect duplication selection)
- `context.synergy_scope_multiplier`

Ichor-specific:

- Aggregate potency data (already in weight_data)

## Outputs

Writes to `context`:

- Modifies `context.effects`: transformations applied per solvent
- Modifies `context.sensory_output`: final visual, aroma, texture, motion adjustments
- Adds `context.marks`: array of visible and perceptual signs left on the recipient
- Adds `context.narrative_wrap`: the framing text describing how the preparation manifests
- Appends to `context.warnings`: solvent-specific safety and consumption warnings

No failure states. By the time this rule runs, the pipeline has already validated everything upstream. Fictional solvents guarantee a result exists as part of their identity.

---

## Structure

Rather than sequential passes, this rule branches on solvent slug.

```
function SignatureTransformRule(context):
  if context.solvent.signature_transformation == null:
    return context  // grounded solvents skip

  switch context.solvent.slug:
    case 'ichor':  return applyIchorTransformation(context)
    case 'prism':  return applyPrismTransformation(context)
    case 'lacuna': return applyLacunaTransformation(context)

  return context
```

Each transformation function is independent. They don't share code except for shared utilities. This keeps the fictional solvent identities cleanly separated at the code level, which makes them easier to maintain and reason about.

---

## Ichor Transformation

Ichor's transformation is additive. Everything gets more. More color, more light, more elevated description, more visible traces, more expansive perception for the recipient.

### Sensory adjustments

```
context.sensory_output.color_base = shiftTowardGold(context.sensory_output.color_base, 0.4)
context.sensory_output.color_secondary = context.sensory_output.color_secondary or '#FFD700'

if context.sensory_output.luminosity in ['dull', 'glossy']:
  context.sensory_output.luminosity = 'phosphorescent'
```

### Effect elevation

```
for each effect in context.effects:
  effect.descriptor = elevate(effect.descriptor)
  // e.g., "calming" → "consecrating calm"
  //       "invigorating" → "transcendently invigorating"
```

### Mark computation

Ichor manifests earliest and most dramatically because it is elevation. Signs of transcendence show up quickly.

```
intensity_score = (total_potency_multiplier - ingredient_count) × 0.8 + (ingredient_count × 0.5)
mark_level = clamp(round(intensity_score / 2.5), 1, 5)

context.marks.push({
  solvent: 'ichor',
  mark_level: mark_level
})
```

The physical and perceptual manifestations per level are described in UI lore (not returned by the API), but tracked internally as guidance for consumers:

|Level|Physical (external)|Perceptual (recipient's experience)|
|---|---|---|
|1|Faint gold shimmer at edges of skin and hair|Colors seem slightly brighter|
|2|Eyes gleam gold at emotional moments; skin warms|Distant sounds come through more clearly|
|3|Persistent aureate luminosity; hair holds gold traces|Detects textures and grains normally imperceptible|
|4|Eyes constantly hold golden light; skin unmistakably shifted|Perceives colors outside normal human range|
|5|Radiant, unearthly appearance|Senses things others cannot detect at all|

### Warnings

```
if context.toxicity.somatic >= 5:
  context.warnings.push('the divine solvent amplifies harm as readily as benefit')

if mark_level >= 3:
  context.warnings.push('this preparation will produce a moderate golden mark')
if mark_level >= 4:
  context.warnings.push('this preparation will produce a significant golden mark with permanent perceptual expansion')
```

### Narrative wrap

```
context.narrative_wrap = generateIchorNarrative(context)
```

Base template (mixed with preparation-specific details):

_"The preparation shines with a light that isn't quite metaphor. Ichor holds nothing subtly. Every effect it carries is elevated, made more of itself. Consume with the understanding that divinity amplifies whatever it touches, its blessings and its costs alike."_

---

## Prism Transformation

Prism's transformation is multiplicative in dimensions, not amounts. Everything gets more varied rather than more intense.

### Sensory adjustments

```
context.sensory_output.color_base = applyIridescentQuality(context.sensory_output.color_base)
context.sensory_output.color_secondary = generateIridescentSecondary(prng)
context.sensory_output.luminosity = 'phosphorescent'  // Prism preparations always shimmer
```

### Effect duplication

Prism duplicates some effects in refracted form. Each effect has a 40% chance of duplication (per the seeded PRNG).

```
duplicated_effects = []
for each effect in context.effects:
  roll = prng.next()
  if roll < 0.4:
    refracted = generateRefractedEffect(effect)
    duplicated_effects.push(refracted)
context.effects.extend(duplicated_effects)
```

Refracted effects are marked as such and typically have a variant descriptor. If the original effect is "calming," the refracted variant might be "unsettling in a way similar to calm" or "a memory of calm rather than the sensation."

### Synergy scope widening applied to sensory output

```
if context.synergy_scope_multiplier > 0:
  context.sensory_output.aroma_notes.extend(
    generateRefractedAromaNotes(context.sensory_output.aroma_notes,
                                context.synergy_scope_multiplier, prng)
  )
```

### Mark computation

Prism sits between Lacuna and Ichor in visibility, and its manifestations reflect shifting reality.

```
intensity_score = (synergy_scope_multiplier × 1.2) + (ingredient_count × 0.4)
mark_level = clamp(round(intensity_score / 2.5), 1, 5)

context.marks.push({
  solvent: 'prism',
  mark_level: mark_level
})
```

|Level|Physical (external)|Perceptual (recipient's experience)|
|---|---|---|
|1|Occasional flicker of iridescence at hair or skin edges|Objects occasionally appear briefly doubled|
|2|Eyes catch and refract light differently depending on angle|Colors shift subtly when the recipient looks away and back|
|3|Skin shows shifting opalescent quality in bright light|Sees multiple versions of the same object depending on angle|
|4|Constant faint iridescence; features appear slightly different from different angles|Reality itself refracts; certainty of what is real weakens|
|5|Recipients seem to change between glances; identity feels unstable to observers|Perception becomes fundamentally unreliable; the recipient cannot trust their senses|

### Warnings

```
if mark_level >= 3:
  context.warnings.push('this preparation will produce a moderate iridescent mark')
if mark_level >= 4:
  context.warnings.push('this preparation will produce a significant iridescent mark with unstable perception')
```

### Narrative wrap

```
context.narrative_wrap = generatePrismNarrative(context)
```

Base template:

_"The preparation refracts. What enters as one thing emerges as another. Effects duplicate in ways the recipient may not distinguish from their original sources. Where Prism has touched, the world becomes multiple, and the recipient sees a version of themselves that isn't quite them."_

---

## Lacuna Transformation

Lacuna's transformation is subtractive across every dimension it touches. Effects become removals. Presentation mutes. The recipient becomes hard to perceive. Permanence marks make the changes irrevocable.

### Subtractive effect resolution

Apply the `lacuna_transmute_markers` set by SynergyRule as actual effect substitutions:

```
for each marker in context.lacuna_transmute_markers:
  effect = findEffectById(context.effects, marker.ingredient_id)
  if effect:
    effect.type = marker.transmuted_effect
    effect.subtractive = true
```

### Sensory muting

Progressive erasure applied based on `sensory_erasure_count` from SynergyRule:

```
applyProgressiveErasure(context.sensory_output, context.sensory_erasure_count)
```

Erasure levels (from SynergyRule):

|Erasures|Dimension muted|
|---|---|
|1|Luminosity → dulled|
|2|Color → desaturated|
|3|Aroma → flattened|
|4|Texture → generic|
|5|Motion → still|
|6+|Taste → muted|

### Permanence tagging

If the SynergyRule permanence_scale reached 2.0 or higher, subtractive effects become permanent:

```
if context.permanence_scale >= 2.0:
  for each effect in context.effects:
    if effect.subtractive:
      effect.duration = 'permanent'
      effect.reversible = false
elif context.permanence_scale >= 1.5:
  for each effect in context.effects:
    if effect.subtractive:
      effect.duration = 'extended'  // ×3 base duration
```

### Mark computation

Lacuna is the most gradual of the three fictional solvents. Marks manifest subtly at first and require intensity to reach significant levels.

```
intensity_score = (sensory_erasure_count × 1.5) + (permanence_scale × 2) + (ingredient_count × 0.3)
mark_level = clamp(round(intensity_score / 3), 1, 5)

context.marks.push({
  solvent: 'lacuna',
  mark_level: mark_level
})
```

|Level|Physical (external)|Perceptual (recipient's experience)|
|---|---|---|
|1|Hair ends paler, eyes fractionally grayer|Colors appear slightly muted|
|2|Skin has slight ashen quality|Certain colors become hard to distinguish; distant sounds fade|
|3|Voice quieter than expected; presence recedes when not directly addressed|Loses ability to perceive whole ranges of color; textures flatten|
|4|Others struggle to recall exact features moments after seeing them|Sensory palette narrows severely; taste dulls; smell fades|
|5|Hard to look at directly; the eye slides off; description afterward is difficult|Loses full senses; may permanently lose the ability to see certain colors, hear certain sounds, feel certain textures|

### Warnings

```
if any(effect.duration == 'permanent' for effect in context.effects):
  context.warnings.push('preparation carries permanent absence, consider carefully')

if mark_level >= 3:
  context.warnings.push('this preparation will produce a moderate absence mark')
if mark_level >= 4:
  context.warnings.push('this preparation will produce a significant absence mark with potentially permanent perceptual loss')
if mark_level >= 5:
  context.warnings.push('this preparation may cause irrevocable perceptual erasure')
```

### Narrative wrap

```
context.narrative_wrap = generateLacunaNarrative(context)
```

Base template:

_"Something is missing here. The preparation itself is barely present, muted and quiet and hard to describe. Its effects are absences rather than additions. The recipient loses what they consumed rather than gaining anything. Some of what is lost may never return."_

---

## Rule Output Shape

```
context.effects — modified per solvent
  Ichor: descriptors elevated
  Prism: some effects duplicated in refracted form
  Lacuna: subtractive substitutions applied; permanence tagged

context.sensory_output — modified per solvent
  Ichor: color shifted toward gold; luminosity boosted
  Prism: iridescent quality applied; aroma expanded
  Lacuna: progressive erasure applied per sensory_erasure_count

context.marks — array of one entry (the current solvent's mark)
  {
    solvent: 'ichor' | 'prism' | 'lacuna',
    mark_level: 1-5
  }

context.narrative_wrap — string, generated per solvent

context.warnings — solvent-specific warnings added
```

For grounded solvents, none of these are modified. `context.marks` stays empty. `context.narrative_wrap` remains null (or is populated by a downstream description generator outside this pipeline).

---

## Failure Reasons

None. This rule does not fail.

---

## Pseudo-code

```
function SignatureTransformRule(context):
  // Grounded solvents skip entirely
  if context.solvent.signature_transformation == null:
    return context

  switch context.solvent.slug:
    case 'ichor':  return applyIchorTransformation(context)
    case 'prism':  return applyPrismTransformation(context)
    case 'lacuna': return applyLacunaTransformation(context)

  return context


function applyIchorTransformation(context):
  // Sensory
  context.sensory_output.color_base = shiftTowardGold(context.sensory_output.color_base, 0.4)
  context.sensory_output.color_secondary = context.sensory_output.color_secondary or '#FFD700'
  if context.sensory_output.luminosity in ['dull', 'glossy']:
    context.sensory_output.luminosity = 'phosphorescent'

  // Effect elevation
  for each effect in context.effects:
    effect.descriptor = elevate(effect.descriptor)

  // Mark
  total_potency = sum(I.weight_data.potency_multiplier for I in context.ingredients)
  ingredient_count = context.ingredients.length
  intensity = (total_potency - ingredient_count) × 0.8 + (ingredient_count × 0.5)
  mark_level = clamp(round(intensity / 2.5), 1, 5)
  context.marks.push({ solvent: 'ichor', mark_level: mark_level })

  // Warnings
  if context.toxicity.somatic >= 5:
    context.warnings.push('the divine solvent amplifies harm as readily as benefit')
  if mark_level >= 3:
    context.warnings.push('this preparation will produce a moderate golden mark')
  if mark_level >= 4:
    context.warnings.push('this preparation will produce a significant golden mark with permanent perceptual expansion')

  // Narrative
  context.narrative_wrap = generateIchorNarrative(context)

  return context


function applyPrismTransformation(context):
  seed = deriveSeed(context)
  prng = new SeededPRNG(seed)

  // Sensory
  context.sensory_output.color_base = applyIridescentQuality(context.sensory_output.color_base)
  context.sensory_output.color_secondary = generateIridescentSecondary(prng)
  context.sensory_output.luminosity = 'phosphorescent'

  // Effect duplication
  duplicated_effects = []
  for each effect in context.effects:
    roll = prng.next()
    if roll < 0.4:
      refracted = generateRefractedEffect(effect)
      duplicated_effects.push(refracted)
  context.effects.extend(duplicated_effects)

  // Synergy scope aroma expansion
  if context.synergy_scope_multiplier > 0:
    context.sensory_output.aroma_notes.extend(
      generateRefractedAromaNotes(context.sensory_output.aroma_notes,
                                  context.synergy_scope_multiplier, prng)
    )

  // Mark
  ingredient_count = context.ingredients.length
  intensity = (context.synergy_scope_multiplier × 1.2) + (ingredient_count × 0.4)
  mark_level = clamp(round(intensity / 2.5), 1, 5)
  context.marks.push({ solvent: 'prism', mark_level: mark_level })

  // Warnings
  if mark_level >= 3:
    context.warnings.push('this preparation will produce a moderate iridescent mark')
  if mark_level >= 4:
    context.warnings.push('this preparation will produce a significant iridescent mark with unstable perception')

  // Narrative
  context.narrative_wrap = generatePrismNarrative(context)

  return context


function applyLacunaTransformation(context):
  // Subtractive effect resolution
  for each marker in context.lacuna_transmute_markers:
    effect = findEffectById(context.effects, marker.ingredient_id)
    if effect:
      effect.type = marker.transmuted_effect
      effect.subtractive = true

  // Sensory muting
  applyProgressiveErasure(context.sensory_output, context.sensory_erasure_count)

  // Permanence tagging
  if context.permanence_scale >= 2.0:
    for each effect in context.effects:
      if effect.subtractive:
        effect.duration = 'permanent'
        effect.reversible = false
  elif context.permanence_scale >= 1.5:
    for each effect in context.effects:
      if effect.subtractive:
        effect.duration = 'extended'

  // Mark
  ingredient_count = context.ingredients.length
  intensity = (context.sensory_erasure_count × 1.5) +
              (context.permanence_scale × 2) +
              (ingredient_count × 0.3)
  mark_level = clamp(round(intensity / 3), 1, 5)
  context.marks.push({ solvent: 'lacuna', mark_level: mark_level })

  // Warnings
  if any(effect.duration == 'permanent' for effect in context.effects):
    context.warnings.push('preparation carries permanent absence, consider carefully')
  if mark_level >= 3:
    context.warnings.push('this preparation will produce a moderate absence mark')
  if mark_level >= 4:
    context.warnings.push('this preparation will produce a significant absence mark with potentially permanent perceptual loss')
  if mark_level >= 5:
    context.warnings.push('this preparation may cause irrevocable perceptual erasure')

  // Narrative
  context.narrative_wrap = generateLacunaNarrative(context)

  return context
```

---

## Design Notes

**Why this rule is last:** The fictional solvents' signatures are transformations of a resolved result, not modifications to the chemistry that produces it. Running earlier would disturb the pipeline's determinism, because downstream rules would need to reason about post-transformation state. Keeping this rule last means every other rule operates on clean chemistry, and this rule only handles presentation and narrative.

**Why three separate branch functions rather than shared logic:** The fictional solvents have genuinely distinct mechanical philosophies. Sharing code would either force artificial commonalities or become a nest of conditionals. Independent branches keep each solvent's identity clean at the code level and make it obvious what each does. When a maintainer needs to change Ichor's behavior, they touch one function.

**Why marks are single-preparation intensity, not cumulative:** Cumulative tracking requires modeling recipients as first-class entities, which is a v2 concern. Single-preparation intensity captures the meaningful mechanic ("this preparation would produce a level 3 mark on the recipient") without requiring the pipeline to know who the recipient is. Consumers (UIs, games, tests) can accumulate marks across preparations if their use case demands it.

**Why marks are both physical and perceptual:** Limiting marks to physical appearance misses half of the mechanic. Each fictional solvent's identity has interior consequence for the recipient, not just exterior visibility. Ichor recipients see more; Prism recipients see differently; Lacuna recipients see less. Modeling both dimensions gives each solvent a richer signature that reflects its core identity through what the recipient actually experiences.

**Why narrative wraps have base templates rather than being fully procedural:** Fully procedural generation risks producing generic or nonsensical output. Base templates guarantee the wrap always has coherent voice and captures the solvent's essential character. Preparation-specific details mix into the template to make each result feel distinct without risking incoherence.

**Why Prism has effect duplication rather than modification:** Effect duplication rather than substitution reflects Prism's refractive identity. Prism does not replace what an ingredient does; it refracts the effect into an additional form that manifests alongside the original. The recipient experiences both the original effect and its refracted variant, which is more on-brand than a straight substitution would be.

**Why Ichor's mark levels are described as intensity-driven rather than usage-driven:** Framed as "how much of a preparation was consumed" rather than "how often the solvent has been used" fits the API model cleanly. A single very potent Ichor preparation produces a level 5 mark on first consumption. This treats the mark as a property of what was consumed rather than requiring cumulative tracking.

**Why Lacuna manifests most gradually:** Lacuna's identity is subtractive erasure. Aggressive first-time manifestation would work against this identity, because sudden absence is louder than gradual absence. Modeling Lacuna as the most subtle solvent, requiring more intensity to reach visible levels, means the sensation of erasure builds slowly and reads as more haunting than an immediate visible transformation would.

**Why grounded solvents skip entirely rather than getting a neutral narrative wrap:** Grounded solvent preparations get straightforward voice from downstream description generation elsewhere in the system. Adding a signature transformation for grounded solvents would create ambiguity about who owns describing preparations. Clean separation: this rule only handles fictional solvent signatures; grounded solvent preparations are described by simpler downstream systems.

---

## Cross-Rule Updates Required

### Update 1: Design reference document

Add to the Combination schema section:

```
marks: array<{
  solvent: 'ichor' | 'prism' | 'lacuna',
  mark_level: int (1-5)
}>

narrative_wrap: string, nullable
```

### Update 2: `refracted` field on effects

Add to the Effect model:

```
Effect {
  ...existing fields...
  subtractive: boolean (Lacuna-set)
  refracted: boolean (Prism-set, on duplicated effects)
  duration: 'normal' | 'extended' | 'permanent'
  reversible: boolean (Lacuna-set)
}
```

### Update 3: Sensory output erasure documentation

Add to the sensory algorithm docs (when written) a note that Lacuna's `sensory_erasure_count` triggers progressive erasure in the SignatureTransformRule, with the erasure order defined there:

- 1 → luminosity dulled
- 2 → color desaturated
- 3 → aroma flattened
- 4 → texture generic
- 5 → motion still
- 6+ → taste muted

### Update 4: No changes needed to previous rule docs

SolventMatchRule, AntagonismRule, SynergyRule, DoseCurveRule, StabilityRule, and ToxicityRule don't require modifications. SignatureTransformRule consumes their outputs and doesn't modify their behavior.
