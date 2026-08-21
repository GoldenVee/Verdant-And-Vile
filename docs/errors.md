# Error Catalogue

Two different things in this API are called failure, and they are not the same. Getting them
confused is the main reason this document exists.

- **Errors** mean the request could not be processed. HTTP 4xx or 5xx, with the error envelope
  below.
- **Failed combinations** mean the request was processed perfectly and the answer is that the
  preparation does not work. HTTP 200, with `failed: true` and a `failure_reason`.

A lethal preparation is not an error. It is a correct result about a bad idea.

---

## Error envelope

Every 4xx and 5xx response has this shape, produced by the custom Fastify error handler in
`src/app.ts`:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Unknown solvent slug: quicksilver.",
    "details": { "solvent": "quicksilver" }
  }
}
```

`details` is omitted when there is nothing structured to add.

## Error codes

Defined in `src/errors.ts`, which is the code-side mirror of this table. A new code there
needs a row here.

| Code | HTTP | Raised when |
|---|---:|---|
| `VALIDATION_ERROR` | 400 | Request body fails schema validation, or names an ingredient or solvent slug that does not exist. |
| `NOT_FOUND` | 404 | `GET /ingredients/:slug` or `GET /solvents/:slug` names something that does not exist. |
| `INTERNAL_ERROR` | 500 | Anything unhandled. The real error is logged with request context; the client is told nothing beyond this. |
| `NOT_IMPLEMENTED` | n/a | **Currently unused.** Defined in `src/errors.ts` and thrown nowhere. It dates from when the combination pipeline was stubbed. Either remove it or give it a purpose. |

Schema validation failures are caught separately from thrown `AppError`s but reported under the
same `VALIDATION_ERROR` code, with Fastify's validation output passed through as `details`.

---

## Failure reasons

A failed combination returns **HTTP 200**. The body carries `failed: true`, a
`failure_reason`, and as much of the resolved result as the pipeline computed before it
short-circuited.

The pipeline stops at the first rule that fails (ADR-004), so exactly one reason is ever
returned.

| `failure_reason` | Rule | Meaning |
|---|---|---|
| `no_ingredients` | SolventMatchRule | The combination has no ingredients. |
| `outcome_incompatible` | SolventMatchRule | The solvent cannot produce the requested outcome. Fictional solvents bypass this gate. |
| `extraction_impossible` | SolventMatchRule | Nothing dissolves in this solvent. Also raised by DoseCurveRule on a hormetic cascade. |
| `total_antagonism` | AntagonismRule | The ingredients cancel each other so completely that nothing is left. |
| `insufficient_stability` | StabilityRule | The preparation falls apart before it can be used. |
| `lethal_somatic` | ToxicityRule | Bodily toxicity is fatal at the delivery pathway the outcome implies. |
| `lethal_psychic` | ToxicityRule | Psychic toxicity is fatal. |
| `lethal_sensory` | ToxicityRule | Sensory toxicity is fatal. |
| `unknown` | any | Fallback. Should not occur; treat as a bug. |

Toxicity is three-dimensional on purpose, so a preparation that is bodily safe can still be
psychically lethal. See [rules/toxicity.md](rules/toxicity.md).

---

## Warnings are neither

`warnings` is an array of strings on a **successful** response. It carries things the
apothecary should know that did not stop the preparation working: shared compound classes,
partial extraction, category resistance, and the marks a fictional solvent will leave.

A response can be successful, carry several warnings, and describe something that would badly
hurt whoever drank it. That is the intended design, not an oversight. Failure is reserved for
preparations that do not resolve at all.
