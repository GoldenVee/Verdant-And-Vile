<!-- Rule 7 of 9. Part of the rules pipeline; see ../design-reference.md for the
     pipeline overview and ./README.md for the full rule list. -->

# ToxicityRule

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

- `context.ingredients`: with all prior weight data (`effective_potency`, `dose_state`, `presence_weight`, `chemical_extraction_weight`, `potency_multiplier`)
- Each ingredient's `toxicity_base`, `compound_classes`, `synergy_tags`, `antagonist_tags`, `traits`, `category`, `aesthetic_weight`
- `context.solvent`, `context.outcome`
- `context.stability_state`: highly unstable preparations concentrate somatic toxicity
- `context.cumulative_loads`: compound stacking drives somatic toxicity
- `context.sensory_erasure_count`: Lacuna sensory impact
- `context.permanence_scale`: Lacuna permanence amplifies psychic toxicity

## Outputs

Writes to `context`:

- `context.toxicity.somatic`: float 0–10
- `context.toxicity.psychic`: float 0–10
- `context.toxicity.sensory`: float 0–10
- `context.toxicity_state`: object with severity labels per dimension
- Appends warnings at 3/5/7 thresholds per dimension

On failure, writes:

- `context.failed = true`
- `context.failure_reason`: one of `lethal_somatic`, `lethal_psychic`, or `lethal_sensory`

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

## Pass 1: Somatic Toxicity

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

## Pass 2: Psychic Toxicity

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

## Pass 3: Sensory Toxicity

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
