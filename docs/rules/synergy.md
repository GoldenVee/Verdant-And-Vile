<!-- Rule 3 of 9. Part of the rules pipeline; see ../design-reference.md for the
     pipeline overview and ./README.md for the full rule list. -->

# SynergyRule

The third rule in the combination pipeline. Detects reinforcing interactions between ingredients, boosting their contributions or unlocking effects that wouldn't exist alone.

---

## Purpose

Detect ingredient interactions that amplify each other. Runs after AntagonismRule (so synergies only fire on what survived cancellation) and before DoseCurveRule (so amplified potencies get evaluated against dose curves).

**Why this order:** Synergies amplify what's actually present. Running them before antagonism would waste computation on ingredients that get canceled anyway. Running them after dose curves would let synergy push past dose ceilings, breaking the point of dose curves.

Also handles the _complementary_ side of scaled tag pairs — pairs that AntagonismRule classified as complementary based on intensity (see Pattern 4).

## Pipeline Position

```
→ SolventMatchRule
→ AntagonismRule
→ SynergyRule         ← this rule
→ DoseCurveRule
→ StabilityRule
→ ToxicityRule
→ SignatureTransformRule
```

---

## Inputs

Reads from `context`:

- `context.ingredients`: array of `CombinationIngredient` wrappers with post-antagonism weight data
- Each ingredient's `synergy_tags`, `compound_classes`, `category`, `traits`, `related_family`, `aesthetic_weight`
- `context.deferred_complementary_pairs`: pairs flagged by AntagonismRule as complementary based on intensity classification
- `context.solvent`: for fictional-solvent signature behavior
- The `synergy_pairs` and `tag_definitions` tables
- The combination's seeded PRNG (consistent access even if not always used)

## Outputs

Writes to `context`:

- Modifies each ingredient's `weight_data.potency_multiplier` (accumulated synergy boosts, subject to cap)
- Increments `context.sensory_erasure_count` (Lacuna only: drives sensory muting later)
- Sets `context.permanence_scale` (Lacuna only: drives duration extension)
- Adds `lacuna_subtractive_transmute` markers to effects (Lacuna only)
- Under Prism, sets `context.synergy_scope_multiplier` (drives sensory scope widening)
- Appends human-readable notes to `context.warnings`

Synergy never causes pipeline failure — it can only strengthen or transform, not fail. No `failure_reason` values come from this rule.

---

## The Five Synergy Patterns

Five ordered patterns, each handling a distinct source of synergy.

### Pattern 1: Related-family synergy

Two ingredients that share a `related_family` value synergize because they share related chemistry or origin.

**Data source:**

- **Botanicals**: `related_family` auto-populated during Trefle sync with the plant's Trefle family
- **Non-Botanicals**: curated manually as seed data (e.g., `volcanic-glass` for obsidian + pumice + tektite; `canid` for wolf bone + fox tooth; `iron-based-residue` for rust + meteoric iron)

**Direction:** mutual. Both ingredients reinforce each other equally.

**Boost:** 0.3 flat.

### Pattern 2: Shared compound-class synergy

Ingredients sharing compound classes in their `compound_classes` arrays reinforce each other. Milder than related-family but works cross-category (a botanical alkaloid and a fungal alkaloid can stack).

**Direction:** mutual.

**Boost:** diminishing returns — each successive shared class contributes 60% of the previous:

|Shared classes|Cumulative boost|
|---|---|
|1|0.150|
|2|0.240|
|3|0.294|
|4|0.326|
|5|0.345|
|6|0.357|
|Asymptote|~0.375|

Formula: `boost = 0.15 × (1 + 0.6 + 0.6² + 0.6³ + ...)` for N shared classes.

Practical maximum ~0.38 regardless of overlap count. No hard cap needed — the curve is self-bounded.

### Pattern 3: Tag-targets-compound synergy

Mirror of AntagonismRule Pattern 2. Some tags boost specific compound classes.

**Direction:** directional. The tag-bearing ingredient boosts targeted ingredients.

**Tag-target mappings** (from `tag_definitions.targets`):

|Tag|Targets|Boost|
|---|---|---|
|`bioavailability-booster`|any compound class|0.6|
|`alkaloid-carrier`|`alkaloid`|0.5|
|`volatile-fixer`|`volatile-oil`|0.4|
|`stimulant-amplifier`|stimulant-effect ingredients|0.5|
|`sedative-amplifier`|sedative-effect ingredients|0.5|
|`hallucinogenic-amplifier`|perceptual-effect ingredients|0.7|
|`mnemonic`|memory-effect ingredients|0.5|
|`warming`|warming-effect ingredients|0.3|
|`cooling`|cooling-effect ingredients|0.3|

### Pattern 4: Complementary tag pairs

Two sources feed into this pass:

**A. Curated always-complementary pairs** (from `synergy_pairs` table where `type = 'always_complementary'`):

|Pair|Effect|Boost|
|---|---|---|
|`emulsifier` + `binder`|Enables stable emulsions|0.4|
|`preservative` + `desiccant`|Compounding stability|0.4|
|`boundary-thinner` + `dream-inducer`|Unlocks lucid-dreaming effects|0.4|
|`chelator` + `bioavailability-booster`|Selectively boosts non-chelated compounds|0.4|
|`resonance-tuner` + `echo-binder`|Unlocks captured-emotion preparations|0.4|

**B. Scaled pairs that AntagonismRule classified as complementary** (from `context.deferred_complementary_pairs`):

These are pairs classified based on combined intensity in AntagonismRule. Each entry in the deferred queue includes the pair, the participating ingredients, and the boost value (0.3 for scaled pairs).

**Direction:** mutual for both sources.

### Pattern 5: Trait-driven synergy

Some traits create synergy with specific patterns.

|Trait pattern|Effect|Direction|Boost|
|---|---|---|---|
|`catalyst` + any ingredient with amplifier tag|Boosts amplifier's effect strength|Directional (catalyst → amplifier)|0.5|
|`carrier` + any active ingredient|Boosts extraction and effective potency|Directional (carrier → active)|0.6|
|`quiescent` + volatile ingredient|Quiescent stabilizes volatile chemistry|Directional (quiescent → volatile)|0.3|
|`sympathetic` + matching referent|Special targeting synergy|—|v2 deferred|

`catalyst` also affects downstream rules' interpretation of amplified weights (see cross-rule updates section).

---

## The Boost Formula

Where antagonism reduces weights via `× (1 - reduction)`, synergy boosts via `× (1 + boost)`.

**Boost formula:**

```
new_multiplier = current_multiplier × (1 + boost × booster_effective_weight)
```

Where:

```
booster_effective_weight = booster.chemical_extraction_weight × booster.ingredient.aesthetic_weight
```

Note: synergy modifies a _separate_ `potency_multiplier` field (accumulating across passes), not `chemical_extraction_weight` itself. This keeps concerns separated:

- `chemical_extraction_weight`: how much extracted (modified by antagonism only)
- `potency_multiplier`: how effective what extracted is (modified by synergy only)

Downstream rules compute effective potency as `chemical_extraction_weight × potency_multiplier × ingredient.potency_base`.

Chained synergy compounds multiplicatively — each pass multiplies the accumulated multiplier, subject to the cap.

---

## Synergy Cap & Fictional Solvent Signatures

Each solvent type expresses a distinct signature through how synergy behaves under it.

|Solvent|Cap|Signature mechanic|
|---|---|---|
|Grounded|2.5×|Standard: synergies boost potency; sensory scales accordingly|
|Ichor|5.0×|Amplified: synergies push potency further; sensory scales up with potency|
|Prism|2.5×|Widened positively: each synergy sets `synergy_scope_multiplier` for sensory algorithm|
|Lacuna|2.5×|Subtractive transmutation + sensory muting + permanence scaling|

**Cap application:**

```
ingredient.weight_data.potency_multiplier = min(accumulated_multiplier, cap)
```

Cap depends on `context.solvent`. Read once at pipeline start; applied at the end of SynergyRule.

### Prism's signature: scope widening

Under Prism, each synergy that fires increments a `synergy_scope_multiplier` on the context. The sensory algorithm (downstream) reads this and applies broader scope to the final output:

- Each synergy widens color palette (more secondary color contribution)
- Each synergy adds an aroma note beyond the base perfumery layering
- Each synergy makes texture more distinct
- Overall: preparations under Prism feel _fuller_ without being _stronger_

Prism doesn't cap differently from grounded solvents — its signature is dimensional, not quantitative.

### Lacuna's signature: subtractive transmutation

Under Lacuna, three parallel effects apply per synergy:

**1. Effect transmutation:** synergized effects transform into subtractive equivalents. A synergy that would produce "vivid memory recall" instead produces "clean memory erasure." A synergy that would produce "spreading calm" instead produces "inability to feel a specific emotion."

The transmutation is data-driven, mapped in the `effect_subtractive_equivalents` table:

|Standard effect|Lacuna subtractive equivalent|
|---|---|
|`memory_recall`|`memory_erasure`|
|`sedation`|`emotional_absence`|
|`perceptual_enhancement`|`sensory_removal`|
|`time_dilation`|`time_erasure`|
|`concealment`|`unfindability`|
|`stimulation`|`motivational_erasure`|
|`warming_sensation`|`warmth_absence`|
|`cooling_sensation`|`coolness_absence`|
|`dream_enhancement`|`dream_erasure`|
|`emotional_amplification`|`emotional_muting`|

Each synergy application on an effect adds a `lacuna_subtractive_transmute` marker referencing the corresponding row in this table. The effect resolver at the end of the pipeline reads these markers and produces the transmuted effect.

**2. Sensory muting:** each synergy increments `context.sensory_erasure_count`. The sensory algorithm reads this and progressively erases dimensions:

|Erasures|Dimension muted|
|---|---|
|1|Luminosity → dulled|
|2|Color → desaturated|
|3|Aroma → flattened|
|4|Texture → generic|
|5|Motion → still|
|6+|Taste → muted|

**3. Permanence scaling:** cumulative synergy strength drives `context.permanence_scale`, which affects effect duration downstream:

|Total synergy strength|Permanence effect|
|---|---|
|< 1.5×|Normal duration|
|1.5× – 2.0×|Duration ×3|
|2.0× – 2.5×|Effect becomes permanent|

A powerful Lacuna preparation can produce genuinely permanent removals — memory stays erased, emotion stays unavailable, sense stays muted indefinitely. This is what makes Lacuna dangerous in a way grounded solvents cannot be.

---

## Algorithm: Sequential Passes

Five ordered passes plus post-processing.

### Pass 1: Related-family synergy

```
for each pair (A, B) of ingredients:
  if A.ingredient.related_family and B.ingredient.related_family:
    if A.ingredient.related_family == B.ingredient.related_family:
      applySynergy(A, B, boost=0.3, mutual=true)
      warnings.push(A.name + ' and ' + B.name + ' share related family: ' + A.ingredient.related_family)
```

### Pass 2: Shared compound-class synergy

```
for each pair (A, B) of ingredients:
  shared = intersection(A.ingredient.compound_classes, B.ingredient.compound_classes)
  if shared is not empty:
    boost = calculateDiminishingBoost(len(shared))  // 0.15, 0.24, 0.294, ...
    applySynergy(A, B, boost, mutual=true)
    warnings.push(A.name + ' and ' + B.name + ' share compound classes: ' + shared.join(', '))


function calculateDiminishingBoost(count):
  total = 0
  current = 0.15
  for i in 0..count:
    total += current
    current *= 0.6
  return total
```

### Pass 3: Tag-targets-compound synergy

```
for each ingredient A:
  for each tag in A.ingredient.synergy_tags:
    targeted_classes = tag_definitions[tag].targets
    if not targeted_classes: continue
    boost = tag_definitions[tag].boost

    for each other ingredient B:
      if A == B: continue
      shared = intersection(B.ingredient.compound_classes, targeted_classes)
      if shared is not empty:
        applySynergy(A → B, boost, mutual=false)
        warnings.push(A.name + ' (' + tag + ') amplifies ' + shared.join(', ') + ' in ' + B.name)
```

### Pass 4: Complementary tag pairs

**Part A — Curated always-complementary pairs:**

```
for each pair (A, B) of ingredients:
  for each tag_A in A.ingredient.synergy_tags ∪ A.ingredient.antagonist_tags:
    complementary_tag = getComplementaryTag(tag_A)  // from synergy_pairs where type='always_complementary'
    if not complementary_tag: continue

    if complementary_tag in B.ingredient.synergy_tags ∪ B.ingredient.antagonist_tags:
      pair_info = synergy_pairs[tag_A, complementary_tag]
      applySynergy(A, B, pair_info.boost, mutual=true)
      warnings.push(pair_info.warning_template(A, B))
```

**Part B — Scaled pairs deferred from AntagonismRule:**

```
for each deferred_pair in context.deferred_complementary_pairs:
  A = deferred_pair.A
  B = deferred_pair.B
  boost = deferred_pair.boost  // typically 0.3
  applySynergy(A, B, boost, mutual=true)
  warnings.push(A.name + ' and ' + B.name + ' complement at balanced intensity')
```

### Pass 5: Trait-driven synergy

```
for each ingredient A:
  for each trait in A.ingredient.traits:
    pattern = trait_synergy_patterns[trait]
    if not pattern: continue

    for each other ingredient B:
      if A == B: continue
      if matchesTraitSynergyPattern(B, pattern):
        boost = pattern.boost
        applySynergy(A, B, boost, pattern.direction)
        warnings.push(pattern.warning_template(A, B))
```

### Post-processing: Apply cap and fictional solvent signatures

```
cap = getCapForSolvent(context.solvent)  // 2.5, 5.0, or 2.5 depending on solvent

for each ingredient:
  ingredient.weight_data.potency_multiplier = min(ingredient.weight_data.potency_multiplier, cap)

// Fictional solvent post-processing
if context.solvent.slug == 'prism':
  context.synergy_scope_multiplier = context.warnings.filter(w => w.is_synergy).length

if context.solvent.slug == 'lacuna':
  applyLacunaTransmutations(context)
  context.sensory_erasure_count = context.warnings.filter(w => w.is_synergy).length
  context.permanence_scale = calculatePermanenceScale(context.ingredients)
```

---

## Rule Output Shape

```
context.ingredients — modified in place; each ingredient's weight_data now includes:
  - potency_multiplier: float 1.0-cap  (was 1.0 by default)

context.warnings — appended with human-readable synergy reports

// Fictional solvent additions:
context.synergy_scope_multiplier — int (Prism only)
context.sensory_erasure_count — int (Lacuna only)
context.permanence_scale — float (Lacuna only)
// Individual effects may carry lacuna_subtractive_transmute markers (Lacuna only)
```

No failure states.

---

## Design Notes

**Why synergy is separate from extraction weight:** Antagonism removes chemistry that never made it into the medium. Synergy amplifies chemistry that did extract. Storing both effects on the same weight field conflates _how much extracted_ with _how effective what extracted was_. Splitting them keeps the concerns clean and lets downstream rules reason about each independently.

**Why diminishing returns for shared compound classes:** Real chemistry — sharing more compound classes doesn't linearly multiply synergy. The first shared class establishes real synergistic potential; each subsequent class adds marginal information. Modeling this with a 60% diminishment naturally bounds the boost without arbitrary caps, and rewards diverse ingredient combinations over redundant ones.

**Why fictional solvents express signatures differently:** Each fictional solvent has a distinct narrative identity (Ichor = elevation, Prism = alteration, Lacuna = erasure). Making them all behave the same way under synergy (e.g., "all have higher caps") would flatten those identities into mere numeric differences. Instead, each expresses its signature through a genuinely different mechanic: Ichor amplifies quantitatively, Prism expands dimensionally, Lacuna transmutes qualitatively. This gives users mechanically distinct experiences per solvent choice, not just different numbers.

**Why Lacuna's transmutation is data-driven rather than rule-driven:** Each effect that Lacuna transmutes needs a specific subtractive equivalent. Encoding these as a mapping table (`effect_subtractive_equivalents`) lets new effects be added later without touching rule code — you add a row to the table and the rule handles it automatically. Rule-level branching per effect type would require code changes for every new effect.

**Why permanence is a separate concept from potency:** Under normal solvents, effects fade with time. Under Lacuna, strong effects can persist indefinitely. This is Lacuna's most dangerous property, and modeling it as a separate `permanence_scale` (rather than baking it into potency) lets downstream rules handle duration cleanly. A high-potency Lacuna preparation isn't just stronger — it's _irrevocable_.

**Why AntagonismRule handles the intensity classification for scaled pairs:** Scaled pairs need to be classified once (antagonistic vs. complementary based on intensity), and both AntagonismRule and SynergyRule need to know the classification. Rather than duplicate the intensity calculation across both rules, AntagonismRule classifies and either applies antagonism directly or defers a complementary flag for SynergyRule to consume. This keeps the intensity math in one place.

**Why the boost formula uses `booster_effective_weight`:** A weakly-extracted or low-aesthetic-weight booster shouldn't be able to boost as strongly as a dominant one. This mirrors antagonism's structure and keeps the mechanic honest — synergy strength depends on how _present_ the booster actually is in the combination.

---

## Cross-Rule Updates Required

Adding SynergyRule requires updates to previously-specified rules and schema. Each is documented below.

### Update 1: AntagonismRule Pattern 1: opposite-tag detection

Currently applies antagonism to all opposite pairs uniformly. Must be updated to consult the `synergy_pairs.type` field:

```
for each opposite pair (A, B) of ingredients:
  pair_definition = synergy_pairs.lookup(tag_A, tag_B)

  if pair_definition.type == 'always_antagonistic':
    applyAntagonism(A, B, severity=0.8, mutual=true)

  elif pair_definition.type == 'scaled':
    intensity = calculateCombinedIntensity(A, B)

    if intensity < pair_definition.complementary_ceiling (default 0.7):
      // Defer to SynergyRule
      context.deferred_complementary_pairs.push({A, B, boost: 0.3})
      warnings.push(A.name + ' and ' + B.name + ' complement at low intensity')

    elif intensity < pair_definition.balanced_ceiling (default 1.4):
      // Balanced — no modifier
      warnings.push(A.name + ' and ' + B.name + ' balance each other')

    elif intensity < pair_definition.straining_ceiling (default 2.0):
      applyAntagonism(A, B, severity=0.3, mutual=true)  // weak
      warnings.push(A.name + ' and ' + B.name + ' strain against each other')

    else:
      applyAntagonism(A, B, severity=0.8, mutual=true)  // full


function calculateCombinedIntensity(A, B):
  return (A.weight_data.chemical_extraction_weight × A.ingredient.aesthetic_weight) +
         (B.weight_data.chemical_extraction_weight × B.ingredient.aesthetic_weight)
```

Where in the AntagonismRule doc: replace Pattern 1 pseudo-code entirely with the above.

### Update 2: AntagonismRule opposite-pairs list

The following pairs move from _always antagonistic_ to _scaled_ (they're now complementary at low intensity):

|Pair|New classification|
|---|---|
|`warming` ↔ `cooling`|scaled|
|`stimulant-amplifier` ↔ `sedative-amplifier`|scaled|
|`dream-inducer` ↔ `lucidity-guard`|scaled|
|`time-dilator` ↔ `moment-anchor`|scaled|
|`disinhibitor` ↔ `will-fortifier`|scaled|

The remaining 15 pairs stay `always_antagonistic`.

Where in the AntagonismRule doc: update Pattern 1's opposite-pairs list, marking the five scaled pairs with a scaled indicator or noting them in a separate table.

### Update 3: Schema additions

**Ingredient schema — new field:**

- `related_family` (string, nullable): for related-family synergy in SynergyRule Pattern 1

**`synergy_pairs` table — new/expanded structure:**

```
synergy_pairs {
  tag_a: string,
  tag_b: string,
  type: enum('always_antagonistic' | 'always_complementary' | 'scaled'),
  boost: float (nullable — only used when complementary),
  severity: float (nullable — only used when antagonistic or scaled straining),
  complementary_ceiling: float (nullable — only used when scaled, default 0.7),
  balanced_ceiling: float (nullable — only used when scaled, default 1.4),
  straining_ceiling: float (nullable — only used when scaled, default 2.0),
  warning_template: string (template for user-facing warning)
}
```

**`tag_definitions` table — expanded:**

```
tag_definitions {
  slug: string,
  category: string ('extraction' | 'interaction' | 'perception' | 'metaphysical' | ...),
  targets: array<compound_class_slug> (nullable — for tag-targets-compound rules),
  boost: float (nullable — for synergy boost when tag triggers),
  severity: float (nullable — for antagonism severity when tag triggers),
  opposite_tag: string (nullable — for opposite-pair lookups)
}
```

**`effect_subtractive_equivalents` table — new:**

```
effect_subtractive_equivalents {
  standard_effect: string,
  subtractive_equivalent: string
}
```

Populated with the mapping shown in Lacuna's signature section.

**Combination context — new fields (transient during pipeline):**

- `deferred_complementary_pairs: array<{A, B, boost}>`: populated by AntagonismRule, consumed by SynergyRule
- `synergy_scope_multiplier: int`: Prism only
- `sensory_erasure_count: int`: Lacuna only
- `permanence_scale: float`: Lacuna only

### Update 4: Design reference document additions

The main `verdant_and_vile_design_reference.md` needs these additions in the Interaction Tags section:

**Note on scaled pairs:**

> Five pairs are _scaled_ — they classify as complementary or antagonistic based on the combined intensity of the ingredients involved. At low intensity they complement; at high intensity they cancel. See SynergyRule and AntagonismRule docs for the mechanic. The scaled pairs are: `warming` ↔ `cooling`, `stimulant-amplifier` ↔ `sedative-amplifier`, `dream-inducer` ↔ `lucidity-guard`, `time-dilator` ↔ `moment-anchor`, `disinhibitor` ↔ `will-fortifier`.

**Ingredient schema — add to Taxonomy:**

- `related_family`: string, nullable. Auto-populated for Botanicals from Trefle; manually curated for other categories.
