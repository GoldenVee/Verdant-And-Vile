# Verdant & Vile — Design Reference (v2, consolidated)

_A fictional apothecary API grounded in real botanical data and chemistry principles._

This document is the merged source of truth as of the end of design phase, replacing the earlier `verdant_and_vile_design_reference.md`. It absorbs all "Documented But Not Yet Backported" decisions from the handoff, and reconciles the small drifts noticed against actual seed data (aroma notes, `origin` enum, Trefle references).

For full mechanical detail on any rule, the individual rule docs remain authoritative. This document gives the shape; the rule docs give the math.

---

## Overview

**Verdant & Vile** is a portfolio backend project that models an apothecary shop where users combine ingredients with solvents to produce various apothecary outcomes. The system is grounded in real chemistry (extraction, pH, solubility, compound interactions) with fictional elements layered on top.

### Core design values

- **Solvent-agnostic naming** — v1 outcomes use generic terms; specialized named variants emerge in v2 as users discover solvent-specific paths
- **Scalable architecture over premature complexity** — the schema is forward-compatible; v1 ships lean, v2+ additions are additive
- **Fictional mechanics grounded in real chemistry** — real chemistry rules drive the algorithm; fictional ingredients bend those rules through their data values, not through special-case logic
- **Portfolio-worthy and interview-explainable** — every architectural choice has a defensible reason

### Approach

- **All ingredient data is hand-authored and locally stored.** An external botanical API (Trefle) was evaluated and rejected on data-quality grounds and because personal domain vetting is more valuable for interview conversation than an external dependency. Real ingredients are grounded in actual chemistry and history; fictional ingredients are wholly authored with internally consistent fictional chemistry.
- **Normalized relational schema** with tables for ingredients, tags, compound classes, aroma notes, and interaction rules
- **Pluggable rules pipeline** — chemistry mechanics are individual rule modules registered to a pipeline; adding a new mechanic means writing a new rule, not refactoring

---

## Categories (9)

Ingredients belong to exactly one category. Categories organize both narrative flavor and chemistry behavior.

| Category | Nature | Examples |
| --- | --- | --- |
| `botanical` | Real plants and plant parts | roots, leaves, flowers, seeds |
| `mineral` | Inorganic solids and salts | stones, crystals, ores |
| `fungal` | Mushrooms, molds, lichens | caps, spores, mycelium |
| `fauna-derived` | Animal-sourced materials | bones, scales, blood, venom |
| `alchemical` | Reaction residues and byproducts | ash, rust, charcoal, slag |
| `pneuma` | Pure intangibles — auras, essences, sealed breaths | captured dawn-air, distilled silence |
| `effluvia` | Corrupt intangibles — miasmas, gases, viral substances | swamp gas, sealed plague-air |
| `aberrant` | Broken-physics things that defy classification | anomalies, impossible fragments |
| `cosmic` | From-elsewhere substances with real chemistry | meteorite fragments, tektites, stardust |

---

## Traits (10)

Traits are essential natures — rare, defining qualities that describe _what an ingredient is_. Distinct from interaction tags (which describe _what an ingredient does_).

**How traits work:** Every trait has mechanical impact — either on the algorithm directly or on the generated narrative output. If a proposed quality has no mechanical hook (not even affecting generated description), it belongs in `lore`, not in the trait system.

**Cardinality:** most ingredients carry zero or one trait. Two-trait ingredients are possible but should be intentional; three or more is unusual.

### Locked v1 traits

| Trait | Essential nature | Rule branch |
| --- | --- | --- |
| `echoic` | Carries a captured-from-something quality | Destabilizes near its referent; colors generated description |
| `volatile` | Passively unstable, easily evaporated | Modifies stability calculation (Stage 6, StabilityRule); interacts with heat rules (v2) |
| `catalyst` | Modifies others' reactions without being consumed | Amplifies paired ingredients' extraction and effective potency (SynergyRule Pattern 5) |
| `indestructible` | Resists destruction and decay | Sets 30-day floor on final stability (Stage 6, StabilityRule); state marked `indefinite` |
| `mercurial` | Own properties shift in response to surroundings | Under non-Prism solvents, applies seeded-random stability multiplier 0.7×–1.4× |
| `shy` | Effects diminish under direct observation or measurement | Potency inversely correlates with combination complexity (mechanic partially deferred — Ectoplasm is only current example) |
| `carrier` | Exists to transport others | Low own potency; boosts paired active ingredients (SynergyRule Pattern 5, boost 0.6) |
| `quiescent` | Always inert; contributes mass without reactivity | Contributes stability without triggering reactive interactions (Stage 6, StabilityRule, 1.4× per instance) |
| `decaying` | Actively degrading in real time | Stability drops (0.4× multiplier) and spreads decay to other ingredients (reduces their `presence_weight` by 10%) |
| `explosive` | Actively unstable (distinct from volatile's passive instability) | 0.5× stability multiplier per instance; bidirectional antagonism 0.9 severity when paired with `catalyst` trait |

### v2 deferred candidates

- `sympathetic` — resonates with what it was once near
- `latent` — inert until activated by something specific _(and its activator sub-family: `latent-acid`, `latent-heat`, `latent-catalyst`, etc.)_
- `sentient` — has some form of awareness; may resist certain uses
- `unwilling` — sentient-adjacent but simpler (resistance without choice)
- `sealed` — properties locked away; require breaking-open through specific preparation

**Rule of thumb:** most ingredients should carry zero or one trait. Traits are salt, not vegetables.

---

## Outcomes (13)

The possible products a combination can produce. Each is a generic solvent-agnostic form; v2 introduces named specialized variants that emerge from specific solvent choices.

### Group: Drinkable

| Outcome | Solvent path | v2 emergent variants |
| --- | --- | --- |
| `potion` | Water, Spirits, Vinegar, Honey | Draught (water), Cordial (spirits) |
| `concentrate` | Water, Spirits, Oil, Vinegar | Tincture (spirits), Acidulate (vinegar), Oil-extract (oil) |
| `reduction` | Water, Vinegar, Honey | Syrup, Hydromel (honey), Oxymel (vinegar+honey), Shrub |

### Group: Topical

| Outcome | Solvent path | v2 emergent variants |
| --- | --- | --- |
| `liniment` | Water, Spirits, Oil, Vinegar | Embrocation (spirits), Massage oil (oil), Herbal wash (water) |
| `balm` | Oil, Honey (with wax) | Salve (wax), Ointment (fat), Plaster (resin), Pomade (butter) |

### Group: Olfactory

| Outcome | Solvent path | v2 emergent variants |
| --- | --- | --- |
| `aromatic` | Water, Spirits, Oil, Vinegar | Perfume (spirits), Attar (oil), Solid perfume (wax), Hydrosol (water) |
| `sachet` | _(no solvent)_ | Binder/wrap variations |
| `vapors` | Water, Spirits, Oil, Vinegar | Smelling Salts (alkaline), Aromatic vapors (herbal), Reviving essence (Pneuma) |

### Group: Solid

| Outcome | Solvent path | v2 emergent variants |
| --- | --- | --- |
| `pellet` | Spirits, Honey | Lozenge (honey), Drop (sugar), Resinous pellet, Wax pearl |
| `paste` | Water, Oil, Vinegar, Honey | Electuary (honey), Salve-paste (oil), Sour paste (vinegar) |
| `powder-balls` | Water, Spirits, Vinegar, Honey | Binder variations |

### Group: Misc

| Outcome | Solvent path | v2 emergent variants |
| --- | --- | --- |
| `veil` | Water, Spirits, Oil, Vinegar | Mist (water), Storm-veil (petrichor), Dawn-veil (dew) |
| `eye-drops` | Water, Oil, Honey | Standard (water), Pneuma-laced (dew), Manuka-drops (honey) |

---

## Solvents (8)

### Grounded (5)

Real solvents with real chemistry. Each has restricted outcome compatibility based on chemistry-honest limits.

| Solvent | Polarity | pH | Stability × | Notes |
| --- | --- | --- | --- | --- |
| `water` | polar | 7.0 | 0.7× | Universal fresh baseline |
| `spirits` | polar/universal | 6.5 | 2.0× | Alcohol-based extraction |
| `oil` | nonpolar | N/A | 1.3× | For lipid-soluble compounds |
| `vinegar` | acid-soluble | 2.5 | 1.5× | Acid extraction |
| `honey` | polar (universal notes) | 4.0 | 3.0× | Preservative-rich |

**Full affinity and resistance tables live in the SolventMatchRule doc.** They use a tiered structure (`strong`/`weak` affinity, `strong`/`weak` resistance) that yields `+0.30`/`+0.15`/`-0.25`/`-0.50` extraction-yield modifiers per ingredient category.

### Fictional (3)

Bypass outcome-compatibility gates. Compatible with **all** outcomes. Each applies a **signature transformation** to the result (see SignatureTransformRule for full detail).

| Solvent | Polarity | pH | Stability × | Signature transformation |
| --- | --- | --- | --- | --- |
| `ichor` | polar | variable | 0.4× | `additive-elevation` — you become more (golden mark) |
| `prism` | universal | N/A | 1.0× | `refractive-alteration` — you become other (iridescent mark) |
| `lacuna` | anti-solvent | N/A | 5.0× | `subtractive-erasure` — you become less (absence mark) |

### Outcome × solvent matrix (grounded)

| Outcome | Water | Spirits | Oil | Vinegar | Honey |
| --- | --- | --- | --- | --- | --- |
| Potion | ✓ | ✓ |  | ✓ | ✓ |
| Concentrate | ✓ | ✓ | ✓ | ✓ |  |
| Reduction | ✓ |  |  | ✓ | ✓ |
| Liniment | ✓ | ✓ | ✓ | ✓ |  |
| Balm |  |  | ✓ |  | ✓ |
| Aromatic | ✓ | ✓ | ✓ | ✓ |  |
| Sachet | _(no solvent)_ |  |  |  |  |
| Vapors | ✓ | ✓ | ✓ | ✓ |  |
| Pellet |  | ✓ |  |  | ✓ |
| Paste | ✓ |  | ✓ | ✓ | ✓ |
| Powder Balls | ✓ | ✓ |  | ✓ | ✓ |
| Veil | ✓ | ✓ | ✓ | ✓ |  |
| Eye Drops | ✓ |  | ✓ |  | ✓ |

---

## Ingredient Schema

### Meta (identifiers)

- `id`
- `slug`
- `name`

### Taxonomy (what this ingredient is)

- `lore` — narrative flavor text (voice-of-apothecary, no em dashes)
- `origin` — enum: `real` | `fictional`
- `scientific_name` — string, nullable (only populated when `origin = real`, e.g., "Digitalis purpurea")
- `appearance_text` — descriptive prose
- `appearance_img` — nullable, for v2 art assets
- `type` — one of 62 (see Ingredient Types section)
- `category` — one of 9 (see Categories section)
- `traits` — array of trait values (typically 0–1, extensible)
- `compound_classes` — many-to-many via `ingredient_compounds` join table with `concentration` weight (0.0–1.0)
- `related_family` — string, nullable. Manually curated for all categories. Groups ingredients that share related chemistry or origin for the SynergyRule Pattern 1 boost. Examples: `Solanaceae` (Belladonna, Mandrake); `Asteraceae` (Chamomile, Wormwood, Yarrow); `quartz-crystals` (Amethyst, Tiger's Eye); `hoarfrost-captures` (Rime Frost).

### Reactive (chemistry)

| Field | Type | Values |
| --- | --- | --- |
| `solubility` | enum | `polar` \| `nonpolar` \| `acid-soluble` \| `universal` \| `insoluble` |
| `ph_contribution` | int, nullable | -3 to +3 (null for insoluble ingredients) |
| `toxicity_base` | enum | `none` \| `low` \| `medium` \| `high` \| `lethal` |
| `stability_base` | int | 1–10 (days of viability baseline) |
| `extraction_yield` | float | 0.0–1.0 (0 for insoluble ingredients) |
| `potency_base` | int | 1–10 |
| `dose_response` | enum | `linear` \| `hormetic` \| `threshold` \| `ceiling` |
| `hormetic_threshold` | float, nullable | Only populated when `dose_response = hormetic`. Default 5.0 if unauthored. Effective load above this flips ingredient to harmful contribution. |
| `activation_threshold` | float, nullable | Only populated when `dose_response = threshold`. Default 3.0 if unauthored. Below this, ingredient contributes 0. |
| `ceiling_value` | float, nullable | Only populated when `dose_response = ceiling`. Default 4.0 if unauthored. Ingredient contribution caps at this value. |
| `heat_response` | enum (v2 hook) | `requires-heat` \| `destroyed-by-heat` \| `enhanced-by-heat` \| `neutral` |
| `synergy_tags` | array | from interaction-tag vocabulary |
| `antagonist_tags` | array | from interaction-tag vocabulary |

### Sensory (perceived qualities)

| Field | Type | Values / Notes |
| --- | --- | --- |
| `color_base` | hex string | Validated `#RRGGBB` |
| `color_secondary` | hex string, nullable | For streaks, swirls, gradients |
| `aroma_notes` | join table | With `position: top \| heart \| base` |
| `taste_profile` | object | 8 keys, each 0.0–1.0 (see below) |
| `texture` | object | `{ type, intensity }` (see below) |
| `sound` | string, nullable | Free-form flavor text |
| `temperature_feel` | enum | `cold` \| `neutral` \| `warming` \| `burning` |
| `luminosity` | enum | `dull` \| `glossy` \| `phosphorescent` \| `light-swallowing` |
| `motion_tendency` | enum | `still` \| `settling` \| `rising` \| `swirling` \| `pulsing` \| `churning` \| `effervescent` \| `seeking` \| `layered` \| `restless` |
| `aesthetic_weight` | float | 0.0–1.0 (dominance in sensory output, used everywhere as scaling factor) |

**Taste profile keys:** `sweet` | `bitter` | `sour` | `salty` | `umami` | `astringent` | `metallic` | `bright`

**Texture type enum:** `viscous` | `thin` | `gritty` | `effervescent` | `crystalline` | `oily` | `waxy` | `powdery` | `fibrous`

---

## Compound Classes (19)

Compound classes drive solvent extraction profiles and rule logic. They describe what an ingredient is _made of_, not what it _does_. Attached to ingredients via the `ingredient_compounds` join table with a `concentration` weight.

### Real (14)

| Class | Description |
| --- | --- |
| `alkaloid` | Nitrogen-containing bioactives (caffeine, morphine, nicotine) |
| `tannin` | Astringent polyphenols (tea, oak bark) |
| `resin` | Viscous plant secretions (frankincense, myrrh) |
| `volatile-oil` | Aromatic essential oils (includes terpenes) |
| `mucilage` | Gel-forming polysaccharides (slippery elm, marshmallow) |
| `polysaccharide` | Long-chain sugars (fiber, starch) |
| `glycoside` | Sugar-linked bioactives |
| `flavonoid` | Polyphenolic pigments |
| `saponin` | Foam-producing surfactants |
| `mineral-salt` | Inorganic ionic compounds |
| `protein` | Amino acid polymers |
| `lipid` | Fats, waxes |
| `oxide` | Metal oxides (rust, patina) |
| `carbon-residue` | Charred/burned residues (ash, charcoal, soot) |

### Fictional (5)

| Class | Signature category |
| --- | --- |
| `essence-vapor` | Pneuma |
| `noxious-vapor` | Effluvia |
| `void-fragment` | Cosmic |
| `unstable-compound` | Aberrant |
| `unknown-substance` | Any (catchall) |

---

## Aroma Notes (52)

Combined via perfumery-style top/heart/base positions.

**Fresh & bright** — `citrus` | `mint` | `green` | `ozone` | `petrichor` | `storm-air`

**Floral & sweet** — `floral` | `sweet` | `honied` | `caramelized` | `soap`

**Fruit** — `berry` | `stonefruit` | `apple` | `tropical`

**Herbal** — `herbaceous-green` | `herbaceous-soft` | `medicinal`

**Spice** — `warm-spice` | `sharp-spice` | `smoky-spice`

**Warm & animalic** — `musk` | `amber` | `leather` | `wax` | `oud`

**Woody & resinous** — `wood` | `resin` | `coffee`

**Mineral & elemental** — `mineral` | `metallic` | `salt` | `dust`

**Smoke & fire** — `smoke` | `ash`

**Earth & decay** — `earth` | `animal-decay` | `plant-decay` | `sulfur`

**Sharp & bitter** — `bitter-scent` | `sour` | `acrid`

**Aquatic** — `briney` | `seawater` | `wet-sand`

**Industrial** — `plastic` | `rubber`

**Dairy, nut & pantry** — `milky` | `nutty` | `bread`

**Fictional/surreal** — `void` | `paper` | `forgotten` | `stale` | `sickroom`

_Decay is always specified as `animal-decay` or `plant-decay`. If a future ingredient truly cannot be classified as either, that's a signal to reconsider whether decay is the right note._

---

## Ingredient Types (62)

Types describe physical form. A single type can appear across multiple categories (e.g., `dust` can be Mineral, Alchemical, or Cosmic).

**Plant parts (13)** — `root` | `leaf` | `flower` | `bark` | `seed` | `fruit` | `stem` | `sap` | `berry` | `pollen` | `wood` | `thorn` | `moss`

**Fungal & growth (5)** — `cap` | `spore` | `mycelium` | `lichen` | `bloom`

**Aquatic (1)** — `algae`

**Animal parts (13)** — `bone` | `shell` | `scale` | `feather` | `hair` | `fat` | `blood` | `organ` | `venom` | `chitin` | `horn` | `tooth` | `hide`

**Mineral/inorganic solids (6)** — `stone` | `crystal` | `salt` | `metal` | `ore` | `mineral`

**Particulate (4)** — `dust` | `ash` | `soot` | `powder-raw`

**Fluid/semi-fluid raw materials (4)** — `oil-raw` | `wax-raw` | `honey-raw` | `resin-raw`

**Process residues (3)** — `rust` | `slag` | `residue`

**Gaseous/atmospheric (3)** — `vapor` | `miasma` | `exhalation`

**Intangible/Pneuma-leaning (5)** — `essence` | `aura` | `breath` | `silence` | `resonance`

**Aberrant/Cosmic signature (4)** — `fragment` | `shard` | `filament` | `anomaly`

**Epistemic (1)** — `unknown`

---

## Interaction Tags

Interaction tags describe an ingredient's _behavior_ in combinations. Stored as a `tag_definitions` table for extensibility — new tags = insert new rows, no schema migration needed.

### Extraction & preparation dynamics

- `bioavailability-booster` ↔ `bioavailability-inhibitor` _(always antagonistic)_
- `emulsifier` ↔ `separator` _(always antagonistic)_
- `binder` ↔ `loosener` _(always antagonistic)_
- `preservative` ↔ `accelerant` _(always antagonistic)_
- `volatile-fixer` ↔ `volatile-releaser` _(always antagonistic)_
- `solvent-shifter` _(wild card: shifts other ingredients' compound classes)_
- `acid-releaser` ↔ `alkalizer` _(always antagonistic)_

### Compound-class interaction

These tags act on compound classes rather than opposing a single counterpart tag. They are not opposite-pairs; their interactions run through the tag-targets-compound patterns (AntagonismRule Pattern 2, SynergyRule Pattern 3).

- `alkaloid-carrier` _(boosts `alkaloid`)_
- `chelator` _(binds `alkaloid`, `mineral-salt`)_
- `denaturant` _(binds `protein`, `mucilage`)_

`alkaloid-carrier` and `chelator` stand in natural opposition (one boosts alkaloids, the other binds them), but that opposition is expressed through their compound-class targeting, not as an opposite-tag pair. They are deliberately absent from the opposite-pair list in the AntagonismRule doc.

### Effect amplification

- `stimulant-amplifier` ↔ `sedative-amplifier` — **scaled**

### Thermal & sensation

- `oxidizer` ↔ `reducer` _(always antagonistic)_
- `warming` ↔ `cooling` — **scaled**

### Physical transformation

- `coagulant`
- `crystallizer`
- `foaming-agent`
- `desiccant` ↔ `deliquescent` _(always antagonistic)_

### Protective chemistry

- `radical-scavenger`
- `stabilizer`

### Perception & mind

- `hallucinogenic-amplifier` ↔ `reality-anchor` _(always antagonistic)_
- `perception-shifter`
- `dream-inducer` ↔ `lucidity-guard` — **scaled**

### Memory & identity

- `mnemonic` ↔ `amnesiac` _(always antagonistic)_
- `silencer`

### Metaphysical / boundary

- `boundary-thinner` ↔ `boundary-sealer` _(always antagonistic)_
- `echo-binder` ↔ `echo-dampener` _(always antagonistic)_
- `veil-piercer` ↔ `veil-drawer` _(always antagonistic)_
- `resonance-tuner`

### Time perception

- `time-dilator` ↔ `moment-anchor` — **scaled**

### Attraction / repulsion

- `magnetizer` ↔ `repeller` _(always antagonistic)_

### Compulsion _(constrained: amplifies existing seams only, doesn't create from nothing)_

- `disinhibitor` ↔ `will-fortifier` — **scaled**

### Concentration / dilution

- `concentrator` ↔ `diffuser` _(always antagonistic)_

### Deferred to v2

- `combustive` _(requires combustion mechanic)_
- `exothermic-reactant` ↔ `endothermic-reactant` _(requires heat/temperature mechanics)_

### Scaled pair mechanic

Five pairs are marked **scaled** above. They classify as complementary or antagonistic based on the combined intensity of the ingredients involved, calculated in AntagonismRule Pattern 1. At low intensity they complement (deferred to SynergyRule Pattern 4B for boost application); at high intensity they cancel.

Intensity is calculated as:

```
combined_intensity = (A.chemical_extraction_weight × A.aesthetic_weight) +
                     (B.chemical_extraction_weight × B.aesthetic_weight)
```

Default thresholds per `synergy_pairs` row:

| Intensity range | Behavior |
| --- | --- |
| < 0.7 (complementary_ceiling) | Complement (boost 0.3, deferred to SynergyRule) |
| 0.7 – 1.4 (balanced_ceiling) | Balanced (no modifier) |
| 1.4 – 2.0 (straining_ceiling) | Weak antagonism (severity 0.3) |
| ≥ 2.0 | Full antagonism (severity 0.8) |

### Subtractive / building classification (Lacuna)

The DoseCurveRule classifies each tag as subtractive, building, or neutral for Lacuna's bidirectional dose-curve behavior.

**Subtractive tags** (Lacuna rewards these with permissive dose curves):

```
amnesiac, echo-dampener, veil-drawer, silencer, moment-anchor,
lucidity-guard, boundary-sealer, reality-anchor, concentrator,
chelator, stabilizer, preservative, repeller, will-fortifier,
cooling, desiccant, bioavailability-inhibitor, denaturant,
separator, loosener
```

**Building tags** (Lacuna penalizes these with hostile dose curves):

```
mnemonic, echo-binder, veil-piercer, boundary-thinner,
hallucinogenic-amplifier, stimulant-amplifier, sedative-amplifier,
bioavailability-booster, warming, emulsifier, binder,
acid-releaser, alkalizer, dream-inducer, magnetizer,
disinhibitor, diffuser, deliquescent, time-dilator,
volatile-fixer, volatile-releaser, accelerant
```

An ingredient qualifies as _subtractive_ if it has any tag in the subtractive set, _building_ if it has any tag in the building set. If it has neither (or both — cancellation), it's _neutral_. Physical-transformation tags (`coagulant`, `crystallizer`, `foaming-agent`) and protective-chemistry tags (`radical-scavenger`) are intentionally in neither list.

---

## Solvent Schema

- `id`
- `slug`
- `name`
- `lore`
- `polarity` — enum: `polar` | `nonpolar` | `acid-soluble` | `universal` | `anti-solvent`
- `base_ph` — float 0.0–14.0, nullable
- `extraction_profile` — array of compound_class ids
- `compatible_outcomes` — array of outcome enum values (fictional solvents: all)
- `stability_modifier` — float multiplier
- `heat_default` — enum (v2 hook): `cold` | `warm` | `hot`
- `aesthetic_base` — object: `{ color, viscosity, luminosity }`
- `category_affinity` — object: `{ strong: [category_ids], weak: [category_ids] }`
- `category_resistance` — object: `{ strong: [category_ids], weak: [category_ids] }`
- `signature_transformation` — nullable object: `{ type, summary }`
- `physical_form` — enum (v2 hook): `liquid` | `solid`

**Signature transformation types:** `additive-elevation` (Ichor) | `refractive-alteration` (Prism) | `subtractive-erasure` (Lacuna)

---

## Combination Schema

- `id`
- `name` — generated from result
- `lore` — generated description
- `type` — outcome enum
- `solvent` — solvent reference
- `ingredients` — via `combination_ingredients` join with `quantity` field (default 1, for v2 dosage)
- `modifiers` — computed potency, pH after rules
- `effects` — array of computed effects (see Effect Schema below)
- `warnings` — array of non-fatal issues surfaced by rules
- `failed` — boolean
- `failure_reason` — nullable enum, one of:
  - `no_ingredients`
  - `outcome_incompatible`
  - `extraction_impossible`
  - `total_antagonism`
  - `insufficient_stability`
  - `lethal_somatic`
  - `lethal_psychic`
  - `lethal_sensory`
  - `unknown`
- `sensory_output` — object computed by sensory algorithm: `{ color_base, color_secondary, aroma_profile, taste_profile, texture, motion_tendency, luminosity, temperature_feel, sound }`
- `stability` — float, final stability in days
- `stability_state` — enum: `critically_unstable` | `unstable` | `moderately_stable` | `stable` | `highly_stable` | `indefinite`
- `toxicity` — object: `{ somatic: float 0–10, psychic: float 0–10, sensory: float 0–10 }`
- `toxicity_state` — object: `{ somatic: enum, psychic: enum, sensory: enum }` where each enum is `safe` | `mild` | `significant` | `dangerous` | `lethal`
- `marks` — array (fictional solvents only, otherwise empty): `[{ solvent: 'ichor' | 'prism' | 'lacuna', mark_level: int 1–5 }]`
- `narrative_wrap` — string, nullable (populated by SignatureTransformRule for fictional solvents, null for grounded)

---

## Effect Schema

Individual effects produced by the pipeline, attached to `combination.effects`.

- `id`
- `ingredient_id` — the source ingredient (for marker matching in Lacuna)
- `type` — the effect kind (e.g., `sedation`, `memory_recall`, `warming_sensation`)
- `descriptor` — human-readable descriptor (elevated by Ichor, refracted by Prism, transmuted by Lacuna)
- `subtractive` — boolean, set true by Lacuna transmutation
- `refracted` — boolean, set true by Prism duplication
- `duration` — enum: `normal` | `extended` | `permanent` (extended and permanent set by Lacuna based on `permanence_scale`)
- `reversible` — boolean, set false by Lacuna when permanent

---

## Rules Pipeline

The combination algorithm is a pipeline of pluggable rule modules. Each takes a `BrewingContext` and returns a modified context. All seven rules below are **v1**.

```
rawContext
  → SolventMatchRule
  → AntagonismRule
  → SynergyRule
  → DoseCurveRule
  → StabilityRule
  → ToxicityRule
  → SignatureTransformRule
```

### Rule summaries

| Rule | Purpose | Key outputs | Can fail? |
| --- | --- | --- | --- |
| **SolventMatchRule** | Pre-flight validation and weight assignment. Wraps ingredients, applies solubility × polarity matrix, applies category affinity/resistance modifiers. | `chemical_extraction_weight`, `presence_weight`, `extraction_yield_modifier`, `warnings` per ingredient. Sets `solvent_validated`. | Yes: `no_ingredients`, `outcome_incompatible`, `extraction_impossible` |
| **AntagonismRule** | Detects cancellation across four patterns: opposite-tag pairs (with scaled-pair intensity classification), tag-targets-compound, trait-driven, and resistance amplification. | Reduces `chemical_extraction_weight` via multiplicative compounding. Populates `deferred_complementary_pairs` for SynergyRule. | Yes: `total_antagonism` |
| **SynergyRule** | Detects amplification across five patterns: related-family, shared compound-class (diminishing), tag-targets-compound, complementary pairs (curated + deferred from AntagonismRule), trait-driven. Applies solvent-signature caps. | Sets `potency_multiplier` per ingredient (capped at 2.5× or 5× per solvent). Sets `synergy_scope_multiplier` (Prism), `sensory_erasure_count` (Lacuna), `permanence_scale` (Lacuna), `lacuna_transmute_markers` (Lacuna). | No |
| **DoseCurveRule** | Computes cumulative compound-class load, applies dose-response per ingredient (linear/hormetic/threshold/ceiling), handles fictional solvent modifiers (Ichor permissive, Prism seeded refraction of response type, Lacuna bidirectional). | Sets `effective_potency` and `dose_state` per ingredient. Populates `cumulative_loads` map. | Yes: `extraction_impossible` (hormetic cascade) |
| **StabilityRule** | Eight-stage stability formula: base × category modifier × outcome modifier × solvent modifier × tag multipliers × trait modifiers × fictional signatures × minimum check. | Sets `stability` (float days), `stability_state` (enum). | Yes: `insufficient_stability` |
| **ToxicityRule** | Three parallel passes computing somatic, psychic, sensory toxicity. Each gated against outcome-specific thresholds. | Sets `toxicity` and `toxicity_state` objects. | Yes: `lethal_somatic`, `lethal_psychic`, `lethal_sensory` |
| **SignatureTransformRule** | Fictional solvents only. Applies Ichor/Prism/Lacuna signature transformations to effects, sensory output, marks, and narrative wrap. | Modifies `effects`, `sensory_output`. Sets `marks` and `narrative_wrap`. | No |

### Determinism

All probabilistic mechanics (mercurial trait severity, Prism response-type refraction, Prism effect duplication, seeded stability multipliers) use a single seeded PRNG derived from:

```
combination_seed = hash(
  sorted(ingredient_ids).join('|') +
  '|' + solvent_id +
  '|' + outcome_type
)
```

Same inputs always produce the same outputs. Varied across different combinations. Testable against known seeds.

### v2 hook rules (not implemented)

- `HeatRule` — enables `combustive`, `exothermic-reactant`, `endothermic-reactant` tags
- `pHRule` — models pH-driven color shifts and stability effects (partly folded into sensory algorithm; may formalize as separate rule)
- `FlavorBalanceRule` — masking effects between antagonistic taste dimensions

---

## CombinationIngredient Wrapper

Ingredients in the pipeline are wrapped with their computed weight data. The original ingredient record stays immutable; pipeline-derived state lives on the wrapper.

```
CombinationIngredient {
  ingredient: IngredientRecord,      // DB record, immutable
  weight_data: {
    chemical_extraction_weight: float,    // 0.0–1.0, dissolved chemistry (SolventMatchRule + AntagonismRule)
    presence_weight: float,               // 0.0–1.0, physical/sensory presence (SolventMatchRule; reduced by decaying trait)
    extraction_yield_modifier: float,     // -0.75 to +0.45, from affinity/resistance (SolventMatchRule)
    potency_multiplier: float,            // 1.0–cap, synergy amplification (SynergyRule)
    effective_potency: float,             // may be negative (DoseCurveRule)
    dose_state: enum,                     // per DoseCurveRule outputs
    warnings: string[]                    // per-ingredient warnings
  },
  refracted_response: enum                // Prism only, from DoseCurveRule Phase 1
}
```

Downstream rules access:

- Ingredient properties: `combinationIngredient.ingredient.solubility`
- Weight data: `combinationIngredient.weight_data.chemical_extraction_weight`

**Weight semantics:**

- `chemical_extraction_weight` — how much chemistry actually enters the medium. Read by SynergyRule, AntagonismRule, DoseCurveRule, ToxicityRule.
- `presence_weight` — how much the ingredient's physical/sensory character is present. Read by StabilityRule, the sensory algorithm, and outcome-specific structural rules. Set independently of extraction — insoluble ingredients have `chemical_extraction_weight = 0` but `presence_weight = 1.0`.
- `potency_multiplier` — synergy stacking, capped per solvent.
- `effective_potency` — final potency after dose-curve resolution. Primary input for StabilityRule, ToxicityRule, and downstream description generation.

---

## Pipeline Data Tables

Tables the rules consult beyond the ingredient/solvent core.

### `tag_definitions`

```
tag_definitions {
  slug: string,
  category: string,       // 'extraction' | 'interaction' | 'perception' | 'metaphysical' | ...
  targets: array<compound_class_slug>,   // nullable, for tag-targets-compound rules
  boost: float,           // nullable, for synergy boost when tag triggers
  severity: float,        // nullable, for antagonism severity when tag triggers
  opposite_tag: string    // nullable, for opposite-pair lookups
}
```

### `synergy_pairs`

```
synergy_pairs {
  tag_a: string,
  tag_b: string,
  type: enum('always_antagonistic' | 'always_complementary' | 'scaled'),
  boost: float,                          // nullable, used when complementary
  severity: float,                       // nullable, used when antagonistic or scaled straining
  complementary_ceiling: float,          // nullable, scaled only, default 0.7
  balanced_ceiling: float,               // nullable, scaled only, default 1.4
  straining_ceiling: float,              // nullable, scaled only, default 2.0
  warning_template: string
}
```

### `effect_subtractive_equivalents` (Lacuna transmutation)

```
effect_subtractive_equivalents {
  standard_effect: string,
  subtractive_equivalent: string
}
```

Seed rows:

| Standard effect | Lacuna subtractive equivalent |
| --- | --- |
| `memory_recall` | `memory_erasure` |
| `sedation` | `emotional_absence` |
| `perceptual_enhancement` | `sensory_removal` |
| `time_dilation` | `time_erasure` |
| `concealment` | `unfindability` |
| `stimulation` | `motivational_erasure` |
| `warming_sensation` | `warmth_absence` |
| `cooling_sensation` | `coolness_absence` |
| `dream_enhancement` | `dream_erasure` |
| `emotional_amplification` | `emotional_muting` |

---

## Brewing Context (transient pipeline state)

The context object passed between rules. Populated progressively.

Inputs (from request):

- `ingredients` — starts as raw ingredient records, replaced by CombinationIngredient wrappers after SolventMatchRule
- `solvent` — solvent record
- `outcome` — outcome enum value

Populated by rules:

- `solvent_validated` — bool (SolventMatchRule)
- `warnings` — string[] (accumulated across rules)
- `deferred_complementary_pairs` — array of `{A, B, boost}` (AntagonismRule → SynergyRule)
- `synergy_scope_multiplier` — int (SynergyRule, Prism only)
- `sensory_erasure_count` — int (SynergyRule, Lacuna only)
- `permanence_scale` — float (SynergyRule, Lacuna only)
- `lacuna_transmute_markers` — array of `{ingredient_id, original_effect, transmuted_effect, effect_domain}` (SynergyRule, Lacuna only). `effect_domain` values: `memory` | `emotion` | `identity` | `sight` | `sound` | `perception` | `sensation` | `time` | `other`
- `cumulative_loads` — Map<compound_class, float> (DoseCurveRule)
- `stability`, `stability_state` (StabilityRule)
- `toxicity`, `toxicity_state` (ToxicityRule)
- `effects` (produced across rules; transformed by SignatureTransformRule)
- `sensory_output` (produced by sensory algorithm; transformed by SignatureTransformRule)
- `marks`, `narrative_wrap` (SignatureTransformRule, fictional only)

On failure:

- `failed = true`
- `failure_reason` — enum (see Combination Schema)

---

## Sensory Algorithm

The sensory algorithm reads from reactive fields (one-directional). Produces the combination's `sensory_output`. Full mechanic to be designed in its own session — this section captures the current shape.

### Color

Weighted subtractive blend for liquids, weighted by `aesthetic_weight`. Reactive shifts applied:

- `tannin`-heavy → amber/brown shift
- `oxide` + `tannin` → black shift _(iron-gall ink logic)_
- `flavonoid` + low pH → red shift; + high pH → blue-green shift _(anthocyanin behavior)_

### Aroma

Perfumery-style top/heart/base combination. Each ingredient's notes merge by position.

### Taste

Weighted average per dimension. Antagonistic dimensions (high bitter masks sweet) applied at the end (v2 or FlavorBalanceRule).

### Texture

Dominant texture wins by `aesthetic_weight`. Clashing textures produce "separates / doesn't blend" output.

### Motion

Computed from density gradient, reaction activity, base ingredient tendencies, and Aberrant/Pneuma content (which unlocks `seeking`).

### Fictional solvent overlays

Applied after the base sensory computation:

- **Ichor** — color shifts toward gold, secondary defaults to `#FFD700` if empty, luminosity boosts from dull/glossy to phosphorescent
- **Prism** — iridescent quality applied, secondary generated per seeded PRNG, luminosity forced to phosphorescent, aroma notes expanded per `synergy_scope_multiplier`
- **Lacuna** — progressive erasure per `sensory_erasure_count`: 1→luminosity dulled, 2→color desaturated, 3→aroma flattened, 4→texture generic, 5→motion still, 6+→taste muted

---

## v2 Roadmap

Features deliberately deferred from v1:

- **Emergent named variants** — specialized outcome names revealed by specific solvent choices
- **Cream outcome** — dual-solvent emulsion mechanic with `emulsifier`/`separator` interaction
- **Heat mechanic** — enables `combustive`, `exothermic-reactant`, `endothermic-reactant` tags
- **Combustion outcomes** — Incense, Fume, etc.
- **Reflection mechanic (Mirror-agent)** — requires actor/source modeling
- **Dosage** — quantity multipliers on `combination_ingredients` join
- **Solvent variants** — Water: rain/well/dew; Spirits: grain/grape/herbal; Oil: olive/coconut/rendered
- **Ichor sub-sources** — ichor properties determined by source (dragon, spider, etc.)
- **Art assets** — SVG/PNG rendering of finished preparations in vessels
- **Trait expansion** — sympathetic, latent (and sub-family), sentient, unwilling, sealed
- **Mineral acid ingredient**: the pH contribution scale runs -3 to +3, but nothing occupies -3. No oil of vitriol, no aqua fortis. A caustic acid ingredient would fill the acid end the way Wood Ash fills the alkaline end. See `sensory.md`.
- **User accounts, saving, journal, glossary** — frontend features
- **Cumulative recipient marks** — modeling recipients as first-class entities so marks accumulate across preparations

---

## Design Principles Reference

For interview and portfolio conversations, the defensible-choice highlights:

1. **Rules as pluggable modules** — extensibility without refactoring; new mechanic = new rule
2. **Forward-compatible schema** — v2 hook fields present in v1 schema, unread by v1 rules
3. **Fictional ingredients use same algorithm as real ones** — no special-casing; weirdness lives in data values, not code branches
4. **Interaction tags as extensible enum** — vocabulary in `tag_definitions` table; new tags = insert row
5. **Sensory reads from reactive (one-directional)** — emergent aesthetics from real chemistry
6. **Solvent-agnostic v1 outcomes** — specialized variants as v2 discovery feature
7. **Fictional solvents bypass compatibility gates + apply signature transformations** — distinct mechanical class, defensible as design pattern
8. **Compulsion constrained to work only along existing seams** — amplifies what's there rather than manufacturing action from nothing
9. **Failure states are informative, not silent** — `failure_reason` enum split into three toxicity dimensions, plus stability and extraction failures
10. **Two-weight ingredient model** — `chemical_extraction_weight` and `presence_weight` separated so rules can reason about "what extracted" vs "what's present" independently
11. **Deterministic seeded randomness** — reproducible per-combination outputs; testable against known seeds; each combination varied
12. **Three-dimensional toxicity** — somatic/psychic/sensory rather than single scalar, gating against outcome-specific delivery pathways
13. **Fictional solvents differ in kind, not just numbers** — Ichor amplifies quantitatively, Prism transforms dimensionally, Lacuna transmutes qualitatively
14. **Antagonism before synergy in pipeline order** — cancellation happens before amplification in real chemistry; synergy operates only on what survived
15. **All ingredient data hand-authored and locally stored** — Trefle evaluated and rejected on data-quality grounds; personal domain vetting produces better interview material than an external API