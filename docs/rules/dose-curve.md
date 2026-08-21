<!-- Rule 4 of 9. Part of the rules pipeline; see ../design-reference.md for the
     pipeline overview and ./README.md for the full rule list. -->

# DoseCurveRule

The fourth rule in the combination pipeline. Evaluates each ingredient's dose-response behavior against the cumulative compound-class load in the combination, applying threshold, ceiling, and hormetic-flip mechanics.

---

## Purpose

Model real dose-response chemistry — the way ingredients behave differently at different concentrations of shared compounds. Even without user-controlled dosage (v2), stacking multiple ingredients that share compound classes creates cumulative load that dose curves respond to.

Runs after SynergyRule (so amplified potencies feed into the evaluation) and before StabilityRule (so dose-driven potency shifts inform stability calculations).

**Core insight:** an ingredient with `dose_response: hormetic` doesn't check its own concentration in isolation — it checks the _total load of its shared compound classes_ across all ingredients in the combination. Three alkaloid-bearing ingredients stacked together create combined alkaloid load; the hormetic ingredient responds to that combined level, not just its own contribution.

## Pipeline Position

```
→ SolventMatchRule
→ AntagonismRule
→ SynergyRule
→ DoseCurveRule       ← this rule
→ StabilityRule
→ ToxicityRule
→ SignatureTransformRule
```

---

## Inputs

Reads from `context`:

- `context.ingredients`: `CombinationIngredient` wrappers with post-synergy weight data
- Each ingredient's `compound_classes` (many-to-many with concentration weights from join table), `dose_response`, `potency_base`
- Each ingredient's authored dose-curve fields: `hormetic_threshold`, `activation_threshold`, `ceiling_value` (nullable: defaults if not authored)
- `context.solvent`: for fictional solvent signature behavior
- Each ingredient's `synergy_tags` and `antagonist_tags`: for Lacuna's bidirectional classification
- The combination's seeded PRNG (used by Prism for dose-response refraction)

## Outputs

Writes to `context`:

- Each ingredient's `weight_data.effective_potency`: final potency contribution after dose-curve evaluation (may be negative)
- Each ingredient's `weight_data.dose_state`: classification of dose-curve outcome
- `context.cumulative_loads`: Map<compound_class, float> for reference by downstream rules
- Appends warnings for notable dose-curve behaviors

On failure, writes:

- `context.failed = true`
- `context.failure_reason = 'extraction_impossible'`: when hormetic cascade net-negates the combination

---

## The Four Dose Response Types

Each ingredient carries a `dose_response` enum value describing how it responds to increasing cumulative load.

|Type|Behavior|
|---|---|
|`linear`|Potency scales cleanly with contribution. No special behavior. Default for most ingredients.|
|`hormetic`|Small cumulative load is beneficial; large load flips to harmful. Real chemistry: alcohol, exercise stress, low-dose stimulants, capsaicin all show this pattern.|
|`threshold`|No effect until cumulative load passes an activation threshold, then contributes full potency. Real chemistry: minimum-effective-dose behavior.|
|`ceiling`|Effect caps regardless of how much is added. Real chemistry: receptor saturation, many analgesics.|

---

## Cumulative Load Calculation

Compound load is measured _per compound class_, not per ingredient. This is the critical piece — dose curves react to how much of a specific compound class is present in the combination, not how many ingredients contribute to it.

For each compound class `C` present in the combination:

```
cumulative_load[C] = sum over all ingredients I where C in I.compound_classes of:
  I.weight_data.chemical_extraction_weight ×
  I.weight_data.potency_multiplier ×
  I.ingredient.potency_base ×
  I.ingredient_compounds[C].concentration
```

Every factor matters:

- `chemical_extraction_weight`: how much of I actually extracted (from SolventMatchRule + AntagonismRule)
- `potency_multiplier`: synergy amplification (from SynergyRule)
- `potency_base`: the ingredient's inherent strength (1–10)
- `concentration`: how much of compound C is in ingredient I (from `ingredient_compounds` join table)

The result is a per-compound-class map: `{ alkaloid: 4.7, mineral-salt: 1.2, tannin: 3.1, ... }`

**Effective load per ingredient:** for each ingredient, the effective load it responds to is the _maximum_ cumulative_load across all its compound classes. This represents the "highest concentration environment" the ingredient is in.

```
effective_load(I) = max(cumulative_load[C] for C in I.compound_classes)
```

---

## Applying Dose Curves Per Ingredient

For each ingredient, apply its `dose_response` type against its `effective_load` and its authored (or default) threshold/ceiling values.

### `linear`: baseline

```
effective_potency = chemical_extraction_weight × potency_multiplier × potency_base
dose_state = 'linear'
```

No modification. Baseline behavior.

### `hormetic`: beneficial-then-harmful

```
if effective_load <= hormetic_threshold:
  effective_potency = chemical_extraction_weight × potency_multiplier × potency_base
  dose_state = 'hormetic_beneficial'
else:
  // Flip: contribution inverts to harm
  effective_potency = -(chemical_extraction_weight × potency_multiplier × potency_base) × flip_severity
  dose_state = 'hormetic_harmful'
  warnings.push(ingredient.name + ' hormetic flip — becomes harmful at high cumulative load')
```

Where `flip_severity`:

- **0.5** under grounded solvents (harm is significant but not equal-magnitude to the benefit)
- **0.7** under any fictional solvent (Ichor, Prism, Lacuna: flips hit harder in fictional contexts)

### `threshold`: activation-required

```
if effective_load >= activation_threshold:
  effective_potency = chemical_extraction_weight × potency_multiplier × potency_base
  dose_state = 'threshold_active'
else:
  effective_potency = 0
  dose_state = 'threshold_inactive'
  warnings.push(ingredient.name + ' threshold not met — inactive at current load')
```

Threshold ingredients contribute nothing until the environment reaches sufficient concentration.

### `ceiling`: capped

```
uncapped_potency = chemical_extraction_weight × potency_multiplier × potency_base
if uncapped_potency <= ceiling_value:
  effective_potency = uncapped_potency
  dose_state = 'ceiling_below'
else:
  effective_potency = ceiling_value
  dose_state = 'ceiling_hit'
  warnings.push(ingredient.name + ' ceiling reached — additional contribution has no effect')
```

Ceiling ingredients cap out — adding more doesn't help.

---

## Hormetic Cascade Failure

If enough ingredients flip hormetic simultaneously and negative potency exceeds positive potency, the combination has net-harmed itself.

```
after all dose curves applied:
  total_positive = sum of effective_potency values where > 0
  total_negative = sum of |effective_potency| values where < 0

  if total_negative > total_positive and not is_fictional_solvent:
    fail(context, 'extraction_impossible')
```

Rare (requires multiple hormetic ingredients and heavy stacking), but real. The user-facing message: "the ingredients overwhelm each other at these concentrations."

**Fictional solvents bypass this check.** Ichor, Prism, and Lacuna all produce _something_ even from net-negative combinations, per their signatures — the transformation itself makes the result meaningful.

---

## Default Threshold/Ceiling Values

Ingredients that don't have authored values use these defaults:

|Dose response|Default value|
|---|---|
|`hormetic`|`hormetic_threshold: 5.0`|
|`threshold`|`activation_threshold: 3.0`|
|`ceiling`|`ceiling_value: 4.0`|

These need to be nullable fields on the ingredient schema (see Cross-Rule Updates section). Linear-response ingredients have no threshold/ceiling values.

Values will be tuned during real seed data authoring — these are placeholder defaults for v1.

---

## Fictional Solvent Signatures

Each fictional solvent expresses its identity by modifying how dose curves behave.

### Ichor: permissive dose curves

Everything Ichor touches gets more room to work. Beneficial effects work harder before hitting limits; when things flip, they flip harder.

|Modifier|Value|Applied to|
|---|---|---|
|`hormetic_threshold`|+2.0|All `hormetic` ingredients|
|`ceiling_value`|+1.5|All `ceiling` ingredients|
|`activation_threshold`|-1.0|All `threshold` ingredients (activates more easily)|
|`hormetic_flip_severity`|0.7|When flips occur, they're more punishing|

**Modifiers are additive to authored values.** An ingredient with authored `hormetic_threshold: 6.0` becomes `8.0` under Ichor.

**Narrative reading:** Ichor makes ingredients more of what they are — good and bad. High-stakes solvent that rewards competence and punishes recklessness harder than grounded solvents.

### Prism: refracted response types

Prism changes _what dose response an ingredient has_ via seeded random. This is genuinely on-brand for refractive-alteration: the ingredient's fundamental behavior shifts, not just its numbers.

**Mechanic:**

At the start of DoseCurveRule under Prism, each ingredient's `dose_response` gets refracted through the seeded PRNG:

```
for each ingredient I:
  roll = prng.next()  // 0.0-1.0
  refracted_response = refractDoseResponse(I.ingredient.dose_response, roll)
```

**Refraction table**: probabilities of shifting to another response type:

|Original|Stays same|→ linear|→ hormetic|→ threshold|→ ceiling|
|---|---|---|---|---|---|
|`linear`|40%|—|20%|20%|20%|
|`hormetic`|40%|20%|—|20%|20%|
|`threshold`|40%|20%|20%|—|20%|
|`ceiling`|40%|20%|20%|20%|—|

40% chance of staying the same; 20% chance each for the three other types.

**Threshold/ceiling values are unchanged under Prism**: the _type_ of curve shifts, but the values it uses are the ingredient's authored values (or defaults). Prism transforms behavior; it doesn't amplify or diminish quantities.

**`hormetic_flip_severity` is 0.7 under Prism** (per the fictional-solvent rule).

**Narrative reading:** the same ingredient behaves differently under Prism each time — you can't predict its response. Linear ingredients might suddenly show threshold behavior; hormetic ingredients might behave like ceiling-capped ones. The refraction happens deterministically per combination (seeded), so the same recipe always produces the same refraction.

### Lacuna: bidirectional dose curves

Lacuna specializes rather than punishes uniformly. Subtractive ingredients are _rewarded_ with permissive dose curves; building ingredients are _penalized_ with hostile ones; neutral ingredients are unaffected.

**Detection: subtractive vs. building classification**

An ingredient qualifies as _subtractive_ if it has any tag in `subtractive_tags`. It qualifies as _building_ if it has any tag in `building_tags`. If it has neither (or both), it's _neutral_.

**Subtractive tags** (Lacuna rewards these):

```
amnesiac, echo-dampener, veil-drawer, silencer, moment-anchor,
lucidity-guard, boundary-sealer, reality-anchor, concentrator,
chelator, stabilizer, preservative, repeller, will-fortifier,
cooling, desiccant, bioavailability-inhibitor, denaturant,
separator, loosener
```

**Building tags** (Lacuna penalizes these):

```
mnemonic, echo-binder, veil-piercer, boundary-thinner,
hallucinogenic-amplifier, stimulant-amplifier, sedative-amplifier,
bioavailability-booster, warming, emulsifier, binder,
acid-releaser, alkalizer, dream-inducer, magnetizer,
disinhibitor, diffuser, deliquescent, time-dilator,
volatile-fixer, volatile-releaser, accelerant
```

**Modifiers by classification:**

|Classification|Hormetic threshold|Ceiling|Activation threshold|
|---|---|---|---|
|Subtractive|+2.0|+1.5|-1.0|
|Building|-2.0|-1.5|+1.5|
|Neutral|no change|no change|no change|

**`hormetic_flip_severity` is 0.7 under Lacuna** (per the fictional-solvent rule) regardless of classification. Both subtractive and building ingredients flip harder when they do flip; subtractive ingredients just flip less often because their thresholds are higher.

**Ambiguity resolution:** an ingredient with _both_ subtractive and building tags is neutral for dose-curve purposes. The classifications cancel.

**Narrative reading:** Lacuna is a specialized tool. Using it for a "forgetting" preparation feels good — subtractive ingredients activate easily, resist flips, and cap high. Using it for a "remembering" preparation feels bad — building ingredients struggle to activate, flip easily, and cap low. The user quickly learns Lacuna's purpose through use.

---

## Sequential Structure

DoseCurveRule executes in three phases.

### Phase 1: Prism refraction (Prism only)

If the solvent is Prism, refract each ingredient's `dose_response` using the seeded PRNG. This happens before load calculation because subsequent logic depends on the (possibly-refracted) response type.

### Phase 2: Cumulative load calculation

Compute `cumulative_load[C]` for every compound class present across all ingredients. This is a single pass over all ingredients.

### Phase 3: Per-ingredient dose curve application

For each ingredient:

1. Determine effective threshold/ceiling values (authored value or default, plus fictional-solvent modifiers)
2. Compute effective load (max across ingredient's compound classes)
3. Apply the appropriate dose-curve logic based on (possibly-refracted) response type
4. Write `effective_potency` and `dose_state` to weight_data

After all ingredients processed:

### Phase 4: Hormetic cascade failure check

Run the cascade check unless the solvent is fictional.

---

## Pseudo-code

```
function DoseCurveRule(context):
  seed = deriveSeed(context)
  prng = new SeededPRNG(seed)
  solvent = context.solvent
  is_fictional = solvent.signature_transformation != null

  // Phase 1: Prism refraction
  if solvent.slug == 'prism':
    for each I in context.ingredients:
      roll = prng.next()
      I.refracted_response = refractDoseResponse(I.ingredient.dose_response, roll)
      if I.refracted_response != I.ingredient.dose_response:
        warnings.push(I.name + ' response refracted from ' + I.ingredient.dose_response + ' to ' + I.refracted_response)
  else:
    for each I in context.ingredients:
      I.refracted_response = I.ingredient.dose_response

  // Phase 2: Cumulative load calculation
  cumulative_load = new Map()
  for each I in context.ingredients:
    for each C in I.ingredient.compound_classes:
      concentration = I.ingredient.ingredient_compounds[C].concentration
      contribution = I.weight_data.chemical_extraction_weight ×
                     I.weight_data.potency_multiplier ×
                     I.ingredient.potency_base ×
                     concentration
      cumulative_load[C] = (cumulative_load[C] or 0) + contribution

  context.cumulative_loads = cumulative_load

  // Phase 3: Per-ingredient dose curve application
  flip_severity = is_fictional ? 0.7 : 0.5

  for each I in context.ingredients:
    // Determine effective thresholds
    modifiers = getSolventModifiers(solvent, I)
    hormetic_threshold = (I.ingredient.hormetic_threshold or 5.0) + modifiers.hormetic_threshold
    activation_threshold = (I.ingredient.activation_threshold or 3.0) + modifiers.activation_threshold
    ceiling_value = (I.ingredient.ceiling_value or 4.0) + modifiers.ceiling_value

    // Compute effective load
    effective_load = 0
    for each C in I.ingredient.compound_classes:
      if cumulative_load[C] > effective_load:
        effective_load = cumulative_load[C]

    // Apply dose curve based on refracted response type
    base_potency = I.weight_data.chemical_extraction_weight ×
                   I.weight_data.potency_multiplier ×
                   I.ingredient.potency_base

    switch I.refracted_response:
      case 'linear':
        I.weight_data.effective_potency = base_potency
        I.weight_data.dose_state = 'linear'

      case 'hormetic':
        if effective_load <= hormetic_threshold:
          I.weight_data.effective_potency = base_potency
          I.weight_data.dose_state = 'hormetic_beneficial'
        else:
          I.weight_data.effective_potency = -(base_potency × flip_severity)
          I.weight_data.dose_state = 'hormetic_harmful'
          warnings.push(I.name + ' hormetic flip — becomes harmful at high cumulative load')

      case 'threshold':
        if effective_load >= activation_threshold:
          I.weight_data.effective_potency = base_potency
          I.weight_data.dose_state = 'threshold_active'
        else:
          I.weight_data.effective_potency = 0
          I.weight_data.dose_state = 'threshold_inactive'
          warnings.push(I.name + ' threshold not met — inactive at current load')

      case 'ceiling':
        if base_potency <= ceiling_value:
          I.weight_data.effective_potency = base_potency
          I.weight_data.dose_state = 'ceiling_below'
        else:
          I.weight_data.effective_potency = ceiling_value
          I.weight_data.dose_state = 'ceiling_hit'
          warnings.push(I.name + ' ceiling reached — additional contribution has no effect')

  // Phase 4: Hormetic cascade failure check
  if not is_fictional:
    total_positive = sum of I.weight_data.effective_potency for I where > 0
    total_negative = sum of |I.weight_data.effective_potency| for I where < 0
    if total_negative > total_positive:
      return fail(context, 'extraction_impossible')

  return context


function getSolventModifiers(solvent, ingredient):
  if solvent.slug == 'ichor':
    return { hormetic_threshold: +2.0, ceiling_value: +1.5, activation_threshold: -1.0 }

  if solvent.slug == 'prism':
    return { hormetic_threshold: 0, ceiling_value: 0, activation_threshold: 0 }

  if solvent.slug == 'lacuna':
    classification = classifyIngredientForLacuna(ingredient)
    if classification == 'subtractive':
      return { hormetic_threshold: +2.0, ceiling_value: +1.5, activation_threshold: -1.0 }
    elif classification == 'building':
      return { hormetic_threshold: -2.0, ceiling_value: -1.5, activation_threshold: +1.5 }
    else:
      return { hormetic_threshold: 0, ceiling_value: 0, activation_threshold: 0 }

  return { hormetic_threshold: 0, ceiling_value: 0, activation_threshold: 0 }


function classifyIngredientForLacuna(ingredient):
  all_tags = ingredient.synergy_tags ∪ ingredient.antagonist_tags
  has_subtractive = any(tag in subtractive_tags for tag in all_tags)
  has_building = any(tag in building_tags for tag in all_tags)

  if has_subtractive and not has_building: return 'subtractive'
  if has_building and not has_subtractive: return 'building'
  return 'neutral'  // both or neither


function refractDoseResponse(original, roll):
  // Refraction probabilities: 40% same, 20% each other type
  if roll < 0.4:
    return original
  else:
    others = ['linear', 'hormetic', 'threshold', 'ceiling'] - [original]
    // roll 0.4-0.6 → first other, 0.6-0.8 → second, 0.8-1.0 → third
    if roll < 0.6: return others[0]
    if roll < 0.8: return others[1]
    return others[2]
```

---

## Rule Output Shape

```
context.ingredients — each ingredient's weight_data now includes:
  - effective_potency: float (may be negative for hormetic flips)
  - dose_state: enum
      ('linear' | 'hormetic_beneficial' | 'hormetic_harmful' |
       'threshold_active' | 'threshold_inactive' |
       'ceiling_below' | 'ceiling_hit')

context.cumulative_loads: Map<compound_class, float>

context.warnings — appended with dose-related notes
```

Downstream rules (StabilityRule, ToxicityRule, and the sensory algorithm) now have `effective_potency` as their primary input — the final potency contribution after all synergy, antagonism, and dose-curve evaluation.

---

## Failure Reasons

Enum values DoseCurveRule can set on `failure_reason`:

|Value|Cause|User message hint|
|---|---|---|
|`extraction_impossible`|Hormetic cascade net-negates the combination|"The ingredients overwhelm each other at these concentrations."|

---

## Design Notes

**Why cumulative load is per-compound-class rather than per-ingredient:** Real chemistry — dose curves respond to how much of a specific compound is present in the environment, not how many things are contributing to it. Three alkaloid-bearing ingredients create combined alkaloid load; a hormetic ingredient tuned to alkaloids responds to that combined level. This is the difference between "there are three ingredients" and "there is a lot of alkaloid," and the latter is what matters chemically.

**Why effective load uses max rather than sum across an ingredient's compound classes:** An ingredient with two compound classes doesn't have a "combined environment" — it has two separate compound-class environments to consider. The dose curve responds to whichever is most concentrated, because that's the environment most likely to drive the response. Averaging or summing across classes would blur meaningfully distinct concentrations.

**Why hormetic flip severity is 0.5 under grounded solvents but 0.7 under fictional:** The 0.7 under fictional solvents reflects that these solvents amplify or transform whatever they touch — including harm. Under grounded solvents, a hormetic flip is bad but bounded; under fictional solvents, it hits harder because the solvent itself makes preparations more of what they are (Ichor), less predictable in outcome (Prism), or subject to permanence (Lacuna). This ties the severity to the solvent's identity rather than making it a global constant.

**Why fictional solvents bypass the hormetic cascade failure check:** Fictional solvents guarantee a result regardless of net-negative arithmetic. Ichor produces something even from failed chemistry because divine elevation transforms; Prism produces something because refraction transmutes the failure into a different kind of result; Lacuna produces something because absence is itself a valid outcome. The failure check exists to catch "the preparation net-harms rather than helps" — a concept that doesn't apply to fictional solvents whose signatures redefine what "helps" means.

**Why Prism refracts response types rather than values:** Prism is refractive-alteration — it changes the _character_ of chemistry, not its magnitude. Amplifying or diminishing values would blur it with Ichor and Lacuna. Refracting the response type is unique to Prism: the same ingredient behaves differently under Prism from how it does under any other solvent, but not in a predictable way. This gives Prism a mechanically distinct signature that can't be mistaken for either amplification or diminution.

**Why Lacuna is bidirectional rather than uniformly penalizing:** A uniformly punishing solvent doesn't specialize — it just makes everything harder. Lacuna's identity is specifically _removal_, not _hostility_. Making its dose-curve behavior reward subtractive ingredients while penalizing building ones aligns the mechanic with the narrative: Lacuna is _very good_ at what it's for, and _very bad_ at what it isn't. Users learn its purpose through use rather than being told.

**Why default threshold/ceiling values matter:** Real seed data will tune these per-ingredient. But defaults are needed for v1 so unauthored ingredients still work through the pipeline. Setting reasonable defaults (5.0 / 3.0 / 4.0) gives a workable baseline; playtesting will surface which ingredients need different values.

**Why modifiers are additive rather than replacements:** An ingredient's authored threshold represents its individual chemistry. Solvent modifiers overlay the solvent's _signature_, not replace the ingredient's nature. This preserves per-ingredient authoring intent while letting fictional solvents apply their identities consistently.

**Why the neutral classification for Lacuna exists:** Not every tag maps cleanly to subtractive or building. Physical-transformation tags (`coagulant`, `crystallizer`, `foaming-agent`) and protective-chemistry tags (`radical-scavenger`) are process-agnostic — they don't build or subtract effects, they change physical states or protect chemistry. Treating these as neutral avoids over-classifying and keeps Lacuna's specialization focused on its actual narrative purpose.

---

## Cross-Rule Updates Required

### Update 1: Ingredient schema: new nullable fields

Add to the Reactive fields section:

```
hormetic_threshold: float, nullable, default 5.0 when dose_response = 'hormetic'
activation_threshold: float, nullable, default 3.0 when dose_response = 'threshold'
ceiling_value: float, nullable, default 4.0 when dose_response = 'ceiling'
```

All nullable — only relevant for their corresponding `dose_response` types.

### Update 2: `CombinationIngredient` weight_data: new fields

Add to the wrapper's `weight_data` object:

```
effective_potency: float (may be negative)
dose_state: enum (see rule output section for values)
```

### Update 3: Context: new field

```
context.cumulative_loads: Map<compound_class, float>
```

Written by DoseCurveRule, readable by downstream rules.

### Update 4: Design reference document

Add to the Ingredient Reactive section the three new nullable dose-curve value fields.

Add note to the Interaction Tags section that certain tags are classified as _subtractive_ or _building_ for Lacuna's dose-curve behavior. Reference this doc for the full lists.

### Update 5: No changes needed to previous rule docs

SolventMatchRule, AntagonismRule, and SynergyRule don't require any modifications. DoseCurveRule reads from their outputs cleanly.
