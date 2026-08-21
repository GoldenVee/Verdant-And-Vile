# Description Model: Design Reference

How a resolved combination becomes prose: the `name` and `lore` fields, currently returned
as `null`. This is Phase 10, the last unbuilt algorithm in v1.

Nothing here is implemented. `design-reference.md` scopes this in two lines (`name` generated
from result, `lore` generated description), so this document starts from a blank page.

**Status: in design. Not started.**

---

## The voice problem comes first

The output must not read as machine-written. This is not a polish concern to handle at the
end; it constrains the architecture, so it goes first.

### The house voice already exists

57 ingredient `lore` fields are authored in it, and it is measurably distinctive.

Across those fields: **169 sentences, 1 to 29 words long, mean 11.6.** Only **1 of 57** uses
any hedge or connective (`somewhat`, `rather`, `however`, `moreover`, and their kin).

The rhythm is the tell. Charcoal runs 16 words, then 19, then 3:

> Wood burned in the absence of air until only the skeleton of what it was remains. Draws
> poison out of stomach, ink out of parchment, water out of any preparation left with it long
> enough. The universal absence-that-absorbs.

Foxglove runs 14, 8, 7, and stops on the dark turn without softening it:

> The leaves of a foxglove, said to be used by foxes and faerie alike. A single leaf can steady
> a failing heart. Three leaves can stop a healthy one.

Recurring moves worth naming, since fragments should reproduce them:

- **Concrete nouns over abstractions.** Cellars, cats, hearths, whale bellies. Never
  "properties" or "qualities".
- **The apothecary declines to explain.** Mandrake ends "a matter the apothecary declines to
  answer"; Sin-Eater's Exhale ends "The apothecary does not ask what burden it once was."
- **Parallel structure used once, then dropped.** Foxglove's single-leaf/three-leaves turn is
  a device, not a habit.
- **No closing summary.** No entry restates what it just said.

### Two separate risks

**The fragments themselves read as generated.** They will be drafted by whoever writes them,
and if that is an assistant, the default register is exactly wrong: even sentence lengths,
hedges, tricolons, adjective stacks, and a summarising final clause. This is the larger risk
and it is not solved by architecture.

**The assembly reads as generated even when every fragment is good.** Uniform sentence length,
the same slot order every time, and every section always present will feel mechanical no
matter how well each phrase is written. Completeness in particular is a strong machine tell:
the surest signal is a description that mentions everything it could.

### Voice constraints, as tests

These should be enforced over the fragment banks the way invariants are enforced over the
rules, not left as intentions in a document.

- **No hedges or connectives.** `somewhat`, `rather`, `quite`, `truly`, `remarkably`,
  `notably`, `making it`, `serves to`, `however`, `moreover`, `additionally`, `furthermore`.
  The existing corpus already passes this at 56 of 57.
- **No em dashes**, per the project-wide rule.
- **Sentence length must vary.** Adjacent sentences in an assembled description should not
  cluster. Fragments carry a length class and templates require a mix.
- **No template may end on a summary.** Concluding-takeaway shapes are banned outright.
- **No connectives between sections.** Sentences sit next to each other unjoined.
- **Sections may be omitted.** Not every preparation earns all five. Omission is the strongest
  available defence against sounding generated, and it should be the default for anything
  unremarkable.

The existing 57 lore fields are the reference corpus. A new fragment that would look out of
place beside them is wrong, whatever else is true of it.

---

## Architecture

A hybrid: **templates decide sentence shape, fragments decide the words.** Neither alone is
enough. Templates alone give varied words in an unvarying skeleton. Fragments alone still need
something to compose them, which turns out to be a template wearing a disguise.

### Four layers

**1. Observation (code, no prose).** Raw values become typed observations with a salience
score.

```
#937346            -> { channel: colour, key: muddy-gold, salience: 0.5 }
motion: restless   -> { channel: motion, key: restless,   salience: 0.8 }
taste.bitter 0.29  -> { channel: taste,  key: bitter, degree: moderate, salience: 0.6 }
taste.sour 0       -> no observation
```

Salience is how "describe the salient, omit the default" becomes mechanism rather than
intention. Each section takes its top few observations and discards the rest.

**2. Fragment banks (data).** A condition key maps to several authored phrasings.

```
colour.muddy-gold -> "a muddy gold" | "the brown-gold of stewed tea" | "dull amber"
motion.restless   -> "restless in the glass" | "never quite settling" | "which will not sit still"
```

**3. Templates (data).** Sentence skeletons per section, with typed slots.

```
appearance -> "A {colour} {vessel}, {motion}."
           -> "{colour:cap} and {luminosity}, {motion}."
```

**4. Assembly (code).** Seeded selection of a template, then of a fragment per slot.

Variety is multiplicative. Four appearance templates against three colour phrasings and three
motion phrasings give 36 distinct openings for one condition set, every word hand-authored and
fully deterministic per seed.

Banks and templates live in DB tables, like every other vocabulary in this project. A new
phrasing is an insert, not a deploy.

---

## Structure: pharmacopoeia entry order

Five sections, each with its own templates and its own salience budget.

| Section | Draws on |
|---|---|
| Appearance | colour, blend state, luminosity, motion |
| Aroma | the three note positions |
| Taste | dominant taste dimensions, temperature |
| Virtue | effects, their magnitude and duration |
| Caution | toxicity, stability, warnings, marks |

Any section may be omitted when nothing in it clears the salience floor.

---

## Pipeline placement

`DescriptionRule` becomes rule ten, after SignatureTransformRule, so the fictional overlays
have already modified effects and sensory output before anything is described.

It takes a fresh `prngFor('description')` stream. Unlike Prism there is no draw-ordering
hazard, because nothing else consumes that stream.

Fictional solvents already set `narrative_wrap`, which is authored prose sitting alongside
generated prose. How the two relate needs deciding: the wrap could precede the description,
replace a section, or stay entirely separate.

---

## Open questions

- **Where to start.** Failure prose is bounded at 9 reasons, needs no observation layer, and
  proves the mechanism end to end. Appearance proves the observation and salience layer, which
  is the riskier half. Sequence not yet chosen.
- **`name` design.** Short, and it wants an observation from nearly every channel to pick well.
  Probably last.
- **Ingredient lore reuse.** Each ingredient carries authored `lore` and `appearance_text`.
  Whether a preparation's description may quote or draw on them, or whether that reads as
  padding, is undecided. They describe the ingredient, not the preparation.
- **Salience thresholds.** Per-channel floors and per-section budgets need tuning against real
  combinations, the way the motion weights were.
- **Failure prose and honesty.** A failed combination still returns `failure_reason`. The prose
  must not contradict it or obscure what went wrong.
