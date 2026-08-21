<!-- Rule 2 of 9. Part of the rules pipeline; see ../design-reference.md for the
     pipeline overview and ./README.md for the full rule list. -->

# AntagonismRule

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

- `context.ingredients`: array of `CombinationIngredient` wrappers with weight data from SolventMatchRule
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

### Pattern 1: Opposite-tag pairs

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

### Pattern 2: Tag-targets-compound

Some interaction tags act on specific compound classes. When Ingredient A has one of these tags and Ingredient B contains the targeted compound class, A antagonizes B.

Tag-target mappings (in `tag_definitions.targets`):

|Tag|Targets|
|---|---|
|`chelator`|`alkaloid`, `mineral-salt`|
|`denaturant`|`protein`, `mucilage`|
|`bioavailability-inhibitor`|any _(broad: reduces others' effective potency)_|
|`oxidizer`|`volatile-oil`, `flavonoid` _(via oxidative breakdown)_|
|`reducer`|`oxide` _(reverses oxidation state)_|

**Antagonism direction:** directional. Only the targeted ingredient's weight drops; the antagonizer's stays intact.

### Pattern 3: Trait-driven antagonism

Some traits create antagonism regardless of tags:

|Trait pattern|Effect|Direction|
|---|---|---|
|`explosive` + `catalyst` (any ingredient)|Dangerous instability|Bidirectional|
|`decaying` (any ingredient present)|Contaminates all others|Directional (from decaying to others)|
|`mercurial` + `shy`|Unpredictable interaction|Bidirectional, seeded-random severity|

**Antagonism direction:** varies per trait pattern; see the severity table below.

### Pattern 4: Category resistance amplification

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

- **Full antagonism** requires _both_ a high severity _and_ a dominant antagonizer: a weakly-extracted or low-aesthetic-weight antagonizer can only reduce its target so much
- **Chained antagonism**: if multiple antagonizers target the same ingredient, their reductions compound multiplicatively (each reduces the already-reduced weight)
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

- **Deterministic**: same combination always returns the same result (great for testing, debugging, reproducibility)
- **Varied across combinations**: different ingredient sets produce different random draws
- **Testable**: probabilistic mechanics can be unit-tested against known expected outputs given a fixed seed
- **Portfolio-worthy**: a defensible engineering pattern to explain in interviews

**In this rule specifically:** the `mercurial × shy` severity is drawn from a uniform distribution over [0.4, 0.7] using the seeded PRNG.

---

## Algorithm: Sequential Passes

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
