# Sensory Model: Design Reference

How a combination produces its `sensory_output`: the colour, aroma, taste, texture, motion,
and scalar qualities of the finished preparation. This is the source of
`combination.sensory_output` in the API response, currently returned as `null` pending this
work.

This document is canonical for the sensory model. Where it conflicts with the Sensory
Algorithm placeholder in `design-reference.md`, this document wins, and that placeholder
should be backported.

**Status: in progress.** Combination pH and colour are settled, implemented, and tested; the
pH seed data is authored. Aroma, taste, texture, and the scalars are not yet designed. Motion is deferred to
its own session. Sections below are marked accordingly.

---

## Where sensory sits in the pipeline

A new **SensoryRule** is inserted immediately before SignatureTransformRule, growing the
pipeline from eight rules to nine:

```
SolventMatch -> Antagonism -> Synergy -> DoseCurve -> Effects
  -> Stability -> Toxicity -> Sensory -> SignatureTransform
```

The reasoning mirrors EffectsRule. SensoryRule computes the base sensory output from final
weights and data; SignatureTransformRule then fills its three deferred overlay sites with
the fictional transformations. Base sensory is materialized once, at the first point where
every input it reads is final.

SensoryRule sets `context.sensory_output`. It reads weights, ingredient sensory fields,
compound classes, the solvent, and the fictional scalars. It writes nothing else.

### Contribution weighting

Two weightings are used, and which one applies is not arbitrary:

**You see what is present, you taste what dissolved.**

- **Presence weighting** (`presence_weight * aesthetic_weight`) governs colour, luminosity,
  aroma, temperature, texture, motion, and sound. These are properties of the preparation as you
  encounter it, so an insoluble ingredient still colours the mix and still sits in the vessel.
- **Extraction weighting** (`chemical_extraction_weight * aesthetic_weight`) governs taste,
  and extraction weight alone governs pH. These are properties of the solution.

In both cases `aesthetic_weight` answers "how much does it dominate the character".

The distinction earns its keep. Amethyst, Bloodstone, and Tiger's Eye are insoluble quartzes
with an all-zero taste profile, the same three that carry `null` pH. Under presence weighting
a stone dropped into a tincture would dilute its taste by a third, which is wrong: the stone
contributes nothing but also displaces nothing. Extraction weighting zeroes them out with no
special case.

For the averaging sub-algorithms (colour, taste) weights are normalized to sum to 1, so a
four-ingredient blend and a two-ingredient blend are not systematically different in
intensity. Ingredient count must not leak into the output as an artifact.

**Combination pH is the exception to normalization.** It sums. See below.

### Determinism

Base sensory is fully deterministic from the data. No new PRNG streams are introduced. The
only randomness in the whole sensory path is Prism's spectrum seeding, which draws from the
existing `signature-transform` stream inside SignatureTransformRule.

That stream is already consumed by Prism's effect duplication loop. Any new draw must be
placed **after** the existing consumption sites, because inserting a draw earlier shifts
every downstream value and changes which effects are refracted. This ordering is a real
constraint, not a stylistic preference, and it is why the sensory overlay code sits below
the effect code in `applyPrism`.

---

## Combination pH

**Status: settled. Seed data authored.**

There is no pHRule; pH is a v2 hook. The colour model's anthocyanin shift needs a
combination pH, so it is defined here.

### Formula

```
pH = clamp(solvent.base_ph + sum over ingredients of (ph_contribution * chemical_extraction_weight), 0, 14)
```

Null when `solvent.base_ph` is null, or when the solvent is `anti-solvent` and no aqueous
phase exists. A null pH skips the anthocyanin shift entirely rather than defaulting to
neutral.

Two decisions are load-bearing here.

**pH follows chemical extraction weight, not presence weight.** pH is a property of the
solution, so it tracks what actually dissolved. This falls out of the two-weight model and
means insoluble ingredients like Bone Char, Charcoal, and the quartzes contribute nothing
without needing to be special-cased.

**Contributions sum rather than average.** Two carbonates in vinegar are more alkalizing
than one. Normalizing would make a preparation of Red Coral and Pearl Powder together no
more alkaline than either alone, which is wrong. The clamp to the 0 to 14 range handles the
extreme tail.

This produces a mechanic for free. Every alkaline ingredient in the roster is a carbonate,
and every carbonate is `acid-soluble`. So carbonates only dissolve, and therefore only
raise pH, in an acidic solvent. Red Coral in Vinegar dissolves and neutralizes it; Red
Coral in Water sits inert at the bottom of the jar. Red Coral's authored lore already reads
"Powdered and dissolved in vinegar". The data was written for this before the mechanic
existed.

The same reaction is carbonate plus acid yielding carbon dioxide, which is the natural
mechanism for the `effervescent` texture and motion values. That belongs to the motion
session.

### Solvent base pH

| Solvent | `base_ph` | Note |
|---|---:|---|
| Water | 7.0 | |
| Spirits | 6.5 | |
| Vinegar | 2.5 | |
| Honey | 4.0 | |
| Oil | `null` | Nonpolar. pH is undefined without an aqueous phase, so the shift is skipped. |
| Ichor | 7.4 | Blood plasma. Near-neutral by design: Ichor amplifies quantitatively, so it does not impose its own colour chemistry. That is Prism's role. |
| Prism | 9.5 | Alkaline. Drives the blue-green anthocyanin branch, which no grounded solvent can currently reach. Thematically exact for refractive-alteration. |
| Lacuna | 7.0 | Not neutral in the sense of balanced. Neutral in the sense of erased: everything that would have pushed it either way has been taken out. Contrast with Oil, where the question does not apply; here the answer is nothing. |

### Ingredient contribution scale

Values are approximate pH units of shift at full extraction.

| Value | Meaning |
|---:|---|
| -3 | caustically acidic, pH 1 to 2 |
| -2 | distinctly acidic, pH 3 to 4 |
| -1 | mildly acidic, pH 5 to 6 |
| 0 | neutral, or dissolves without shifting pH |
| +1 | mildly alkaline, pH 8 to 9 |
| +2 | distinctly alkaline, pH 9 to 10 |
| +3 | caustically alkaline, pH 11 to 12 |

`null` is reserved for substances with no aqueous chemistry at all.

### Authored values

Thirty-two ingredients sit at 0 and are not listed. Three are `null`: Amethyst, Bloodstone,
and Tiger's Eye, all insoluble silica.

| Ingredient | Value | Chemistry |
|---|---:|---|
| Wood Ash | +3 | Potassium carbonate. Its lore says it becomes lye. The strongest base in the roster. |
| Pearl Powder | +2 | Nacre is calcium carbonate; a carbonate suspension sits near pH 9. |
| Red Coral | +2 | Calcium carbonate. |
| Bone Char | +1 | Calcium phosphate is basic. Insoluble, so extraction weighting mutes it in practice. |
| Charcoal | +1 | Wood-derived activated carbon runs pH 8 to 9. Insoluble, same caveat. |
| Verdigris | +1 | Copper(II) carbonate is basic. Dissolves in acid and neutralizes it. |
| Cattle Gallstone | +1 | Bile-derived and calcium-rich. Bile is alkaline. |
| Aphrodite's Seafoam | +1 | Seawater is pH 8.1. |
| Rust | -1 | Iron(III) dissolves in acid to salts that hydrolyse acidic. An oxide that acidifies. |
| Belladonna | -1 | Plant-matter acidity. |
| Mandrake | -1 | Plant-matter acidity. |
| Poppy | -1 | Plant acids alongside the morphine alkaloids. |
| Ergot | -1 | Fungal acidification. |
| Penicillium | -1 | Mould cultures acidify their medium. |
| Oakmoss | -1 | Lichen, carries evernic and usnic acid. |
| Arsenic | -1 | Arsenous acid, weakly acidic. |
| Petrichor | -1 | Rain is mildly acidic from dissolved carbonic acid, pH 5.6. |
| Plague Breath | -1 | Authorial, for character. |
| Wine Lees | -2 | Potassium bitartrate, cream of tartar, around pH 3.5. |
| Willow Bark | -2 | Salicylic acid, pKa 2.97. |
| Alum | -2 | Potassium aluminium sulfate, around pH 3. |
| Charnel Damp | -2 | Putrefaction produces butyric and acetic acid. |

Saltpeter and Sea Salt are deliberately 0. Potassium nitrate and sodium chloride are
neutral salts, and their zero is an authored judgement rather than an unfilled default.

Nonpolar ingredients (the waxes and musks, Rosemary, Wormwood, Sulfur, Miasma) are held at
0 rather than `null`. Pure chemistry argues they have no aqueous pH, but they do partially
extract into polar solvents at weight 0.3, so they are not wholly absent from solution.

### Known gaps

**Nothing sits at -3.** The roster carries no mineral acid: no oil of vitriol, no aqua
fortis. The scale has headroom on the acid side awaiting one. Tracked as a v2 item.

**No grounded alkaline solvent.** Water, Spirits, Vinegar, and Honey are correctly authored
as neutral-to-acidic, and none can be made alkaline without inventing chemistry. The
historical apothecary had lye, and Wood Ash's lore already foreshadows it. **Lixivium**,
wood-ash leach at pH 11.5 with `polar` polarity, would slot into the existing adjacency
matrix with no code change. Planned as a follow-up, not part of Phase 9. Until it exists,
Prism at 9.5 is the only route to the blue-green branch.

---

## Colour

**Status: settled and implemented.** See `src/sensory/` and `src/pipeline/rules/sensory.ts`.

### Blend model: Kubelka-Munk reflectance

Per channel, reflectance is converted to the Kubelka-Munk ratio, the ratios are summed by
contribution weight, and the result is inverted back to reflectance:

```
K/S = (1 - R)^2 / (2R)          R clamped away from 0 to avoid a divide blowup
R    = 1 + K/S - sqrt((K/S)^2 + 2(K/S))
```

This is the reflectance model the paint and textile industries use for pigment mixing. It
is chosen over a naive CMY weighted average because averaging treats a pale pigment and a
dense one as equals, which is not how pigment behaves. Chamomile and Belladonna at equal
weight average to `#8D7542`, a washed tan resembling neither. Kubelka-Munk gives `#2C142F`,
a dark violet, because Belladonna's near-black correctly swamps the pale yellow. That is
what happens in the jar.

The practical consequence is that naive blends converge on similar muddy browns regardless
of input, while Kubelka-Munk preserves ingredient character across three and four
ingredient combinations.

### The solvent participates in the blend

The solvent's `aesthetic_base.color` enters the blend as an additional participant whose
weight falls as total ingredient presence rises. A sparse preparation reads as tinted
solvent; a dense one reads as its ingredients. That is how an infusion behaves, and it lets
Honey's amber and Lacuna's near-black do visible work without overwhelming anything.

### Phase separation and `blend_state`

Not every combination homogenizes, and the repo already contains three separate expressions
of that single fact: `color_secondary`, which would otherwise be null outside the fictional
solvents; the "separates / does not blend" texture state; and `layered` in the motion enum,
which no ingredient data can reach.

The driver is already computed. SolventMatchRule sets `chemical_extraction_weight` per
ingredient from the adjacency matrix, and the **spread** between the highest and lowest
weight in a combination is precisely "do these things mix".

| Example in Water | Spread | Reading |
|---|---:|---|
| Nettle + Chamomile, both polar | 0.00 | homogeneous, one colour |
| Nettle + Beeswax, polar and nonpolar | 0.70 | gradient, pale wax over green |
| Nettle + Charcoal, polar and insoluble | 1.00 | separated, black powder under green liquor |

Above a spread threshold the ingredients partition into two phases, each blended separately
by Kubelka-Munk, giving a genuine `color_base` and `color_secondary` rather than a decorative
one. `blend_state` carries the categorical result (`homogeneous`, `suspension`, `gradient`,
`separated`) so that colour, texture, and motion all key off the same fact and agree with
each other.

Phase direction comes from existing data: the phase weighted toward `settling` ingredients
sits below, `rising` above.

#### Thresholds

The adjacency matrix only ever emits 0, 0.3, 0.5, 0.7, and 1.0, so spread takes exactly
seven values: 0, 0.2, 0.3, 0.4, 0.5, 0.7, and 1.0. The cut points are set against that
discrete set rather than tuned as though the input were continuous.

Spread alone also misses an edge. Two insoluble ingredients in Spirits both extract at 0.5,
giving spread 0 and therefore "homogeneous", when the truth is a uniform suspension. So
`blend_state` reads two axes: spread for mismatch, mean extraction for how much dissolved
at all.

```
spread >= 0.7            -> separated
spread >= 0.4            -> gradient
mean extraction <= 0.5   -> suspension
otherwise                -> homogeneous
```

Checked in that order.

**Separation is a grounded-solvent phenomenon.** Fictional solvents and sachets bypass the
adjacency matrix and set every weight to 1.0, so spread is always 0 under Ichor, Prism, and
Lacuna. Their preparations are always perfectly, unnaturally homogeneous. This is kept
rather than worked around: it makes the fictional three feel seamless in a way nothing real
is.

### Fictional signature looks

Each fictional solvent has an unmistakable, always-recognizable colour signature. Each is
**derived from the blend rather than overriding it**, so the output still reflects what was
brewed, and each maps onto that solvent's `signature_transformation` type.

- **Ichor (`additive-elevation`).** Ichor enters the blend at overwhelming weight rather
  than being excluded from it. Gold floods every channel. The result is always plainly a
  gold gradient, but Belladonna's ichor is a darker, dirtier gold than Chamomile's. Ichor
  does not replace what went in, it drowns it, which is what "you become more" should look
  like. `color_secondary` defaults to `#FFD700` if empty; luminosity lifts from dull or
  glossy to phosphorescent.
- **Prism (`refractive-alteration`).** A prism takes one input and splits it into a
  spectrum. The blended ingredient colour has its hue rotated around the wheel to generate
  the iridescence, seeded from the existing PRNG stream. Always a full spectrum, but where
  the spectrum starts is the ingredient colour. White light in, rainbow out; ingredient
  colour in, rainbow out. Luminosity is forced to phosphorescent.
- **Lacuna (`subtractive-erasure`).** Progressive channel removal in subtractive space as
  `sensory_erasure_count` climbs. Stripping the yellow channel leaves cyan and magenta over
  a darkening ground, so the signature look is black with cyan and magenta fringing. The
  visual and the mechanic are the same operation: this is literal subtractive erasure in
  the colour space the blend already uses, not a themed override.

### Reactive shifts

Three shifts run on the blended colour. All three are driven by **chromatic load**, defined
below, and all three are proportional rather than binary: there is no threshold at which a
shift switches on, only a magnitude that approaches zero.

#### Chromatic load

```
chromatic_load(class) = sum over ingredients of (concentration * chemical_extraction_weight)
```

Extraction weight rather than presence weight, because these are reactions in solution.
Summed rather than averaged, for the same reason pH sums: more tannin material means more
tannin in the medium.

**This is deliberately not `context.cumulative_loads`.** DoseCurveRule already computes a
per-class load, but it is potency-scaled (`chemical_extraction_weight * potency_multiplier *
potency_base`), which is a pharmacological dose. Arsenic's cumulative load is enormous for
toxicological reasons that have nothing to do with colour. Reusing it would be the obvious
move and it would be wrong, so the call site should say so.

#### Iron-gall darkening (`tannin` plus metal oxide)

`design-reference.md` specifies this as `oxide` plus `tannin`, but the `oxide` class is too
broad for the chemistry. It holds three metal oxides and five things that are not: Saltpeter
is potassium nitrate, Alum is aluminium sulfate, Arsenic is arsenic trioxide, all white
powders. Implemented literally, Arsenic plus Willow Bark turns a tincture black. Arsenic
carries `oxide` at 0.75 and has the roster's highest `aesthetic_weight` at 0.9, so it would
dominate the result.

Splitting the class was rejected. `reducer` targets `oxide` in `tag_definitions`, so renaming
breaks it; adding a second class to the iron bearers makes them share two classes instead of
one, changing SynergyRule's shared-compound-class magnitude and adding a DoseCurveRule load
bucket. Both ripple into rules unrelated to colour.

Instead, the existing data resolves it. A tannate complex takes its colour from the metal:
iron tannate is black because iron oxides are dark, aluminium tannate is a pale lake pigment
because alum is white. So the darkening scales by how dark the oxide bearer already is.

```
oxide_darkening = sum over oxide bearers of
                  (concentration * chemical_extraction_weight * (1 - luminance(color_base)))
```

Every bearer lands where real chemistry puts it, with no new classes and no ingredient named
in code:

| Oxide bearer | Colour | Luminance | Factor | Result |
|---|---|---:|---:|---|
| Iron Cubes | `#3B3B3B` | 0.23 | 0.77 | iron gall, near black |
| Bloodstone | `#2C4A2C` | 0.26 | 0.74 | dark, from hematite inclusions |
| Rust | `#A0492A` | 0.35 | 0.65 | dark red-brown ink |
| Verdigris | `#4FA391` | 0.56 | 0.44 | dark olive-green, which is what copper tannate is |
| Tiger's Eye | `#8B6F3A` | 0.44 | 0.56 | moderate, but insoluble so it barely extracts |
| Saltpeter | `#F0EDE5` | 0.93 | 0.07 | negligible |
| Alum | `#F0F5F0` | 0.96 | 0.04 | negligible |
| Arsenic | `#FAFAF5` | 0.98 | 0.02 | negligible |

Alum falling out correctly is the tell. Alum plus tannin is a real historical reaction and
it makes a pale buff lake pigment, not ink. The formula gets that right without being told.

#### Tannin consumption, and why precedence is not a rule

The iron complexes the tannin, so that tannin cannot also brown. Rather than stating that
iron-gall takes precedence, the model consumes the tannin and lets the amber shift work on
what is left.

```
tannin_consumed  = min(tannin_load, oxide_darkening)
tannin_remaining = tannin_load - tannin_consumed
```

A tannin-heavy preparation with a trace of iron browns with a dark cast. Equal parts goes to
ink. There is no ordering rule to remember, because the chemistry states it.

#### Residual tannin, amber shift

The remaining tannin oxidizes and browns, shifting toward a **fixed** amber target of
`#8B5A2B`, with magnitude proportional to `tannin_remaining`.

Fixed rather than derived, unlike the iron path, and the difference is principled. A tannate
complex takes its colour from the metal, which varies. Tannin browning is oxidation of the
tannin itself into phlobaphenes, and those are the same class of compound regardless of
source plant, which is why tea, apple, and wine all brown to roughly the same colour.
Deriving the target from the tannin bearers would give green, since Wormwood, Rosemary, and
Oakmoss are all green. That would be the wrong answer.

#### Flavonoid and pH, anthocyanin behaviour

```
deviation = clamp((pH - 7) / 7, -1, 1)
shift     = flavonoid_load * abs(deviation)     toward red if negative, blue-green if positive
```

Skipped entirely when pH is null. Reachable extremes: Vinegar at 2.5 gives 0.64 toward red,
Prism at 9.5 gives 0.36 toward blue-green, Wood Ash in Water reaches roughly pH 10 for 0.43.
The acid side swings harder than the alkaline side, which is honest: vinegar is a larger
deviation from neutral than any base currently in the roster.

#### Application order

1. Partition into phases if separated, then Kubelka-Munk blend each phase with the solvent
2. Iron-gall darkening, consuming tannin
3. Residual tannin amber shift
4. Flavonoid pH shift
5. Fictional signature looks, in SignatureTransformRule

Seven ingredients carry `flavonoid`, eight carry `oxide`, five carry `tannin`, so all three
paths are reachable but none is common.

---

## Taste

**Status: settled.**

A weighted average per dimension across all eight taste keys, using extraction weighting,
with the solvent participating at the same inverse-load weight it takes in the colour blend.
Results are clamped to 0.0 to 1.0.

Averaged rather than summed, unlike pH. pH is a bulk chemical property that genuinely
accumulates, whereas a taste profile describes what fraction of the character each
participant carries. Summing would make every four-ingredient preparation more intense than
every two-ingredient one, which is the ingredient-count artifact the weighting rule exists to
prevent.

### Solvents carry taste

Solvents originally had no taste data at all: the `Solvent` record held `aesthetic_base` with
colour, viscosity, and luminosity, and nothing else sensory. A Honey preparation would not
have tasted sweet and a Vinegar one would not have tasted sour. Unlike the
`light-swallowing` gap, no overlay would have backfilled it.

`taste_profile` is now authored per solvent, as a single `jsonb` column mirroring how
ingredients already store it. Sums are calibrated against the authored ingredient range,
which runs 0 to 2.60 with a mean of 1.43.

| Solvent | sweet | bitter | sour | salty | umami | astring. | metallic | bright |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Water | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Spirits | 0.1 | 0.4 | 0.1 | 0 | 0 | 0.5 | 0 | 0.7 |
| Oil | 0.1 | 0.1 | 0 | 0 | 0.3 | 0 | 0 | 0 |
| Vinegar | 0 | 0.1 | 0.9 | 0.1 | 0.1 | 0.3 | 0.1 | 0.6 |
| Honey | 0.9 | 0 | 0.2 | 0 | 0.1 | 0 | 0 | 0.3 |
| Ichor | 0.5 | 0 | 0 | 0.4 | 0.6 | 0 | 0.8 | 0.6 |
| Prism | 0.3 | 0.3 | 0.3 | 0.3 | 0.3 | 0.3 | 0.3 | 0.3 |
| Lacuna | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

**Water is the neutral ground**, all zeros, the baseline every other solvent deviates from.

**Spirits** is ethanol: bitter, drying, sharp. Astringent 0.5 is the burn.

**Oil** coats rather than flavours, so it stays low, with a little umami because fats carry
savour.

**Ichor reads as blood**: metallic and faintly sweet over salt and umami, lifted by bright for
the divinity. It is the only profile that exceeds the ingredient ceiling, at 2.9, which suits
a solvent whose signature is additive elevation.

**Prism is flat 0.3 across all eight.** A preparation that tastes of everything at once,
equally, is the taste equivalent of "you become other". No dimension dominates because every
dimension is present.

**Lacuna is all zeros, absent rather than neutral.** Mechanically identical to Water, but the
reasoning matches the distinction already drawn on pH, where Lacuna is 7.0 because everything
that would push it either way has been taken out. Its erasure overlay mutes taste further at
step 6.

### Aroma

**Status: settled.**

Each position merges independently. For `top`, `heart`, and `base` in turn, every note any
participant assigns to that position is collected and weighted by presence, summed per note,
sorted heaviest first with ties broken on slug, and capped at four.

### A note may occupy several positions at once

22 of the 38 notes in use sit at **different positions on different ingredients**. `mineral`
appears as top, heart, and base depending on which ingredient carries it; `bitter-scent`
likewise.

This is deliberately not treated as a conflict to arbitrate. A note that one ingredient places
at top and another places at heart appears at **both** positions in the result. Combine several
ingredients carrying `earth` at different levels and the preparation reads earthy the whole way
down, which is what a real composition does: persistence across all three positions is the
signature of a blend, not a collision.

The alternative, a weighted vote assigning each note to one winning position, was rejected. It
would discard exactly the information that makes a profile feel layered, and it would mean the
same note behaving differently depending on which ingredients happened to outweigh which.

### Solvents carry aroma, muted

Solvents originally had no aroma data, the same gap taste had. Notes are now authored per
solvent in a `solvent_aroma_notes` join table, mirroring `ingredient_aroma_notes` rather than
using a jsonb column, so the same field is stored the same way for both and the foreign key to
the vocabulary still applies.

Solvent notes enter at the usual inverse-load solvent weight, halved again. They colour a
profile without ever leading it: an ingredient carrying its own note always outranks the
solvent's.

| Solvent | top | heart | base |
|---|---|---|---|
| Water | none | none | none |
| Spirits | `acrid` | `bread` | none |
| Oil | none | `nutty` | `wax` |
| Vinegar | `sour` | `acrid` | none |
| Honey | `honied` | `floral` | `sweet` |
| Ichor | `caramelized` | `amber` | `metallic` |
| Prism | `ozone` | none | none |
| Lacuna | none | none | `void` |

**Water carries nothing**, consistent with its zero taste profile.

**Ichor is ambrosia over blood**: burnt sugar, then amber resin, then metal underneath. It
matches the sweet 0.5 over metallic 0.8 in its taste profile. `caramelized` rather than
`honied` keeps it distinct from Honey's top note while staying in the same `floral-sweet`
family.

**Prism gets a single note on purpose.** It is the solvent that expands aroma, so a sparse
profile leaves room for the expansion rather than competing with it.

**Lacuna carries `void` at base**, a note authored in the vocabulary and used by nothing else.
Smelling of absence rather than smelling of nothing, which is a slightly different claim from
its all-zero taste.

`honied`, `caramelized`, and `void` were all authored in the vocabulary and unused by any
ingredient before this.

### Prism expansion

Prism adds one note per point of `synergy_scope_multiplier`, capped at six so a high-scope
combination cannot bury the original profile. Each added note is a **sibling from the same
family** as a note already present, drawn with the seeded PRNG from the `family` column on the
aroma vocabulary.

A prism splits one thing into adjacent versions of itself, so the aroma turning into its own
relatives is the mechanism rather than a decoration. It also puts the vocabulary to work: 17 of
its 55 notes are authored and used by no ingredient, and those are exactly the ones expansion
reaches for.

This is why SignatureTransformRule is now a factory. It needs `aroma_families` from
PipelineData, so it takes the same shape as the other data-dependent rules. The expansion draws
from the `signature-transform` stream and must stay after the existing consumption sites, for
the same reason the colour overlay does.

### Lacuna erasure

Step 3 clears `top`; step 6 clears `heart` as well, leaving only `base`. Top notes are the
volatile ones that lift off a preparation, so losing them first is physically right and reads
as the thing going quiet.

---

## Deferred to v2

Antagonistic masking, where high bitter suppresses perceived sweet, is not modelled. It
belongs to a FlavorBalanceRule and is listed in the v2 roadmap.

---

## Temperature

**Status: settled.**

Weighted dominance on `temperature_feel` using presence weighting, then a tag adjustment that
can shift the result one step along the ordered scale:

```
cold  <->  neutral  <->  warming  <->  burning
```

Net tag load is the presence-weighted `warming` load minus the `cooling` load, normalized
against total weight. When it clears a threshold in either direction the result moves one
step, and only one.

### Why the tags cannot simply be summed

The `warming` and `cooling` tags contradict `temperature_feel` on three ingredients. Wormwood
is tagged `warming` but reads cold; Red Coral the same; Chamomile is tagged `cooling` but
reads warming.

That is not bad data. The tag is what the ingredient does pharmacologically, the field is how
it feels in the mouth, and those genuinely differ: wormwood tastes cold and bitter while
warming you. So the field stays primary, because this is a sensory output, and the tag load
modulates it rather than overriding it. Wormwood resolves as cold that warms slightly, not as
a contradiction.

The alternative, letting tags drive the result, was rejected: it would invert hand-authored
sensory data, turning Chamomile cold on the strength of a pharmacological tag.

Reading reactive tags here is on-principle. Design principle 5 is that sensory reads from
reactive, one-directionally.

### `heat_default` is not an input

Every solvent carries `heat_default: warm`, so the field has zero discriminating power. It is
a v2 heat-mechanic hook, not a temperature signal.

---

## Sound

**Status: settled.**

Dominance, not merging. Among the ingredients carrying a non-null `sound`, the one with the
greatest presence weight wins; ties resolve by ingredient id so the result is stable
regardless of input order. Below a contribution floor the result is `null`.

Only 12 of 57 ingredients carry a sound, and the values are authored prose rather than
scalars: "a held breath that never quite reaches speech", "faint metallic ring when tapped
against glass". Averaging or concatenating them is meaningless, and every one of them is
already written as faint, so a trace ingredient should not be audible at all. Hence the floor
rather than an unconditional pick.

Solvents carry no `sound` field and do not participate.

---

## Deferred

**Texture, to v2 apart from separation.** `blend_state` already carries whether a preparation
separates or blends, which is the part that matters, so `sensory_output.texture` stays null and
texture clash does not become a second driver of `blend_state`. Two findings are logged for
whenever it is taken up:

- 41 of 57 ingredients are dry solids (crystalline 15, fibrous 12, powdery 11, gritty 3) against
  only 12 liquid-ish. Weighted-dominant ingredient texture would make a tincture of powdered
  root report as `powdery`, the same dead end that made motion unworkable. Texture is also the
  only sub-algorithm for which `outcome` matters, since a potion is liquid and a sachet is the
  dry ingredients themselves.
- `oily` is unreachable: no ingredient carries it and Oil's solvent viscosity is authored as
  `viscous`. A one-word change would fix it. Relatedly `aesthetic_base.viscosity` is typed as a
  bare `string` while its values come from the `TextureType` vocabulary.

Lacuna's erasure step 4 stays deferred alongside it.

**Motion.** Ingredient `motion_tendency` only ever takes 4 of its 10 enum values in the seed
data: `still` (27), `settling` (22), `seeking` (6), `rising` (2). Nothing is `swirling`,
`pulsing`, `churning`, `effervescent`, `layered`, or `restless`. Selecting a dominant
ingredient tendency would therefore make six of ten values structurally unreachable. Motion
needs to be primarily derived, with ingredient tendency as a floor rather than the driver,
and that deserves its own design pass. SensoryRule will carry a weighted-dominant
placeholder until then.

Two mechanisms already surfaced that the motion session should inherit: `blend_state`
`separated` is the natural source of `layered`, and carbonate plus acid producing carbon
dioxide is the natural source of `effervescent`.

---

## Open questions

- **Flavonoids versus anthocyanins.** Real anthocyanins are a subset of flavonoids, and
  they are the ones that swing red to purple to blue. Chamomile's apigenin is a flavone and
  shifts far less dramatically. The model treats the whole `flavonoid` class as
  pH-responsive, which is an accepted abstraction rather than exact chemistry. Splitting the
  class would carry the same ripple costs that ruled out splitting `oxide`.
- **Nonpolar ingredients and pH.** Held at 0 rather than `null`. Revisit if the 0.3
  partial-extraction reasoning proves unconvincing in play.
- **Antagonistic taste masking.** High bitter suppressing perceived sweet is not modelled.
  Deferred to a FlavorBalanceRule in v2.

---

## ADR proposal

**ADR-008: SensoryRule and the nine-rule pipeline.** Add SensoryRule immediately before
SignatureTransformRule. Base sensory output is materialized once, deterministically, from
final weights and ingredient data; the fictional overlays transform it in
SignatureTransformRule rather than in a second sensory pass. Rationale: this mirrors the
EffectsRule and SignatureTransformRule split, keeps all randomness in the one rule that
already has a PRNG stream, and gives every sub-algorithm a single well-defined point where
its inputs are final. Consequence: the canonical pipeline is nine rules; `sensory_output`
joins BrewingContext; the combinations route stops returning `null` for it.

**Colour model note.** Kubelka-Munk is hand-rolled in the sensory module. It adds no
dependency and is roughly fifteen lines. It is recorded here because "why not just average
the hex values" is the obvious question, and the answer is that averaging destroys pigment
character.
