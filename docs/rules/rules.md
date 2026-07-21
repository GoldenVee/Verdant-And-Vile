## Rules Pipeline — SolventMatchRule

The first rule in the combination pipeline. Validates that the chosen combination is chemically attemptable before any downstream math runs, and computes per-ingredient weights that all subsequent rules read.

---

## Purpose

Pre-flight validation and weight assignment. This is the pipeline's gatekeeper — if the combination fails here, no downstream rule runs. Successful pass populates the per-ingredient weights that drive every subsequent computation.

## Pipeline Position

```
→ SolventMatchRule    ← this rule
→ AntagonismRule
→ SynergyRule
→ DoseCurveRule
→ StabilityRule
→ ToxicityRule
→ SignatureTransformRule
```

---

## Inputs

Reads from `context`:

- `context.solvent` — the chosen solvent record (with polarity, category_affinity, category_resistance, compatible_outcomes, signature_transformation)
- `context.outcome` — the chosen outcome type
- `context.ingredients` — the chosen ingredient records (with solubility, category)

## Outputs

Writes to `context`:

- `context.ingredients` — array of `CombinationIngredient` wrappers with weight data attached
- `context.solvent_validated` — boolean, `true` on successful pass

On failure, writes:

- `context.failed = true`
- `context.failure_reason` — one of the enum values below

---

## The CombinationIngredient Wrapper

Ingredients in the pipeline are wrapped with their computed weight data. The original ingredient record stays immutable; pipeline-derived state lives on the wrapper.

```
CombinationIngredient {
  ingredient: IngredientRecord,       // DB record, immutable
  weight_data: {
    chemical_extraction_weight: float,   // 0.0-1.0, dissolved chemistry contribution
    presence_weight: float,               // 0.0-1.0, physical/sensory presence
    extraction_yield_modifier: float,    // -0.75 to +0.45, from affinity/resistance
    warnings: string[]                    // resistance warnings, weak-match notes
  }
}
```

**Downstream rules access:**

- Ingredient properties: `combinationIngredient.ingredient.solubility`
- Weight data: `combinationIngredient.weight_data.chemical_extraction_weight`

### Weight semantics

- **`chemical_extraction_weight`** — how much of the ingredient's chemistry actually enters the medium. Read by SynergyRule, AntagonismRule, DoseCurveRule, ToxicityRule, and the reactive-shift portion of the sensory algorithm.
- **`presence_weight`** — how much the ingredient's physical/sensory character is present. Read by StabilityRule, SensoryAlgorithm (color, aroma, texture defaults), and outcome-specific structural rules (Sachet composition, Paste texture).

Insoluble ingredients typically have `chemical_extraction_weight = 0.0` but `presence_weight = 1.0` — they don't dissolve but they're physically present. This is real chemistry (activated charcoal, cellulose fiber, whole spices in mulled wine).

- **`extraction_yield_modifier`** — additive modifier applied later to any extraction-yield computation. Positive from affinity, negative from resistance.
- **`warnings`** — human-readable notes surfaced to the final result.

---

## Ordered Checks

Checks run in this order. Each is cheaper than the next; fail-fast on the first that fails.

### Check 1 — Ingredient count

```
if context.ingredients.length == 0:
  fail(context, 'no_ingredients')
```

The UI gates minimum ingredient count, but the API layer enforces this as a safety check.

### Check 2 — Solvent-outcome compatibility

```
is_fictional = solvent.signature_transformation != null

if outcome != 'sachet' and not is_fictional:
  if outcome not in solvent.compatible_outcomes:
    fail(context, 'outcome_incompatible')
```

- **Sachet** bypasses this check (it uses no solvent).
- **Fictional solvents** (Ichor, Prism, Lacuna) bypass this check — they work with all outcomes.
- **Grounded solvents** must have the chosen outcome in their `compatible_outcomes` array.

### Check 3 — Ingredient solubility × solvent polarity

For each ingredient, classify its extraction match against the solvent using the [adjacency matrix](https://claude.ai/chat/bd037fbd-1200-4014-aecf-ff6f5d4b8e00#solubility--polarity-adjacency-matrix). Sets `chemical_extraction_weight`.

Special cases:

- **Sachet outcome** → all ingredients get weight 1.0, no polarity check.
- **Fictional solvent** → all ingredients get weight 1.0, no polarity check.
- **Grounded solvent** → matrix lookup determines the weight (1.0 / 0.7 / 0.5 / 0.3 / 0.0).

`presence_weight` is set independently — typically 1.0 for most ingredients, but reserved lower for edge cases like Pneuma ingredients in a resistant solvent (essences disperse without physical presence).

### Check 4 — Category affinity and resistance

For each ingredient, check its category against the solvent's tiered affinity and resistance:

|Match|Modifier|Warning added?|
|---|---|---|
|Strong affinity|+0.30|No|
|Weak affinity|+0.15|No|
|Neutral (not listed)|0.00|No|
|Weak resistance|-0.25|Yes — "solvent resists {category} category"|
|Strong resistance|-0.50|Yes — "solvent strongly resists {category} category"|

Neutral is implicit — categories not listed in either affinity or resistance are treated as neutral. This keeps the API lean; documentation of what's neutral belongs in UI-facing docs.

### Check 5 — Total-failure evaluation

After per-ingredient checks:

```
matched_count = count of ingredients where chemical_extraction_weight > 0

if matched_count == 0 and not is_fictional and outcome != 'sachet':
  fail(context, 'extraction_impossible')
```

If no ingredient at all can extract into the chosen solvent, the combination is impossible.

### Check 6 — Sachet edge case

Sachet is handled inline in Checks 2 and 3 rather than as its own check. When `outcome == 'sachet'`:

- Check 2 is skipped
- Check 3 gives all ingredients full weight (1.0)
- Check 5 is skipped
- If a fictional solvent is somehow attached to a Sachet, its signature transformation still applies later in SignatureTransformRule

---

## Solubility × Polarity Adjacency Matrix

Determines `chemical_extraction_weight` per ingredient based on the solvent's polarity.

|Ingredient solubility|Polar solvent|Nonpolar solvent|Acid-soluble solvent|Universal solvent|
|---|---|---|---|---|
|`polar`|**1.0**|0.3|0.7|1.0|
|`nonpolar`|0.3|**1.0**|0.3|1.0|
|`acid-soluble`|0.7|0.3|**1.0**|1.0|
|`universal`|0.5|0.5|0.5|**1.0**|
|`insoluble`|0.0|0.0|0.0|0.5|

**Reading the matrix:**

- **1.0 (perfect match)** — ingredient's solubility class matches solvent's polarity exactly
- **0.7 (adjacent match)** — chemistry-adjacent, real partial extraction (many polar compounds are also acid-soluble; some acid compounds are also water-soluble)
- **0.5 (universal)** — universal ingredients extract into anything but not optimally
- **0.3 (poor match)** — technical partial extraction of minor compatible components
- **0.0 (no match)** — no meaningful chemical extraction; `presence_weight` still 1.0

**Anti-solvent (Lacuna)** — not represented in the matrix because Lacuna bypasses the polarity check entirely. It preserves structure rather than dissolving; all ingredients get weight 1.0 through the fictional-solvent bypass.

---

## Tiered Affinity/Resistance Structure

Solvents declare category preferences at two tiers:

```
solvent.category_affinity = {
  strong: [category_ids],   // +0.30 yield modifier
  weak:   [category_ids]    // +0.15 yield modifier
}

solvent.category_resistance = {
  strong: [category_ids],   // -0.50 yield modifier + warning
  weak:   [category_ids]    // -0.25 yield modifier + warning
}
```

Categories not listed in either object are implicitly neutral.

### Per-Solvent Distribution

#### Grounded Solvents

**Water**

```
affinity:   { strong: [botanical, fungal],  weak: [mineral, pneuma] }
resistance: { strong: [effluvia],           weak: [cosmic] }
```

**Spirits**

```
affinity:   { strong: [botanical, fungal, fauna-derived],  weak: [alchemical] }
resistance: { strong: [pneuma],                             weak: [aberrant] }
```

**Oil**

```
affinity:   { strong: [botanical, fauna-derived],  weak: [fungal] }
resistance: { strong: [mineral, effluvia],         weak: [pneuma] }
```

**Vinegar**

```
affinity:   { strong: [mineral, fauna-derived, alchemical],  weak: [botanical] }
resistance: { strong: [pneuma],                               weak: [cosmic] }
```

**Honey**

```
affinity:   { strong: [botanical, pneuma],  weak: [fungal, fauna-derived] }
resistance: { strong: [alchemical],         weak: [effluvia] }
```

#### Fictional Solvents

**Ichor**

```
affinity:   { strong: [fauna-derived, aberrant],  weak: [pneuma, cosmic] }
resistance: { strong: [alchemical],               weak: [mineral] }
```

**Prism**

```
affinity:   { strong: [aberrant, cosmic],  weak: [pneuma, mineral] }
resistance: { strong: [],                  weak: [fauna-derived] }
```

_Prism has minimal resistance — mercurial in welcome, per its lore._

**Lacuna**

```
affinity:   { strong: [aberrant, cosmic],           weak: [effluvia, pneuma] }
resistance: { strong: [botanical, fauna-derived],   weak: [fungal] }
```

_Lacuna resists living things — absence fights presence._

---

## Failure Reasons

Enum values SolventMatchRule can set on `failure_reason`:

|Value|Cause|User message hint|
|---|---|---|
|`no_ingredients`|Zero ingredients in combination|"Add at least one ingredient."|
|`outcome_incompatible`|Grounded solvent × outcome pair not valid|"This solvent can't produce this outcome."|
|`extraction_impossible`|No ingredient extracts into the chosen solvent|"None of these ingredients dissolve in this solvent."|

---

## Pseudo-code

```
function SolventMatchRule(context):
  // Check 1
  if context.ingredients.length == 0:
    return fail(context, 'no_ingredients')

  solvent = context.solvent
  outcome = context.outcome
  is_fictional = solvent.signature_transformation != null

  // Check 2 (skipped for sachet, bypassed for fictional)
  if outcome != 'sachet' and not is_fictional:
    if outcome not in solvent.compatible_outcomes:
      return fail(context, 'outcome_incompatible')

  wrapped_ingredients = []
  any_matched = false

  for ingredient in context.ingredients:
    weight_data = { warnings: [], extraction_yield_modifier: 0 }

    // Check 3: solubility × polarity match
    if outcome == 'sachet' or is_fictional:
      // Bypass polarity: full weight
      weight_data.chemical_extraction_weight = 1.0
      weight_data.presence_weight = 1.0
      any_matched = true
    else:
      // Grounded: matrix lookup
      chem_weight = adjacencyMatrix[ingredient.solubility][solvent.polarity]
      weight_data.chemical_extraction_weight = chem_weight
      weight_data.presence_weight = 1.0  // default; can be overridden by edge cases

      if chem_weight > 0:
        any_matched = true
      if 0 < chem_weight < 1.0:
        weight_data.warnings.push('partial extraction only')

    // Check 4: category affinity/resistance
    cat = ingredient.category
    if cat in solvent.category_affinity.strong:
      weight_data.extraction_yield_modifier += 0.30
    else if cat in solvent.category_affinity.weak:
      weight_data.extraction_yield_modifier += 0.15
    else if cat in solvent.category_resistance.weak:
      weight_data.extraction_yield_modifier -= 0.25
      weight_data.warnings.push('solvent resists ' + cat + ' category')
    else if cat in solvent.category_resistance.strong:
      weight_data.extraction_yield_modifier -= 0.50
      weight_data.warnings.push('solvent strongly resists ' + cat + ' category')

    wrapped_ingredients.push({ ingredient, weight_data })

  // Check 5: total-failure
  if not any_matched and not is_fictional and outcome != 'sachet':
    return fail(context, 'extraction_impossible')

  context.ingredients = wrapped_ingredients
  context.solvent_validated = true
  return context
```

---

## Design Notes

**Why two weights instead of one:** Real chemistry distinguishes between "how much of the ingredient's chemistry enters the medium" and "how much the ingredient is physically present." Activated charcoal is insoluble but adsorbs toxins on its surface — it contributes chemistry without extracting. Whole spices in a sachet don't dissolve but contribute aroma. Splitting the weights lets downstream rules access whichever is relevant to their computation.

**Why the adjacency matrix has 5 tiers instead of 3 (full/weak/none):** Real solvent chemistry has intermediate cases that a binary system flattens. Acid-soluble ingredients partially extract into polar solvents (many share compounds); universal ingredients extract into everything but not optimally. Five tiers give enough resolution for realism without being harder to reason about than continuous scaling.

**Why asymmetric affinity/resistance magnitudes:** Resistance penalizes more than affinity rewards (max -0.50 vs max +0.30) because the solvent is _actively fighting_ the ingredient in resistance cases. Being well-suited is helpful; being actively rejected is a bigger problem.

**Why neutral is implicit rather than explicit:** Enum-based tag systems typically use "presence = has quality, absence = doesn't" — making neutral a listed state adds no algorithmic value and clutters the schema. Documentation of what's neutral for each solvent belongs in UI-facing docs, not the API.

**Why fictional solvents bypass polarity checks:** This is their architectural signature. Grounded solvents gate outcomes and require polarity matching; fictional solvents ignore both gates but apply signature transformations at the end. This asymmetry is the mechanic that makes fictional solvents _different in kind_, not just different in flavor.

**Why the count check stays even with UI gating:** API-layer validation protects against any client that bypasses the UI (curl calls, tests, third-party consumers). Belt-and-suspenders on empty-input handling costs nothing and prevents null-related crashes downstream.



## Rules Pipeline — AntagonismRule

The second rule in the combination pipeline. Detects canceling and destructive interactions between ingredients, reducing their effective contributions to the final result.

---

## Purpose

Detect ingredient interactions that neutralize, cancel, or destroy each other. Runs after SolventMatchRule (so it can weight antagonisms by extraction) and before SynergyRule (real chemistry order: cancellations happen before amplifications — you can't amplify what got neutralized first).

**Why this order:** If a chelator binds an alkaloid before extraction completes, the alkaloid never becomes available for a bioavailability-booster to amplify. Antagonism removes things from the reaction; synergy then works on what remains.

## Pipeline Position

```
→ SolventMatchRule
→ AntagonismRule      ← this rule
→ SynergyRule
→ DoseCurveRule
→ StabilityRule
→ ToxicityRule
→ SignatureTransformRule
```

---

## Inputs

Reads from `context`:

- `context.ingredients` — array of `CombinationIngredient` wrappers with weight data from SolventMatchRule
- Each ingredient's `synergy_tags`, `antagonist_tags`, `compound_classes`, `traits`, `aesthetic_weight`
- The interaction-tag vocabulary and its opposite-pair mappings (from the `tag_definitions` table)
- The combination's seeded PRNG for probabilistic mechanics

## Outputs

Writes to `context`:

- Modifies each ingredient's `weight_data.chemical_extraction_weight` in place (reduced by antagonism)
- Appends human-readable notes to `context.warnings`

On failure, writes:

- `context.failed = true`
- `context.failure_reason = 'total_antagonism'` when the combination cancels itself out

---

## The Four Antagonism Patterns

Antagonism comes from four distinct sources. Each has its own detection logic and runs as a sequential pass.

### Pattern 1 — Opposite-tag pairs

When both members of an opposite pair appear across ingredients, they cancel each other.

The 20+ opposite pairs defined in the interaction-tag vocabulary:

- `oxidizer` ↔ `reducer`
- `desiccant` ↔ `deliquescent`
- `bioavailability-booster` ↔ `bioavailability-inhibitor`
- `emulsifier` ↔ `separator`
- `binder` ↔ `loosener`
- `preservative` ↔ `accelerant`
- `volatile-fixer` ↔ `volatile-releaser`
- `acid-releaser` ↔ `alkalizer`
- `stimulant-amplifier` ↔ `sedative-amplifier`
- `hallucinogenic-amplifier` ↔ `reality-anchor`
- `boundary-thinner` ↔ `boundary-sealer`
- `echo-binder` ↔ `echo-dampener`
- `mnemonic` ↔ `amnesiac`
- `veil-piercer` ↔ `veil-drawer`
- `dream-inducer` ↔ `lucidity-guard`
- `time-dilator` ↔ `moment-anchor`
- `magnetizer` ↔ `repeller`
- `disinhibitor` ↔ `will-fortifier`
- `concentrator` ↔ `diffuser`

**Antagonism direction:** mutual. Both ingredients reduce each other simultaneously — neither wins, they cancel.

### Pattern 2 — Tag-targets-compound

Some interaction tags act on specific compound classes. When Ingredient A has one of these tags and Ingredient B contains the targeted compound class, A antagonizes B.

Tag-target mappings (in `tag_definitions.targets`):

|Tag|Targets|
|---|---|
|`chelator`|`alkaloid`, `mineral-salt`|
|`denaturant`|`protein`, `mucilage`|
|`bioavailability-inhibitor`|any _(broad — reduces others' effective potency)_|
|`oxidizer`|`volatile-oil`, `flavonoid` _(via oxidative breakdown)_|
|`reducer`|`oxide` _(reverses oxidation state)_|

**Antagonism direction:** directional. Only the targeted ingredient's weight drops; the antagonizer's stays intact.

### Pattern 3 — Trait-driven antagonism

Some traits create antagonism regardless of tags:

|Trait pattern|Effect|Direction|
|---|---|---|
|`explosive` + `catalyst` (any ingredient)|Dangerous instability|Bidirectional|
|`decaying` (any ingredient present)|Contaminates all others|Directional (from decaying to others)|
|`mercurial` + `shy`|Unpredictable interaction|Bidirectional, seeded-random severity|

**Antagonism direction:** varies per trait pattern; see the severity table below.

### Pattern 4 — Category resistance amplification

Ingredients already flagged by SolventMatchRule as being in a resisted category (having `extraction_yield_modifier < 0`) are _more susceptible_ to antagonism. Their weight reductions from Patterns 1–3 are multiplied by an amplification factor.

**Formula:**

```
if ingredient.weight_data.extraction_yield_modifier < 0:
  amplification = 1 + abs(extraction_yield_modifier)  // 1.25 for -0.25, 1.50 for -0.50
  antagonism_severity_applied = base_severity × amplification
```

Weakened ingredients cancel more easily. Real chemistry — a compound that's already struggling to extract is more vulnerable to disruption.

---

## Antagonism Reduction Formula

The core mechanic: antagonism reduces `chemical_extraction_weight` of the targeted ingredient. It doesn't destroy the ingredient; it neutralizes the ingredient's chemistry contribution.

```
new_weight = old_weight × (1 - severity × antagonizer_effective_weight)
```

Where:

```
antagonizer_effective_weight = antagonizer.chemical_extraction_weight × antagonizer.ingredient.aesthetic_weight
```

**A worked example:**

Ingredient A is a chelator with `chemical_extraction_weight = 1.0`, `aesthetic_weight = 0.6`. Ingredient B contains `alkaloid` compounds with `chemical_extraction_weight = 0.8`.

```
antagonizer_effective = 1.0 × 0.6 = 0.6
severity (chelator on alkaloid) = 0.7
new_weight_B = 0.8 × (1 - 0.7 × 0.6) = 0.8 × 0.58 = 0.464
```

B's alkaloid contribution effectively drops from 80% to ~46%. Meaningful reduction, not annihilation.

**Semantics of the formula:**

- **Full antagonism** requires _both_ a high severity _and_ a dominant antagonizer — a weakly-extracted or low-aesthetic-weight antagonizer can only reduce its target so much
- **Chained antagonism** — if multiple antagonizers target the same ingredient, their reductions compound multiplicatively (each reduces the already-reduced weight)
- **Order of application within a pass doesn't matter** because reduction is commutative under multiplication

---

## Severity Table

Starting values, adjustable during playtesting:

|Interaction|Severity|Direction|
|---|---|---|
|Opposite-tag pair|0.8|Mutual|
|`chelator` → `alkaloid` or `mineral-salt`|0.7|Directional|
|`denaturant` → `protein` or `mucilage`|0.8|Directional|
|`bioavailability-inhibitor` → any compound|0.5|Directional|
|`oxidizer` → `volatile-oil` or `flavonoid`|0.6|Directional|
|`reducer` → `oxide`|0.5|Directional|
|`explosive` trait × `catalyst` trait|0.9|Bidirectional|
|`decaying` trait → any other ingredient|0.3|Directional|
|`mercurial` × `shy` interaction|0.4–0.7 (seeded random)|Bidirectional|

---

## Seeded Random Mechanics

For any probabilistic interaction (currently `mercurial × shy`; future: `solvent-shifter` target selection, `mercurial` property resolution, signature transformation flavor variance), the pipeline uses a single seeded PRNG.

**Seed derivation:**

```
combination_seed = hash(
  sorted(ingredient_ids).join('|') +
  '|' + solvent_id +
  '|' + outcome_type
)
```

Any rule requiring randomness draws from a PRNG initialized with `combination_seed`. Same inputs always produce the same random outputs.

**Design properties:**

- **Deterministic** — same combination always returns the same result (great for testing, debugging, reproducibility)
- **Varied across combinations** — different ingredient sets produce different random draws
- **Testable** — probabilistic mechanics can be unit-tested against known expected outputs given a fixed seed
- **Portfolio-worthy** — a defensible engineering pattern to explain in interviews

**In this rule specifically:** the `mercurial × shy` severity is drawn from a uniform distribution over [0.4, 0.7] using the seeded PRNG.

---

## Algorithm — Sequential Passes

Four ordered passes, one per pattern. Total-failure check runs after all reductions complete.

### Pass 1: Opposite-tag detection

```
for each pair (A, B) of ingredients in combination:
  for each tag in A.antagonist_tags ∪ A.synergy_tags:
    opposite = getOppositeTag(tag)  // returns null if tag has no opposite
    if opposite is null: continue

    if opposite in B.synergy_tags or opposite in B.antagonist_tags:
      severity = 0.8
      applyAntagonism(A, B, severity, mutual=true)
      warnings.push(A.name + ' and ' + B.name + ' cancel each other (' + tag + ' ↔ ' + opposite + ')')
```

### Pass 2: Tag-targets-compound detection

```
for each ingredient A in combination:
  for each tag in A.antagonist_tags:
    targeted_classes = tag_definitions[tag].targets
    if not targeted_classes: continue

    for each other ingredient B in combination:
      if A == B: continue

      shared_classes = intersection(B.compound_classes, targeted_classes)
      if shared_classes is not empty:
        severity = tag_definitions[tag].severity  // from severity table
        applyAntagonism(A → B, severity, mutual=false)
        warnings.push(A.name + ' (' + tag + ') neutralizes ' + shared_classes.join(', ') + ' from ' + B.name)
```

### Pass 3: Trait-driven antagonism

```
for each ingredient A in combination:
  for each trait in A.traits:
    trait_pattern = trait_antagonism_patterns[trait]
    if not trait_pattern: continue

    for each other ingredient B in combination:
      if A == B: continue

      if matchesTraitPattern(B, trait_pattern):
        severity = resolveSeverity(trait_pattern, A, B, combination_seed)
        applyAntagonism(A, B, severity, mutual=trait_pattern.bidirectional)
        warnings.push(trait_pattern.warning_template(A, B))
```

`resolveSeverity` handles both fixed values and seeded-random ranges. For `mercurial × shy`, it draws from [0.4, 0.7] using the combination's PRNG.

### Pass 4: Total-antagonism check

```
matched_ingredients = ingredients where chemical_extraction_weight > 0

if not is_fictional_solvent and outcome != 'sachet':
  ingredients_below_threshold = matched_ingredients where chemical_extraction_weight < 0.20
  if ingredients_below_threshold.length == matched_ingredients.length:
    fail(context, 'total_antagonism')
```

The 0.20 threshold is the effective floor at which an ingredient contributes so little chemistry that it's no longer meaningfully present. If every extractable ingredient has been reduced below this floor, the combination has canceled itself out entirely.

Fictional solvents and Sachet outcomes bypass this check — fictional solvents guarantee some form of transformation regardless of chemical cancellation, and Sachets don't rely on extraction at all.

---

## Pseudo-code

```
function AntagonismRule(context):
  seed = deriveSeed(context)
  prng = new SeededPRNG(seed)

  // Pass 1: Opposite-tag pairs
  for i in 0..context.ingredients.length - 2:
    for j in i+1..context.ingredients.length - 1:
      A = context.ingredients[i]
      B = context.ingredients[j]
      detectOppositeTagPairs(A, B, context)

  // Pass 2: Tag-targets-compound
  for A in context.ingredients:
    for tag in A.ingredient.antagonist_tags:
      targets = tag_definitions[tag].targets
      if targets is null: continue

      for B in context.ingredients:
        if A == B: continue
        shared = intersection(B.ingredient.compound_classes, targets)
        if shared not empty:
          severity = tag_definitions[tag].severity
          amplification = calculateResistanceAmplification(B)
          applyAntagonism(A, B, severity × amplification, directional=true, context)

  // Pass 3: Trait-driven
  for A in context.ingredients:
    for trait in A.ingredient.traits:
      pattern = trait_antagonism_patterns[trait]
      if pattern is null: continue

      for B in context.ingredients:
        if A == B: continue
        if matchesTraitPattern(B, pattern):
          severity = resolveSeverity(pattern, A, B, prng)
          amplification = calculateResistanceAmplification(B)
          applyAntagonism(A, B, severity × amplification, pattern.direction, context)

  // Pass 4: Total-antagonism check
  is_fictional = context.solvent.signature_transformation != null
  if not is_fictional and context.outcome != 'sachet':
    matched = context.ingredients.filter(i => i.weight_data.chemical_extraction_weight > 0)
    if matched.length > 0:
      all_below_threshold = matched.every(i => i.weight_data.chemical_extraction_weight < 0.20)
      if all_below_threshold:
        return fail(context, 'total_antagonism')

  return context


function applyAntagonism(A, B, severity, mutual_or_direction, context):
  A_effective = A.weight_data.chemical_extraction_weight × A.ingredient.aesthetic_weight
  B_effective = B.weight_data.chemical_extraction_weight × B.ingredient.aesthetic_weight

  if mutual:
    B.weight_data.chemical_extraction_weight ×= (1 - severity × A_effective)
    A.weight_data.chemical_extraction_weight ×= (1 - severity × B_effective)
  else:
    // directional: A → B
    B.weight_data.chemical_extraction_weight ×= (1 - severity × A_effective)


function calculateResistanceAmplification(ingredient):
  modifier = ingredient.weight_data.extraction_yield_modifier
  if modifier < 0:
    return 1 + abs(modifier)  // 1.25 for -0.25, 1.50 for -0.50
  return 1.0
```

---

## Failure Reasons

Enum values AntagonismRule can set on `failure_reason`:

|Value|Cause|User message hint|
|---|---|---|
|`total_antagonism`|All extractable ingredients reduced below 0.20 threshold|"These ingredients cancel each other out. Try removing an opposing pair."|

---

## Design Notes

**Why sequential passes instead of one nested loop:** Four distinct pattern-detection mechanics with different logic. Splitting them into passes makes each testable in isolation, keeps the code readable, and lets the order (opposite-tags → tag-targets-compound → trait-driven) reflect a real conceptual hierarchy — from tag-level cancellation to compound-level to trait-level.

**Why mutual antagonism for opposite pairs but directional for tag-targets-compound:** Opposite pairs describe _symmetric_ chemistry — an oxidizer and reducer literally consume each other's active state. Tag-targets-compound describes _asymmetric_ chemistry — a chelator binds alkaloids without the alkaloids affecting the chelator's ability to bind more. This matches real physical chemistry.

**Why the 0.20 threshold for total failure (rather than 0.10 or 0.15):** More lenient thresholds forgive edge cases where a combination has one meaningful ingredient and several weak ones. Setting it at 0.20 means the pipeline is willing to try producing something even when most of the extraction is compromised, as long as at least one contribution is above the floor. Users see warnings for the weakened ingredients but get a result rather than a failure.

**Why resistance amplifies antagonism (Pattern 4):** Real chemistry — a compound that's struggling to extract is more vulnerable to disruption from other reactive agents. Modeling this as a multiplier on antagonism severity captures the "already weakened, more susceptible" quality naturally, without needing separate rules per case.

**Why seeded random instead of true random:** Determinism matters for testing, debugging, and reproducibility. Users who submit the same combination twice should get the same result. Users who submit different combinations still get varied outcomes because the seed is derived from all inputs. This is a defensible engineering pattern that plays well in interview conversations.

**Why AntagonismRule runs before SynergyRule:** Cancellation happens before amplification in real chemistry. You can't amplify what has already been neutralized. Running antagonism first ensures synergies only work with what actually survives extraction and interaction. This also means the final potency calculations are based on what's _actually present_, not what was theoretically added.

**Why chained antagonism compounds multiplicatively rather than additively:** Multiplicative compounding is bounded (weight stays between 0 and its starting value), whereas additive compounding could drive weight negative. It's also more chemistry-honest — each reducer acts on what remains after previous reduction, not on a shared pool that gets depleted linearly.


## Rules Pipeline — SynergyRule

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

- `context.ingredients` — array of `CombinationIngredient` wrappers with post-antagonism weight data
- Each ingredient's `synergy_tags`, `compound_classes`, `category`, `traits`, `related_family`, `aesthetic_weight`
- `context.deferred_complementary_pairs` — pairs flagged by AntagonismRule as complementary based on intensity classification
- `context.solvent` — for fictional-solvent signature behavior
- The `synergy_pairs` and `tag_definitions` tables
- The combination's seeded PRNG (consistent access even if not always used)

## Outputs

Writes to `context`:

- Modifies each ingredient's `weight_data.potency_multiplier` (accumulated synergy boosts, subject to cap)
- Increments `context.sensory_erasure_count` (Lacuna only — drives sensory muting later)
- Sets `context.permanence_scale` (Lacuna only — drives duration extension)
- Adds `lacuna_subtractive_transmute` markers to effects (Lacuna only)
- Under Prism, sets `context.synergy_scope_multiplier` (drives sensory scope widening)
- Appends human-readable notes to `context.warnings`

Synergy never causes pipeline failure — it can only strengthen or transform, not fail. No `failure_reason` values come from this rule.

---

## The Five Synergy Patterns

Five ordered patterns, each handling a distinct source of synergy.

### Pattern 1 — Related-family synergy

Two ingredients that share a `related_family` value synergize because they share related chemistry or origin.

**Data source:**

- **Botanicals** — `related_family` auto-populated during Trefle sync with the plant's Trefle family
- **Non-Botanicals** — curated manually as seed data (e.g., `volcanic-glass` for obsidian + pumice + tektite; `canid` for wolf bone + fox tooth; `iron-based-residue` for rust + meteoric iron)

**Direction:** mutual. Both ingredients reinforce each other equally.

**Boost:** 0.3 flat.

### Pattern 2 — Shared compound-class synergy

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

### Pattern 3 — Tag-targets-compound synergy

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

### Pattern 4 — Complementary tag pairs

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

### Pattern 5 — Trait-driven synergy

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

- `chemical_extraction_weight` — how much extracted (modified by antagonism only)
- `potency_multiplier` — how effective what extracted is (modified by synergy only)

Downstream rules compute effective potency as `chemical_extraction_weight × potency_multiplier × ingredient.potency_base`.

Chained synergy compounds multiplicatively — each pass multiplies the accumulated multiplier, subject to the cap.

---

## Synergy Cap & Fictional Solvent Signatures

Each solvent type expresses a distinct signature through how synergy behaves under it.

|Solvent|Cap|Signature mechanic|
|---|---|---|
|Grounded|2.5×|Standard — synergies boost potency; sensory scales accordingly|
|Ichor|5.0×|Amplified — synergies push potency further; sensory scales up with potency|
|Prism|2.5×|Widened positively — each synergy sets `synergy_scope_multiplier` for sensory algorithm|
|Lacuna|2.5×|Subtractive transmutation + sensory muting + permanence scaling|

**Cap application:**

```
ingredient.weight_data.potency_multiplier = min(accumulated_multiplier, cap)
```

Cap depends on `context.solvent`. Read once at pipeline start; applied at the end of SynergyRule.

### Prism's signature — scope widening

Under Prism, each synergy that fires increments a `synergy_scope_multiplier` on the context. The sensory algorithm (downstream) reads this and applies broader scope to the final output:

- Each synergy widens color palette (more secondary color contribution)
- Each synergy adds an aroma note beyond the base perfumery layering
- Each synergy makes texture more distinct
- Overall: preparations under Prism feel _fuller_ without being _stronger_

Prism doesn't cap differently from grounded solvents — its signature is dimensional, not quantitative.

### Lacuna's signature — subtractive transmutation

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

## Algorithm — Sequential Passes

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

### Update 1: AntagonismRule Pattern 1 — opposite-tag detection

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

- `related_family` (string, nullable) — for related-family synergy in SynergyRule Pattern 1

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

- `deferred_complementary_pairs: array<{A, B, boost}>` — populated by AntagonismRule, consumed by SynergyRule
- `synergy_scope_multiplier: int` — Prism only
- `sensory_erasure_count: int` — Lacuna only
- `permanence_scale: float` — Lacuna only

### Update 4: Design reference document additions

The main `verdant_and_vile_design_reference.md` needs these additions in the Interaction Tags section:

**Note on scaled pairs:**

> Five pairs are _scaled_ — they classify as complementary or antagonistic based on the combined intensity of the ingredients involved. At low intensity they complement; at high intensity they cancel. See SynergyRule and AntagonismRule docs for the mechanic. The scaled pairs are: `warming` ↔ `cooling`, `stimulant-amplifier` ↔ `sedative-amplifier`, `dream-inducer` ↔ `lucidity-guard`, `time-dilator` ↔ `moment-anchor`, `disinhibitor` ↔ `will-fortifier`.

**Ingredient schema — add to Taxonomy:**

- `related_family` — string, nullable. Auto-populated for Botanicals from Trefle; manually curated for other categories.



## Rules Pipeline — DoseCurveRule

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

- `context.ingredients` — `CombinationIngredient` wrappers with post-synergy weight data
- Each ingredient's `compound_classes` (many-to-many with concentration weights from join table), `dose_response`, `potency_base`
- Each ingredient's authored dose-curve fields: `hormetic_threshold`, `activation_threshold`, `ceiling_value` (nullable — defaults if not authored)
- `context.solvent` — for fictional solvent signature behavior
- Each ingredient's `synergy_tags` and `antagonist_tags` — for Lacuna's bidirectional classification
- The combination's seeded PRNG (used by Prism for dose-response refraction)

## Outputs

Writes to `context`:

- Each ingredient's `weight_data.effective_potency` — final potency contribution after dose-curve evaluation (may be negative)
- Each ingredient's `weight_data.dose_state` — classification of dose-curve outcome
- `context.cumulative_loads` — Map<compound_class, float> for reference by downstream rules
- Appends warnings for notable dose-curve behaviors

On failure, writes:

- `context.failed = true`
- `context.failure_reason = 'extraction_impossible'` — when hormetic cascade net-negates the combination

---

## The Four Dose Response Types

Each ingredient carries a `dose_response` enum value describing how it responds to increasing cumulative load.

|Type|Behavior|
|---|---|
|`linear`|Potency scales cleanly with contribution. No special behavior. Default for most ingredients.|
|`hormetic`|Small cumulative load is beneficial; large load flips to harmful. Real chemistry — alcohol, exercise stress, low-dose stimulants, capsaicin all show this pattern.|
|`threshold`|No effect until cumulative load passes an activation threshold, then contributes full potency. Real chemistry — minimum-effective-dose behavior.|
|`ceiling`|Effect caps regardless of how much is added. Real chemistry — receptor saturation, many analgesics.|

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

- `chemical_extraction_weight` — how much of I actually extracted (from SolventMatchRule + AntagonismRule)
- `potency_multiplier` — synergy amplification (from SynergyRule)
- `potency_base` — the ingredient's inherent strength (1–10)
- `concentration` — how much of compound C is in ingredient I (from `ingredient_compounds` join table)

The result is a per-compound-class map: `{ alkaloid: 4.7, mineral-salt: 1.2, tannin: 3.1, ... }`

**Effective load per ingredient:** for each ingredient, the effective load it responds to is the _maximum_ cumulative_load across all its compound classes. This represents the "highest concentration environment" the ingredient is in.

```
effective_load(I) = max(cumulative_load[C] for C in I.compound_classes)
```

---

## Applying Dose Curves Per Ingredient

For each ingredient, apply its `dose_response` type against its `effective_load` and its authored (or default) threshold/ceiling values.

### `linear` — baseline

```
effective_potency = chemical_extraction_weight × potency_multiplier × potency_base
dose_state = 'linear'
```

No modification. Baseline behavior.

### `hormetic` — beneficial-then-harmful

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
- **0.7** under any fictional solvent (Ichor, Prism, Lacuna — flips hit harder in fictional contexts)

### `threshold` — activation-required

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

### `ceiling` — capped

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

### Ichor — permissive dose curves

Everything Ichor touches gets more room to work. Beneficial effects work harder before hitting limits; when things flip, they flip harder.

|Modifier|Value|Applied to|
|---|---|---|
|`hormetic_threshold`|+2.0|All `hormetic` ingredients|
|`ceiling_value`|+1.5|All `ceiling` ingredients|
|`activation_threshold`|-1.0|All `threshold` ingredients (activates more easily)|
|`hormetic_flip_severity`|0.7|When flips occur, they're more punishing|

**Modifiers are additive to authored values.** An ingredient with authored `hormetic_threshold: 6.0` becomes `8.0` under Ichor.

**Narrative reading:** Ichor makes ingredients more of what they are — good and bad. High-stakes solvent that rewards competence and punishes recklessness harder than grounded solvents.

### Prism — refracted response types

Prism changes _what dose response an ingredient has_ via seeded random. This is genuinely on-brand for refractive-alteration: the ingredient's fundamental behavior shifts, not just its numbers.

**Mechanic:**

At the start of DoseCurveRule under Prism, each ingredient's `dose_response` gets refracted through the seeded PRNG:

```
for each ingredient I:
  roll = prng.next()  // 0.0-1.0
  refracted_response = refractDoseResponse(I.ingredient.dose_response, roll)
```

**Refraction table** — probabilities of shifting to another response type:

|Original|Stays same|→ linear|→ hormetic|→ threshold|→ ceiling|
|---|---|---|---|---|---|
|`linear`|40%|—|20%|20%|20%|
|`hormetic`|40%|20%|—|20%|20%|
|`threshold`|40%|20%|20%|—|20%|
|`ceiling`|40%|20%|20%|20%|—|

40% chance of staying the same; 20% chance each for the three other types.

**Threshold/ceiling values are unchanged under Prism** — the _type_ of curve shifts, but the values it uses are the ingredient's authored values (or defaults). Prism transforms behavior; it doesn't amplify or diminish quantities.

**`hormetic_flip_severity` is 0.7 under Prism** (per the fictional-solvent rule).

**Narrative reading:** the same ingredient behaves differently under Prism each time — you can't predict its response. Linear ingredients might suddenly show threshold behavior; hormetic ingredients might behave like ceiling-capped ones. The refraction happens deterministically per combination (seeded), so the same recipe always produces the same refraction.

### Lacuna — bidirectional dose curves

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

### Update 1: Ingredient schema — new nullable fields

Add to the Reactive fields section:

```
hormetic_threshold: float, nullable, default 5.0 when dose_response = 'hormetic'
activation_threshold: float, nullable, default 3.0 when dose_response = 'threshold'
ceiling_value: float, nullable, default 4.0 when dose_response = 'ceiling'
```

All nullable — only relevant for their corresponding `dose_response` types.

### Update 2: `CombinationIngredient` weight_data — new fields

Add to the wrapper's `weight_data` object:

```
effective_potency: float (may be negative)
dose_state: enum (see rule output section for values)
```

### Update 3: Context — new field

```
context.cumulative_loads: Map<compound_class, float>
```

Written by DoseCurveRule, readable by downstream rules.

### Update 4: Design reference document

Add to the Ingredient Reactive section the three new nullable dose-curve value fields.

Add note to the Interaction Tags section that certain tags are classified as _subtractive_ or _building_ for Lacuna's dose-curve behavior. Reference this doc for the full lists.

### Update 5: No changes needed to previous rule docs

SolventMatchRule, AntagonismRule, and SynergyRule don't require any modifications. DoseCurveRule reads from their outputs cleanly.

## Rules Pipeline — StabilityRule

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

- `context.ingredients` — with all prior weight data
- Each ingredient's `stability_base`, `synergy_tags`, `antagonist_tags`, `traits`, `category`, `aesthetic_weight`
- Each ingredient's `weight_data.presence_weight` (used rather than chemical_extraction_weight — see design notes)
- `context.solvent` — with `stability_modifier` and slug for fictional signatures
- `context.outcome` — for outcome-specific stability characteristics
- The combination's seeded PRNG (used by Prism for stability refraction; used by `mercurial` trait resolution)

## Outputs

Writes to `context`:

- `context.stability` — final stability in days (float)
- `context.stability_state` — categorization enum
- Appends warnings for notable stability behaviors

On failure, writes:

- `context.failed = true`
- `context.failure_reason = 'insufficient_stability'` — when the preparation decays before it can be used

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

## Stage 1 — Base Stability from Ingredients

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

## Stage 2 — Category Composition Modifier

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

## Stage 3 — Outcome Type Modifier

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

## Stage 4 — Solvent Stability Modifier

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

## Stage 5 — Tag Effect Multipliers

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

## Stage 6 — Trait Effect Modifiers

Traits affect stability with more variety than tags. Some set floors, some apply multipliers per-instance, some introduce randomness.

### Positive stability traits

**`indestructible`** — sets a _floor_ on final stability. After all other stages complete, if the combination contains any indestructible ingredient with `aesthetic_weight > 0.3`, the final stability is at least **30 days**. If already higher, no change.

```
if any(t in i.traits and i.aesthetic_weight > 0.3 for i in ingredients where 'indestructible' in i.traits):
  indestructible_floor = 30
  // Applied at end of Stage 6
```

**`carrier`** — no direct stability effect. Carrier's stability contribution is already reflected via the presence_weight and extraction boosts it provided in earlier rules.

**`quiescent`** — contributes 1.4× multiplier per quiescent ingredient in the combination. Compounds multiplicatively across ingredients.

```
for each ingredient with 'quiescent' trait:
  stability *= 1.4
```

### Negative stability traits

**`volatile`** — 0.6× multiplier per volatile ingredient, scaled by aesthetic_weight:

```
for each ingredient with 'volatile' trait:
  scaled = 1 + (0.6 - 1) × i.aesthetic_weight
  stability *= scaled
```

**`decaying`** — 0.4× multiplier + spreads decay. For each decaying ingredient in the combination:

```
scaled = 1 + (0.4 - 1) × i.aesthetic_weight
stability *= scaled

// Contamination spread: reduce presence_weight of other ingredients by 10%
// (representing decay spreading through the preparation over the effective duration)
for each other ingredient j in combination:
  j.weight_data.presence_weight *= 0.9
```

The presence_weight reduction is a side effect that other rules may consult, but doesn't affect the stability value itself.

**`explosive`** — 0.5× multiplier per explosive ingredient, scaled by aesthetic_weight.

**`mercurial`** — under Prism, refracted (see Stage 7). Under other solvents, applies seeded-random multiplier in range 0.7×–1.4×:

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

## Stage 7 — Fictional Solvent Signatures

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

## Stage 8 — Minimum Stability Check

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

**Fictional solvents bypass this check** — they always produce something regardless of stability arithmetic. Ichor preparations may last hours; Prism preparations may last unpredictable durations; Lacuna preparations may last forever. All valid results.

**Indestructible presence bypasses this check** — the trait's floor makes insufficient stability impossible when it applies.

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



## Rules Pipeline — ToxicityRule

The sixth rule in the combination pipeline. Computes three orthogonal dimensions of toxicity (somatic, psychic, sensory), gates against outcome-specific thresholds, and surfaces warnings at severity levels.

---

## Purpose

Model harm across three fundamentally different dimensions. Traditional single-scalar toxicity conflates unrelated things — a preparation that causes vomiting is different from one that erases memory, and both differ from one that removes the ability to hear. Each has distinct sources, distinct consequences, and distinct safety gates.

Runs after StabilityRule (all effective potencies and stability finalized) and before SignatureTransformRule.

## Pipeline Position

```
→ SolventMatchRule
→ AntagonismRule
→ SynergyRule
→ DoseCurveRule
→ StabilityRule
→ ToxicityRule        ← this rule
→ SignatureTransformRule
```

---

## Inputs

Reads from `context`:

- `context.ingredients` — with all prior weight data (`effective_potency`, `dose_state`, `presence_weight`, `chemical_extraction_weight`, `potency_multiplier`)
- Each ingredient's `toxicity_base`, `compound_classes`, `synergy_tags`, `antagonist_tags`, `traits`, `category`, `aesthetic_weight`
- `context.solvent`, `context.outcome`
- `context.stability_state` — highly unstable preparations concentrate somatic toxicity
- `context.cumulative_loads` — compound stacking drives somatic toxicity
- `context.sensory_erasure_count` — Lacuna sensory impact
- `context.permanence_scale` — Lacuna permanence amplifies psychic toxicity

## Outputs

Writes to `context`:

- `context.toxicity.somatic` — float 0–10
- `context.toxicity.psychic` — float 0–10
- `context.toxicity.sensory` — float 0–10
- `context.toxicity_state` — object with severity labels per dimension
- Appends warnings at 3/5/7 thresholds per dimension

On failure, writes:

- `context.failed = true`
- `context.failure_reason` — one of `lethal_somatic`, `lethal_psychic`, or `lethal_sensory`

---

## The Three-Dimensional Toxicity Model

Rather than a single toxicity value, three orthogonal dimensions each with distinct sources and consequences.

|Dimension|Represents|Primary sources|
|---|---|---|
|**Somatic**|Physical harm to the body|Ingredient toxicity_base, cumulative alkaloid/oxide/noxious-vapor load, corrosive tags, hormetic flips, solvent contributions|
|**Psychic**|Harm to mind, memory, identity, emotion|Memory/identity/emotional tag interactions, boundary manipulation, permanence effects, Lacuna's psychic transmutations|
|**Sensory**|Harm to perception itself|Sensory erasure count, hallucinogenic stacking, perception-shifter interactions, time-distortion effects, sensory-removal tags|

Each dimension scales 0–10 and is computed by its own parallel pass. Outcome-specific gates check each dimension independently.

---

## Pass 1 — Somatic Toxicity

Physical harm to the body.

### Toxicity_base mapping

```
toxicity_base value → numeric contribution
  none    → 0
  low     → 1.5
  medium  → 3
  high    → 5
  lethal  → 8
```

### Sources

**Ingredient baseline:**

```
for each I in context.ingredients:
  base = toxicity_mapping[I.ingredient.toxicity_base]
  potency_factor = min(I.weight_data.effective_potency / 5, 1.0)  // normalize to 0-1
  somatic += base × potency_factor × I.ingredient.aesthetic_weight
```

**Compound-class load contributions:**

```
if cumulative_loads['alkaloid'] > 6:
  somatic += (cumulative_loads['alkaloid'] - 6) × 1

if cumulative_loads['oxide'] > 4:
  somatic += (cumulative_loads['oxide'] - 4) × 0.5

if cumulative_loads['unknown-substance'] > 3:
  somatic += (cumulative_loads['unknown-substance'] - 3) × 2

if cumulative_loads['noxious-vapor'] > 2:
  somatic += (cumulative_loads['noxious-vapor'] - 2) × 2
```

**Corrosive/damaging tag contributions:**

```
somatic_damaging_tags = ['denaturant']  // may expand later
for each ingredient with any tag in somatic_damaging_tags:
  somatic += 1 × I.ingredient.aesthetic_weight
```

**Hormetic flip contributions:**

```
for each I in context.ingredients where I.weight_data.dose_state == 'hormetic_harmful':
  somatic += 2 × I.ingredient.aesthetic_weight
```

**Solvent contributions:**

```
solvent_somatic = {
  water: 0, spirits: 0, oil: 0,
  vinegar: 0.5,
  honey: 0,
  ichor: 1,
  prism: 0.5,
  lacuna: 0
}
somatic += solvent_somatic[solvent.slug]
```

**Stability multiplier:**

```
if context.stability_state == 'critically_unstable':
  somatic *= 1.5
```

**Cap at 10:**

```
somatic = min(somatic, 10)
```

---

## Pass 2 — Psychic Toxicity

Harm to mind, memory, identity, emotion.

Baseline starts at 0 — unlike somatic, no per-ingredient default. Psychic toxicity emerges from interactions.

### Sources

**Memory and identity tag interactions:**

Detect pairs across ingredients. If any pair of ingredients carries the matching tag combination, apply the contribution once:

```
if any_ingredient_has('amnesiac') and any_ingredient_has('bioavailability-booster'):
  psychic += 2  // aggressive memory erasure

if any_ingredient_has('mnemonic') and any_ingredient_has('disinhibitor'):
  psychic += 2  // forced false memory

if any_ingredient_has('echo-binder') and any_ingredient_has('boundary-thinner'):
  psychic += 2  // identity-blurring capture
```

**Base disinhibitor contribution:**

```
if any_ingredient_has('disinhibitor'):
  psychic += 1  // compulsion is psychic weight
```

**Boundary interactions:**

```
has_thinner = any_ingredient_has('boundary-thinner')
has_sealer = any_ingredient_has('boundary-sealer')

if has_thinner and not has_sealer:
  psychic += 2  // unbounded psychic exposure
// If both present, they cancel — see AntagonismRule Pattern 1
```

**Sedative/stimulant extreme stacking:**

```
stim_ingredients = [I for I in ingredients if 'stimulant-amplifier' in tags]
sed_ingredients = [I for I in ingredients if 'sedative-amplifier' in tags]

combined_intensity = sum(I.chemical_extraction_weight × I.aesthetic_weight
                         for I in stim_ingredients ∪ sed_ingredients)

if combined_intensity > 2.0:  // past the straining threshold from scaled pair mechanic
  psychic += 1.5  // incoherent nervous state
```

**Permanence scaling (Lacuna):**

```
if solvent.slug == 'lacuna' and context.permanence_scale >= 2.0:
  psychic *= 1.5  // permanent psychic effects are worse than temporary
```

**Lacuna subtractive transmutation contributions:**

```
psychic_domain_effects = ['memory', 'emotion', 'identity']
for each transmute_marker in context.lacuna_transmute_markers:
  if transmute_marker.effect_domain in psychic_domain_effects:
    psychic += 1
```

**Cap at 10:**

```
psychic = min(psychic, 10)
```

---

## Pass 3 — Sensory Toxicity

Harm to perception itself.

### Sources

**Sensory erasure (Lacuna):**

```
psychic += context.sensory_erasure_count × 1.5
```

**Hallucinogenic stacking:**

```
hallucinogenic_count = count ingredients with 'hallucinogenic-amplifier'
sensory += hallucinogenic_count × 1

if hallucinogenic_count > 0 and not any_ingredient_has('reality-anchor'):
  sensory += 2  // unbounded perceptual distortion
```

**Perception-shifter interactions:**

```
if any_ingredient_has('perception-shifter') and any_ingredient_has('boundary-thinner'):
  sensory += 2  // perception + reduced defense

shifter_count = count ingredients with 'perception-shifter'
if shifter_count > 1:
  sensory += (shifter_count - 1) × 1  // stacked shifters
```

**Time-distortion effects:**

```
if any_ingredient_has('time-dilator') and any_ingredient_has('hallucinogenic-amplifier'):
  sensory += 2  // time-distorted hallucination is particularly damaging
```

**Sensory-removal tags:**

```
silencer_intensity = sum for I in ingredients with 'silencer' of:
  I.weight_data.chemical_extraction_weight × I.ingredient.aesthetic_weight

if silencer_intensity > 0.5:
  sensory += 2  // removing hearing is sensory harm

if any_ingredient_has('veil-drawer') and solvent.slug == 'lacuna':
  sensory += 1.5  // unfindability approaches sensory absence
```

**Lacuna sensory transmutation:**

```
sensory_domain_effects = ['sight', 'sound', 'perception', 'sensation']
for each transmute_marker in context.lacuna_transmute_markers:
  if transmute_marker.effect_domain in sensory_domain_effects:
    sensory += 1
```

**Cap at 10:**

```
sensory = min(sensory, 10)
```

---

## Outcome-Specific Gates

After all three dimensions computed, check each against its outcome-specific threshold. If any exceeds, the pipeline fails with the corresponding failure reason.

|Outcome|Somatic gate|Psychic gate|Sensory gate|Delivery notes|
|---|---|---|---|---|
|`eye-drops`|≥ 4|≥ 6|≥ 5|Directly on fragile tissue|
|`potion`|≥ 8|≥ 8|≥ 8|Full ingestion|
|`concentrate`|≥ 7|≥ 7|≥ 8|Concentrated ingestion|
|`reduction`|≥ 8|≥ 8|≥ 8|Full ingestion|
|`balm`|≥ 8|≥ 9|≥ 9|Transdermal, slow|
|`liniment`|≥ 7|≥ 9|≥ 9|Rubbed in, moderate absorption|
|`aromatic`|≥ 9|≥ 7|≥ 6|Scent to nose, some psychic pathway|
|`sachet`|≥ 9|≥ 8|≥ 8|Passive slow release|
|`vapors`|≥ 8|≥ 6|≥ 5|Inhalation → rapid to lungs/brain|
|`pellet`|≥ 8|≥ 8|≥ 8|Slow-dissolve ingestion|
|`paste`|≥ 8|≥ 8|≥ 8|Full ingestion typically|
|`powder-balls`|≥ 8|≥ 8|≥ 8|Full ingestion|
|`veil`|≥ 9|≥ 8|≥ 7|Atmospheric, ambient exposure|

**Guiding principle:** direct-to-brain pathways (Vapors, Eye Drops) → tighter gates. Direct-to-perception pathways (Aromatic scent, Veil atmosphere) → tighter sensory gates. Topicals get generous gates but real gates — transdermal delivery matters (nicotine patches, scopolamine patches, transdermal opioids are all real precedents).

### Gate check

```
gates = OUTCOME_GATES[context.outcome]

if context.toxicity.somatic >= gates.somatic:
  return fail(context, 'lethal_somatic')

if context.toxicity.psychic >= gates.psychic:
  return fail(context, 'lethal_psychic')

if context.toxicity.sensory >= gates.sensory:
  return fail(context, 'lethal_sensory')
```

Somatic checked first, then psychic, then sensory — matches severity intuition (physical death is checked before psychic damage; psychic damage before perceptual damage). Only the first failure fires.

---

## Warning Thresholds

Warnings surface regardless of whether a dimension exceeds its gate — the user gets full information about the preparation's toxicity profile.

|Threshold|Somatic warning|Psychic warning|Sensory warning|
|---|---|---|---|
|≥ 3|may cause physical discomfort|may affect thought or emotion|may alter perception|
|≥ 5|significant physical toxicity|significant psychic impact|significant sensory distortion|
|≥ 7|dangerous physical toxicity|dangerous psychic burden|dangerous perceptual damage|

Warnings apply cumulatively — a somatic value of 8 triggers all three warnings.

---

## Toxicity State Object

The categorization object attached to `context.toxicity_state`:

```
context.toxicity_state = {
  somatic: 'safe' | 'mild' | 'significant' | 'dangerous' | 'lethal',
  psychic: 'safe' | 'mild' | 'significant' | 'dangerous' | 'lethal',
  sensory: 'safe' | 'mild' | 'significant' | 'dangerous' | 'lethal'
}
```

Ranges:

- `safe`: < 3
- `mild`: 3 – 5
- `significant`: 5 – 7
- `dangerous`: 7 – outcome-gate
- `lethal`: >= outcome-gate

---

## Failure Reasons

Enum values ToxicityRule can set on `failure_reason`:

|Value|Cause|User message hint|
|---|---|---|
|`lethal_somatic`|Somatic toxicity ≥ outcome's somatic gate|"The preparation would be physically dangerous to use in this form."|
|`lethal_psychic`|Psychic toxicity ≥ outcome's psychic gate|"The preparation would cause dangerous harm to mind or memory in this form."|
|`lethal_sensory`|Sensory toxicity ≥ outcome's sensory gate|"The preparation would cause dangerous perceptual damage in this form."|

The failure reason tells the user _which dimension_ made the preparation unsafe — often actionable information ("try a different outcome" if it's outcome-gate-specific).

---

## Pseudo-code

```
function ToxicityRule(context):
  somatic = computeSomaticToxicity(context)
  psychic = computePsychicToxicity(context)
  sensory = computeSensoryToxicity(context)

  // Cap each at 10
  context.toxicity = {
    somatic: min(somatic, 10),
    psychic: min(psychic, 10),
    sensory: min(sensory, 10)
  }

  // Gate checks — first failure fires
  gates = OUTCOME_GATES[context.outcome]

  if context.toxicity.somatic >= gates.somatic:
    return fail(context, 'lethal_somatic')

  if context.toxicity.psychic >= gates.psychic:
    return fail(context, 'lethal_psychic')

  if context.toxicity.sensory >= gates.sensory:
    return fail(context, 'lethal_sensory')

  // Warnings
  addToxicityWarnings(context)

  // Categorization
  context.toxicity_state = {
    somatic: categorizeToxicity(context.toxicity.somatic, gates.somatic),
    psychic: categorizeToxicity(context.toxicity.psychic, gates.psychic),
    sensory: categorizeToxicity(context.toxicity.sensory, gates.sensory)
  }

  return context


function categorizeToxicity(value, gate):
  if value >= gate: return 'lethal'
  if value >= 7: return 'dangerous'
  if value >= 5: return 'significant'
  if value >= 3: return 'mild'
  return 'safe'


function addToxicityWarnings(context):
  s = context.toxicity.somatic
  p = context.toxicity.psychic
  x = context.toxicity.sensory

  if s >= 3: context.warnings.push('may cause physical discomfort')
  if s >= 5: context.warnings.push('significant physical toxicity')
  if s >= 7: context.warnings.push('dangerous physical toxicity')

  if p >= 3: context.warnings.push('may affect thought or emotion')
  if p >= 5: context.warnings.push('significant psychic impact')
  if p >= 7: context.warnings.push('dangerous psychic burden')

  if x >= 3: context.warnings.push('may alter perception')
  if x >= 5: context.warnings.push('significant sensory distortion')
  if x >= 7: context.warnings.push('dangerous perceptual damage')
```

---

## Design Notes

**Why three dimensions rather than one scalar:** A single toxicity value conflates fundamentally different kinds of harm. A preparation that causes vomiting is not the same as one that erases memory, and neither is the same as one that removes hearing. These have distinct sources (chemistry vs. tag interactions vs. sensory-erasure counts) and distinct consequences (physical damage may heal; identity damage may not; perceptual damage is a separate category entirely). Modeling them as one number would force arbitrary weighting decisions and lose interpretability. Three dimensions makes the rule expressive enough to encode real safety intuitions.

**Why outcome-specific gates rather than uniform thresholds:** Different preparation forms have different delivery pathways to the body and mind. Eye Drops touch fragile tissue directly; Vapors travel through the lungs to the brain in seconds; Balms deliver slowly through skin; Sachets release passively over hours. A uniform threshold either over-restricts safe preparations (a mild psychic-effect Balm would be blocked at the same level as a dangerous psychic-effect Eye Drop) or under-restricts dangerous ones (a Vapor with unbounded hallucinogenic content would pass a Balm's threshold). Outcome-specific gates encode real delivery-pathway safety.

**Why topicals have psychic and sensory gates at all:** Transdermal delivery is real. Nicotine patches, scopolamine patches, transdermal opioids, and many transdermal medications reach the bloodstream and affect the nervous system. Excluding topicals from psychic/sensory gates would create a loophole where dangerous mind-affecting preparations could be made as balms or liniments to bypass safety checks. The gates are permissive (9 for topical psychic/sensory) because delivery is slower, but they exist.

**Why toxicity_base uses a non-linear mapping (none=0, low=1.5, medium=3, high=5, lethal=8):** A linear mapping (0/2/4/6/8) would treat "high" and "medium" as too close in severity. The jump from medium to high should feel significant, and the jump from high to lethal even more so. Non-linear mapping better matches how these categories are perceived — "lethal" ingredients should be a real jump above "high," not merely one increment.

**Why hormetic flip contributions to somatic are +2 rather than tied to potency:** A flipped hormetic ingredient is _actively harmful_ by design. Its `effective_potency` is already negative from DoseCurveRule — that's captured downstream. But hormetic flips also register as somatic toxicity because they represent chemistry going wrong in ways that damage the body specifically. A flat +2 contribution acknowledges this without doubling up on the potency mechanic.

**Why unstable stability multiplies somatic toxicity:** Decayed preparations are physically dangerous in ways beyond their base chemistry — bacterial contamination, breakdown products, rancid oils. Modeling this as a 1.5× multiplier on somatic (only) captures the real "spoiled food is dangerous" mechanic without affecting psychic or sensory (which decay affects differently or not at all).

**Why baseline psychic is 0 rather than per-ingredient:** Physical toxicity has a per-ingredient baseline because physical harm is intrinsic to certain substances (toxic plants, corrosive minerals). Psychic toxicity emerges from _interactions_ — no ingredient is intrinsically "psychically toxic" in isolation. A memory-altering ingredient alone is fine; combining it with amplifiers and permanence mechanics is what makes it harm identity. Starting psychic at 0 and building only from interactions matches this reality.

**Why Lacuna gets a permanence multiplier on psychic but not somatic:** Lacuna's harm is fundamentally _identity-and-memory-shaped_ — its permanence mechanic applies to psychic effects specifically. Somatic damage from Lacuna preparations is real (via ingredient chemistry) but not amplified by permanence — a bruise doesn't become permanent just because Lacuna made the effect long-lasting. Psychic damage, by contrast, is exactly the domain where permanence matters most.

**Why gate checks fire in order (somatic → psychic → sensory):** Only the first exceeded gate fires the failure. Ordering matters because it determines which reason the user sees. Somatic first because physical death is the most severe and most immediately checkable. Psychic next because mind damage is severe but sometimes recoverable. Sensory last. This ordering matches how a real user would prioritize warnings if all three fired simultaneously — "you'd die from this" is more important information than "this would damage your perception."

**Why warnings surface at 3/5/7 regardless of gate values:** The warnings inform the user about the preparation's toxicity profile independent of whether it succeeds. A user preparing a Balm with psychic toxicity 6 gets a "significant psychic impact" warning even though the preparation succeeds (Balm psychic gate is 9). This helps users understand what they're making without excessive gating. Failure exists for genuinely dangerous outcomes; warnings exist for informed choice.

---

## Cross-Rule Updates Required

### Update 1: Design reference document

Add to the Combination schema section:

```
toxicity: {
  somatic: float 0-10,
  psychic: float 0-10,
  sensory: float 0-10
}
toxicity_state: {
  somatic: enum ('safe' | 'mild' | 'significant' | 'dangerous' | 'lethal'),
  psychic: enum (same values),
  sensory: enum (same values)
}
```

Add to failure_reason enum:

- `lethal_somatic` (replaces the single `lethal_toxicity`)
- `lethal_psychic`
- `lethal_sensory`

### Update 2: `lacuna_transmute_markers` context field

Referenced by both SynergyRule and ToxicityRule. Structure:

```
context.lacuna_transmute_markers: array<{
  ingredient_id: string,
  original_effect: string,
  transmuted_effect: string,
  effect_domain: 'memory' | 'emotion' | 'identity' | 'sight' | 'sound' | 'perception' | 'sensation' | 'time' | 'other'
}>
```

Written by SynergyRule when applying Lacuna's subtractive transmutation. Read by ToxicityRule to determine psychic and sensory contributions.

### Update 3: No changes needed to previous rule docs

SolventMatchRule, AntagonismRule, DoseCurveRule, and StabilityRule don't require modifications. Only SynergyRule needs to write `lacuna_transmute_markers` with the `effect_domain` field — this was implicit in the SynergyRule doc but should be explicit.



# Rules Pipeline — SignatureTransformRule

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

- `context.solvent` — determines whether the rule does anything and which branch runs
- `context.ingredients` — for final composition context in warnings
- `context.effects` — the resolved effects (which get transformed)
- `context.sensory_output` — the resolved sensory presentation (which gets modified)
- `context.stability`, `context.stability_state` — for context in narrative wraps
- `context.toxicity`, `context.toxicity_state` — for context in narrative wraps

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

- Modifies `context.effects` — transformations applied per solvent
- Modifies `context.sensory_output` — final visual, aroma, texture, motion adjustments
- Adds `context.marks` — array of visible and perceptual signs left on the recipient
- Adds `context.narrative_wrap` — the framing text describing how the preparation manifests
- Appends to `context.warnings` — solvent-specific safety and consumption warnings

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