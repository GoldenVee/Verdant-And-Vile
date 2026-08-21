<!-- Rule 6 of 9. Part of the rules pipeline; see ../design-reference.md for the
     pipeline overview and ./README.md for the full rule list. -->

# StabilityRule

The fifth rule in the combination pipeline. Computes final stability of the preparation — how many days it remains effective before decay or degradation makes it unusable.

---

## Purpose

Aggregate stability contributions from every relevant source: ingredient bases, category composition, outcome type, solvent, tags, traits, and fictional solvent signatures. Stability is the most interconnected rule in the pipeline because many things affect how long a preparation lasts.

Runs after DoseCurveRule (so effective potency is finalized and can inform stability) and before ToxicityRule.

## Pipeline Position

```
→ SolventMatchRule
→ AntagonismRule
→ SynergyRule
→ DoseCurveRule
→ StabilityRule       ← this rule
→ ToxicityRule
→ SignatureTransformRule
```

---

## Inputs

Reads from `context`:

- `context.ingredients`: with all prior weight data
- Each ingredient's `stability_base`, `synergy_tags`, `antagonist_tags`, `traits`, `category`, `aesthetic_weight`
- Each ingredient's `weight_data.presence_weight` (used rather than chemical_extraction_weight: see design notes)
- `context.solvent`: with `stability_modifier` and slug for fictional signatures
- `context.outcome`: for outcome-specific stability characteristics
- The combination's seeded PRNG (used by Prism for stability refraction; used by `mercurial` trait resolution)

## Outputs

Writes to `context`:

- `context.stability`: final stability in days (float)
- `context.stability_state`: categorization enum
- Appends warnings for notable stability behaviors

On failure, writes:

- `context.failed = true`
- `context.failure_reason = 'insufficient_stability'`: when the preparation decays before it can be used

Individual ingredients' `weight_data` is not modified by this rule. Stability is a combination-level property.

---

## The Multi-Stage Formula

Stability is computed in eight sequential stages. Each stage produces a running stability value that feeds into the next.

```
Stage 1: base_stability from weighted ingredient contributions
Stage 2: × category composition modifier
Stage 3: × outcome type modifier
Stage 4: × solvent stability_modifier
Stage 5: × tag effect multipliers
Stage 6: × trait effect modifiers
Stage 7: fictional solvent signature transformations
Stage 8: minimum stability check (may fail)
```

Each stage's contribution is defensible in isolation, which makes the whole rule testable stage-by-stage.

---

## Stage 1: Base Stability from Ingredients

Each ingredient contributes based on its `stability_base` weighted by its presence in the combination.

```
ingredient_contribution =
  ingredient.stability_base ×
  ingredient.weight_data.presence_weight ×
  ingredient.aesthetic_weight

base_stability = weighted_average(ingredient_contributions, weights=aesthetic_weights)
```

**Weighted average, not sum.** A preparation's stability is determined by composition, not accumulation. Adding more ingredients doesn't extend shelf life; the mix determines the outcome.

**Presence_weight is used (not chemical_extraction_weight)** because stability is affected by everything physically present in the preparation, not just what extracted. An insoluble ingredient still occupies space and can affect decay dynamics — activated charcoal or a mineral fragment influences the preparation's stability even without contributing chemistry.

The initial `base_stability` is in days, matching the ingredient's `stability_base` units (1–10 days baseline).

---

## Stage 2: Category Composition Modifier

Some ingredient categories are inherently more or less stable than others. The composition of categories in the combination determines this stage's modifier.

|Category|Modifier|Reasoning|
|---|---|---|
|Mineral|1.5×|Solid, resistant, largely unreactive|
|Alchemical|1.3×|Reaction products already stable|
|Cosmic|1.2×|From-elsewhere substances often preserved|
|Botanical|1.0×|Standard organic-material decay|
|Fauna Derived|1.0×|Standard organic-material decay|
|Aberrant|1.0×|Unpredictable but averages to standard|
|Fungal|0.8×|Susceptible to further decomposition|
|Pneuma|0.6×|Subtle essences dissipate|
|Effluvia|0.5×|Corrupt vapors particularly transient|

**Application:** compute a weighted average by `aesthetic_weight` of the categories present.

```
category_modifier = weighted_average(
  [category_modifiers[i.category] for i in ingredients],
  weights=[i.aesthetic_weight for i in ingredients]
)

stability *= category_modifier
```

A combination heavy in Mineral trends toward 1.5×; a combination heavy in Effluvia trends toward 0.5×; mixed combinations land between.

---

## Stage 3: Outcome Type Modifier

Different outcome forms have different intrinsic durability. Applied as a flat multiplier from `context.outcome`.

|Outcome|Modifier|Reasoning|
|---|---|---|
|Concentrate|1.5×|Dense, alcohol-heavy typically, well-preserved|
|Pellet|1.5×|Solid, low surface area|
|Powder Balls|1.5×|Dry, minimal decay pathways|
|Reduction|1.4×|Sugar/honey preservation|
|Sachet|1.4×|Dry, sealed|
|Balm|1.3×|Fat-based preservation|
|Paste|1.0×|Standard|
|Potion|1.0×|Standard liquid|
|Liniment|1.0×|Standard liquid|
|Aromatic|0.9×|Volatiles gradually escape|
|Vapors|0.7×|Highly volatile by nature|
|Veil|0.6×|Atmospheric, disperses|
|Eye Drops|0.5×|Contamination-sensitive, requires freshness|

```
stability *= outcome_modifiers[context.outcome]
```

---

## Stage 4: Solvent Stability Modifier

Applied directly from `solvent.stability_modifier`:

|Solvent|Modifier|
|---|---|
|Water|0.7×|
|Spirits|2.0×|
|Oil|1.3×|
|Vinegar|1.5×|
|Honey|3.0×|
|Ichor|0.4×|
|Prism|1.0×|
|Lacuna|5.0×|

```
stability *= context.solvent.stability_modifier
```

---

## Stage 5: Tag Effect Multipliers

Certain tags directly affect stability. Each tag multiplier applies once if any ingredient in the combination carries that tag. The aesthetic weight of the tag-bearing ingredient scales the effect:

```
scaled_multiplier = 1 + (raw_multiplier - 1) × ingredient.aesthetic_weight
stability *= scaled_multiplier
```

A preservative-tagged ingredient with `aesthetic_weight = 0.5` gives 1.3× rather than the full 1.6×.

**Multiple tags compound** (multiply together). If multiple ingredients carry the same tag, apply it once using the highest aesthetic_weight among them.

### Stability-enhancing tags

|Tag|Raw Multiplier|Notes|
|---|---|---|
|`preservative`|1.6×|Long-timescale spoilage resistance|
|`stabilizer`|1.4×|Short-timescale reaction resistance|
|`desiccant`|1.5×|Removes decay-driving moisture|
|`volatile-fixer`|1.3×|Anchors aromatics against loss|
|`chelator`|1.15×|Binds reactive minerals that would drive decay|

### Stability-reducing tags

|Tag|Raw Multiplier|Notes|
|---|---|---|
|`accelerant`|0.5×|Actively accelerates decay|
|`deliquescent`|0.6×|Absorbs moisture; wet outcomes destabilize|
|`volatile-releaser`|0.7×|Encourages evaporation of active compounds|
|`oxidizer`|0.75×|Oxidative degradation of other compounds|

---

## Stage 6: Trait Effect Modifiers

Traits affect stability with more variety than tags. Some set floors, some apply multipliers per-instance, some introduce randomness.

### Positive stability traits

**`indestructible`**: sets a _floor_ on final stability. After all other stages complete, if the combination contains any indestructible ingredient with `aesthetic_weight > 0.3`, the final stability is at least **30 days**. If already higher, no change.

```
if any(t in i.traits and i.aesthetic_weight > 0.3 for i in ingredients where 'indestructible' in i.traits):
  indestructible_floor = 30
  // Applied at end of Stage 6
```

**`carrier`**: no direct stability effect. Carrier's stability contribution is already reflected via the presence_weight and extraction boosts it provided in earlier rules.

**`quiescent`**: contributes 1.4× multiplier per quiescent ingredient in the combination. Compounds multiplicatively across ingredients.

```
for each ingredient with 'quiescent' trait:
  stability *= 1.4
```

### Negative stability traits

**`volatile`**: 0.6× multiplier per volatile ingredient, scaled by aesthetic_weight:

```
for each ingredient with 'volatile' trait:
  scaled = 1 + (0.6 - 1) × i.aesthetic_weight
  stability *= scaled
```

**`decaying`**: 0.4× multiplier + spreads decay. For each decaying ingredient in the combination:

```
scaled = 1 + (0.4 - 1) × i.aesthetic_weight
stability *= scaled

// Contamination spread: reduce presence_weight of other ingredients by 10%
// (representing decay spreading through the preparation over the effective duration)
for each other ingredient j in combination:
  j.weight_data.presence_weight *= 0.9
```

The presence_weight reduction is a side effect that other rules may consult, but doesn't affect the stability value itself.

**`explosive`**: 0.5× multiplier per explosive ingredient, scaled by aesthetic_weight.

**`mercurial`**: under Prism, refracted (see Stage 7). Under other solvents, applies seeded-random multiplier in range 0.7×–1.4×:

```
if solvent.slug != 'prism':
  mercurial_multiplier = 0.7 + prng.next() × 0.7  // uniform in [0.7, 1.4]
  stability *= mercurial_multiplier
```

### Neutral traits

`shy`, `echoic`, `catalyst` have no direct stability effect at this stage.

### Application order

Apply positive multipliers first, then negative multipliers, then the indestructible floor (if applicable).

---

## Stage 7: Fictional Solvent Signatures

Grounded solvents complete at Stage 6. Fictional solvents overlay signatures.

### Ichor

No additional stability behavior beyond the 0.4× modifier already applied in Stage 4. Ichor preparations must be used fresh — the divine solvent doesn't hold.

### Prism

Stability itself becomes variable. Apply seeded-random multiplier in range 0.7×–1.4×:

```
prism_multiplier = 0.7 + prng.next() × 0.7  // uniform in [0.7, 1.4]
stability *= prism_multiplier
warnings.push('Prism refracts stability — outcome uncertain within predicted range')
```

The same recipe under Prism always produces the same multiplier (seeded), but users can't predict it without brewing. This is the stability-side expression of Prism's refractive identity.

### Lacuna

Final stability transforms into permanence. In addition to the 5.0× modifier already applied in Stage 4:

- If final stability > 30 days: preparation counts as _effectively permanent_, `stability_state = 'indefinite'`
- If Lacuna's SynergyRule permanence_scale set effects to permanent, those effects persist even after the preparation itself would decay
- Warning: `preparation carries indefinite absence`

```
if solvent.slug == 'lacuna':
  if stability > 30:
    context.stability_state_override = 'indefinite'
  if context.permanence_scale >= 2.0:  // set by SynergyRule
    warnings.push('preparation carries indefinite absence')
```

---

## Stage 8: Minimum Stability Check

If final stability falls below **1 day** and the outcome isn't a "use-immediately" type, the preparation is too unstable to form.

```
use_immediately_outcomes = ['vapors', 'veil', 'eye-drops']
is_fictional = context.solvent.signature_transformation != null
has_indestructible = any('indestructible' in i.traits and i.aesthetic_weight > 0.3 for i in ingredients)

if stability < 1.0 and context.outcome not in use_immediately_outcomes:
  if not has_indestructible and not is_fictional:
    return fail(context, 'insufficient_stability')
```

**Vapors, Veil, and Eye Drops are exempted** because they're inherently transient — a Vapors preparation with 12-hour stability is normal and expected, not a failure.

**Fictional solvents bypass this check**: they always produce something regardless of stability arithmetic. Ichor preparations may last hours; Prism preparations may last unpredictable durations; Lacuna preparations may last forever. All valid results.

**Indestructible presence bypasses this check**: the trait's floor makes insufficient stability impossible when it applies.

---

## Stability State Categorization

After all stages, the final stability value gets a categorical label:

|State|Stability range|
|---|---|
|`critically_unstable`|< 1 day|
|`unstable`|1–7 days|
|`moderately_stable`|7–30 days|
|`stable`|30–180 days|
|`highly_stable`|180–365 days|
|`indefinite`|> 365 days OR Lacuna permanence flag OR `indestructible` present|

```
if stability_state_override:  // set by Lacuna signature
  context.stability_state = stability_state_override
elif has_indestructible:
  context.stability_state = 'indefinite'
elif stability > 365:
  context.stability_state = 'indefinite'
elif stability > 180:
  context.stability_state = 'highly_stable'
elif stability > 30:
  context.stability_state = 'stable'
elif stability > 7:
  context.stability_state = 'moderately_stable'
elif stability >= 1:
  context.stability_state = 'unstable'
else:
  context.stability_state = 'critically_unstable'
```

This gives downstream rules and the UI a categorical read on the preparation without having to interpret raw day counts.

---

## Rule Output Shape

```
context.stability: float — final stability in days
context.stability_state: enum — categorization
context.warnings — appended with stability-related notes
```

Some ingredient `weight_data.presence_weight` values may be reduced by the `decaying` trait spread mechanic in Stage 6, but this is a side effect of the trait rather than a general stability computation.

---

## Failure Reasons

Enum values StabilityRule can set on `failure_reason`:

|Value|Cause|User message hint|
|---|---|---|
|`insufficient_stability`|Final stability < 1 day for a non-transient outcome without indestructible presence|"The preparation decays before it can be used."|

---

## Pseudo-code

```
function StabilityRule(context):
  seed = deriveSeed(context)
  prng = new SeededPRNG(seed)
  solvent = context.solvent
  is_fictional = solvent.signature_transformation != null

  // Stage 1: Base stability
  ingredient_contributions = []
  weights = []
  for each I in context.ingredients:
    contribution = I.ingredient.stability_base × I.weight_data.presence_weight × I.ingredient.aesthetic_weight
    ingredient_contributions.push(contribution)
    weights.push(I.ingredient.aesthetic_weight)
  stability = weighted_average(ingredient_contributions, weights)

  // Stage 2: Category composition modifier
  category_modifiers = { mineral: 1.5, alchemical: 1.3, cosmic: 1.2, botanical: 1.0,
                         'fauna-derived': 1.0, aberrant: 1.0, fungal: 0.8, pneuma: 0.6, effluvia: 0.5 }
  category_values = [category_modifiers[I.ingredient.category] for I in context.ingredients]
  category_modifier = weighted_average(category_values, weights)
  stability *= category_modifier

  // Stage 3: Outcome modifier
  outcome_modifiers = { concentrate: 1.5, pellet: 1.5, 'powder-balls': 1.5, reduction: 1.4, sachet: 1.4,
                        balm: 1.3, paste: 1.0, potion: 1.0, liniment: 1.0, aromatic: 0.9,
                        vapors: 0.7, veil: 0.6, 'eye-drops': 0.5 }
  stability *= outcome_modifiers[context.outcome]

  // Stage 4: Solvent modifier
  stability *= solvent.stability_modifier

  // Stage 5: Tag effect multipliers
  enhancing_tags = { preservative: 1.6, stabilizer: 1.4, desiccant: 1.5, 'volatile-fixer': 1.3, chelator: 1.15 }
  reducing_tags = { accelerant: 0.5, deliquescent: 0.6, 'volatile-releaser': 0.7, oxidizer: 0.75 }

  for each tag in (enhancing_tags ∪ reducing_tags):
    // Find ingredient with highest aesthetic_weight carrying this tag
    tag_bearers = [I for I in context.ingredients if tag in I.ingredient.synergy_tags ∪ I.ingredient.antagonist_tags]
    if tag_bearers is not empty:
      highest = max(tag_bearers, key=i => i.ingredient.aesthetic_weight)
      raw = enhancing_tags[tag] or reducing_tags[tag]
      scaled = 1 + (raw - 1) × highest.ingredient.aesthetic_weight
      stability *= scaled

  // Stage 6: Trait effect modifiers
  // Positive traits
  for each I with 'quiescent' in I.ingredient.traits:
    stability *= 1.4

  // Negative traits
  for each I with 'volatile' in I.ingredient.traits:
    scaled = 1 + (0.6 - 1) × I.ingredient.aesthetic_weight
    stability *= scaled

  for each I with 'decaying' in I.ingredient.traits:
    scaled = 1 + (0.4 - 1) × I.ingredient.aesthetic_weight
    stability *= scaled
    // Contamination spread
    for each other J in context.ingredients where J != I:
      J.weight_data.presence_weight *= 0.9

  for each I with 'explosive' in I.ingredient.traits:
    scaled = 1 + (0.5 - 1) × I.ingredient.aesthetic_weight
    stability *= scaled

  // Mercurial (not under Prism)
  if solvent.slug != 'prism':
    for each I with 'mercurial' in I.ingredient.traits:
      mercurial_multiplier = 0.7 + prng.next() × 0.7
      stability *= mercurial_multiplier

  // Indestructible floor
  has_indestructible = any('indestructible' in I.ingredient.traits and I.ingredient.aesthetic_weight > 0.3
                           for I in context.ingredients)
  if has_indestructible and stability < 30:
    stability = 30

  // Stage 7: Fictional solvent signatures
  if solvent.slug == 'prism':
    prism_multiplier = 0.7 + prng.next() × 0.7
    stability *= prism_multiplier
    warnings.push('Prism refracts stability — outcome uncertain within predicted range')

  stability_state_override = null
  if solvent.slug == 'lacuna':
    if stability > 30:
      stability_state_override = 'indefinite'
    if context.permanence_scale >= 2.0:
      warnings.push('preparation carries indefinite absence')

  // Stage 8: Minimum stability check
  use_immediately_outcomes = ['vapors', 'veil', 'eye-drops']
  if stability < 1.0 and context.outcome not in use_immediately_outcomes and not has_indestructible and not is_fictional:
    return fail(context, 'insufficient_stability')

  // Categorization
  context.stability = stability
  if stability_state_override:
    context.stability_state = stability_state_override
  elif has_indestructible:
    context.stability_state = 'indefinite'
  elif stability > 365:
    context.stability_state = 'indefinite'
  elif stability > 180:
    context.stability_state = 'highly_stable'
  elif stability > 30:
    context.stability_state = 'stable'
  elif stability > 7:
    context.stability_state = 'moderately_stable'
  elif stability >= 1:
    context.stability_state = 'unstable'
  else:
    context.stability_state = 'critically_unstable'

  return context
```

---

## Design Notes

**Why weighted average rather than sum for base stability:** A preparation's shelf life is determined by its composition, not by how many ingredients it contains. Adding more ingredients doesn't make it last longer; the _mix_ determines the outcome. A summed formula would produce nonsense results — a preparation with ten stable ingredients would be presented as ten times more stable than a preparation with one identical stable ingredient, which isn't how chemistry works.

**Why presence_weight rather than chemical_extraction_weight:** Stability responds to everything physically present in the preparation, not just what extracted. An insoluble ingredient still occupies space and can affect decay dynamics — activated charcoal or mineral fragments influence a preparation's stability even without contributing chemistry. Using presence_weight ensures those contributions register.

**Why category composition is a modifier, not additive:** Categories don't add stability — they modify how stable the overall composition is. Mineral doesn't contribute "extra stability points"; it makes the whole preparation trend more stable because mineral chemistry is intrinsically resistant to decay. Weighted-average modifier better matches this than an additive contribution.

**Why outcome modifier as a multiplier rather than a fixed value:** Different outcomes have different intrinsic durabilities, but they scale with the ingredient composition. A Pellet made of stable ingredients lasts a lot longer than a Pellet made of Effluvia; both benefit from Pellet's solid form, but the base composition matters. A multiplier captures both effects; a fixed outcome value would flatten them.

**Why tag effects scale by aesthetic_weight:** A tag-bearing ingredient with low aesthetic_weight contributes less to the overall preparation's character. A preservative that's a minor component of the mix shouldn't preserve the whole preparation as strongly as one that dominates. Scaling by aesthetic_weight makes stability effects proportional to the ingredient's actual influence.

**Why traits apply per-instance rather than once:** Multiple ingredients with the same trait represent stacked effects — two decaying ingredients decay faster together than one alone, two quiescent ingredients contribute stability together. This matches real chemistry: more of the same effect stacks.

**Why indestructible sets a floor rather than a multiplier:** Indestructibility as a multiplier could still produce low stability values when combined with strong decay factors. As a floor, indestructibility guarantees that the preparation _cannot_ fall below a stability threshold regardless of what else is happening. This matches the trait's narrative meaning — the indestructible ingredient prevents the preparation from decaying below its resistance level.

**Why decaying ingredients spread decay via presence_weight reduction:** A rotting ingredient in a preparation actively contaminates the rest. Modeling this as presence_weight reduction on other ingredients means downstream computations (that read presence_weight, like sensory) see the contamination too — the whole preparation feels less "there" because parts of it are actively degrading. The mechanic feeds into the broader system rather than sitting isolated.

**Why fictional solvents bypass the minimum stability check:** Fictional solvents are guaranteed to produce a result. Ichor preparations that only last hours are still valid Ichor preparations. Prism results with unpredictable stability are still valid Prism results. Lacuna preparations with long stability are the norm. The failure state models "the preparation decays before it can form" — a concept that doesn't apply when the solvent's identity guarantees a preparation exists.

**Why the 30-day floor for indestructible rather than infinite:** A number is easier to test and reason about than infinity, and 30 days is long enough to feel indefinitely stable for any practical purpose. The state categorization then labels it `indefinite` regardless of the raw value. This avoids special-case handling for infinity throughout downstream rules.

**Why mercurial is randomized outside Prism specifically:** Mercurial's essence is shifting properties. Under Prism (which is already refractive), mercurial's own variance would double up meaninglessly. Reserving mercurial's randomness for non-Prism solvents keeps the mechanic distinct and prevents compounding uncertainty that would be hard to reason about.

---

## Cross-Rule Updates Required

### Update 1: Design reference document

Add to the Combination schema section:

```
stability: float — final stability in days
stability_state: enum
  ('critically_unstable' | 'unstable' | 'moderately_stable' |
   'stable' | 'highly_stable' | 'indefinite')
```

### Update 2: No changes needed to previous rule docs

SolventMatchRule, AntagonismRule, SynergyRule, and DoseCurveRule don't require modifications. StabilityRule reads from their outputs cleanly and doesn't modify their behavior.

### Update 3: Note on decaying trait side effect

The `decaying` trait reduces `presence_weight` of other ingredients by 10% as a side effect. Downstream rules that read `presence_weight` (sensory algorithm, ToxicityRule) will see this reduction. No explicit update needed to those rules — they automatically respect the reduced presence.
