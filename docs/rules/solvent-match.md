<!-- Rule 1 of 9. Part of the rules pipeline; see ../design-reference.md for the
     pipeline overview and ./README.md for the full rule list. -->

# SolventMatchRule

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

- `context.solvent`: the chosen solvent record (with polarity, category_affinity, category_resistance, compatible_outcomes, signature_transformation)
- `context.outcome`: the chosen outcome type
- `context.ingredients`: the chosen ingredient records (with solubility, category)

## Outputs

Writes to `context`:

- `context.ingredients`: array of `CombinationIngredient` wrappers with weight data attached
- `context.solvent_validated`: boolean, `true` on successful pass

On failure, writes:

- `context.failed = true`
- `context.failure_reason`: one of the enum values below

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

- **`chemical_extraction_weight`**: how much of the ingredient's chemistry actually enters the medium. Read by SynergyRule, AntagonismRule, DoseCurveRule, ToxicityRule, and the reactive-shift portion of the sensory algorithm.
- **`presence_weight`**: how much the ingredient's physical/sensory character is present. Read by StabilityRule, SensoryAlgorithm (color, aroma, texture defaults), and outcome-specific structural rules (Sachet composition, Paste texture).

Insoluble ingredients typically have `chemical_extraction_weight = 0.0` but `presence_weight = 1.0` — they don't dissolve but they're physically present. This is real chemistry (activated charcoal, cellulose fiber, whole spices in mulled wine).

- **`extraction_yield_modifier`**: additive modifier applied later to any extraction-yield computation. Positive from affinity, negative from resistance.
- **`warnings`**: human-readable notes surfaced to the final result.

---

## Ordered Checks

Checks run in this order. Each is cheaper than the next; fail-fast on the first that fails.

### Check 1: Ingredient count

```
if context.ingredients.length == 0:
  fail(context, 'no_ingredients')
```

The UI gates minimum ingredient count, but the API layer enforces this as a safety check.

### Check 2: Solvent-outcome compatibility

```
is_fictional = solvent.signature_transformation != null

if outcome != 'sachet' and not is_fictional:
  if outcome not in solvent.compatible_outcomes:
    fail(context, 'outcome_incompatible')
```

- **Sachet** bypasses this check (it uses no solvent).
- **Fictional solvents** (Ichor, Prism, Lacuna) bypass this check: they work with all outcomes.
- **Grounded solvents** must have the chosen outcome in their `compatible_outcomes` array.

### Check 3: Ingredient solubility × solvent polarity

For each ingredient, classify its extraction match against the solvent using the [adjacency matrix](https://claude.ai/chat/bd037fbd-1200-4014-aecf-ff6f5d4b8e00#solubility--polarity-adjacency-matrix). Sets `chemical_extraction_weight`.

Special cases:

- **Sachet outcome** → all ingredients get weight 1.0, no polarity check.
- **Fictional solvent** → all ingredients get weight 1.0, no polarity check.
- **Grounded solvent** → matrix lookup determines the weight (1.0 / 0.7 / 0.5 / 0.3 / 0.0).

`presence_weight` is set independently — typically 1.0 for most ingredients, but reserved lower for edge cases like Pneuma ingredients in a resistant solvent (essences disperse without physical presence).

### Check 4: Category affinity and resistance

For each ingredient, check its category against the solvent's tiered affinity and resistance:

|Match|Modifier|Warning added?|
|---|---|---|
|Strong affinity|+0.30|No|
|Weak affinity|+0.15|No|
|Neutral (not listed)|0.00|No|
|Weak resistance|-0.25|Yes: "solvent resists {category} category"|
|Strong resistance|-0.50|Yes: "solvent strongly resists {category} category"|

Neutral is implicit — categories not listed in either affinity or resistance are treated as neutral. This keeps the API lean; documentation of what's neutral belongs in UI-facing docs.

### Check 5: Total-failure evaluation

After per-ingredient checks:

```
matched_count = count of ingredients where chemical_extraction_weight > 0

if matched_count == 0 and not is_fictional and outcome != 'sachet':
  fail(context, 'extraction_impossible')
```

If no ingredient at all can extract into the chosen solvent, the combination is impossible.

### Check 6: Sachet edge case

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

- **1.0 (perfect match)**: ingredient's solubility class matches solvent's polarity exactly
- **0.7 (adjacent match)**: chemistry-adjacent, real partial extraction (many polar compounds are also acid-soluble; some acid compounds are also water-soluble)
- **0.5 (universal)**: universal ingredients extract into anything but not optimally
- **0.3 (poor match)**: technical partial extraction of minor compatible components
- **0.0 (no match)**: no meaningful chemical extraction; `presence_weight` still 1.0

**Anti-solvent (Lacuna)**: not represented in the matrix because Lacuna bypasses the polarity check entirely. It preserves structure rather than dissolving; all ingredients get weight 1.0 through the fictional-solvent bypass.

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
