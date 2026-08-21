# CLAUDE.md

Context for Claude Code sessions in this repo. Read this first every session.

## Project

Verdant & Vile — a fictional apothecary API. Users combine 2-4 ingredients with a solvent and an outcome type; a 7-rule pipeline resolves the combination into a preparation with effects, sensory properties, stability, toxicity, and (for fictional solvents) signature transformations. Real botanicals, minerals, fungi, and fauna are grounded in actual chemistry and history. Fictional ingredients (Pneuma, Effluvia, Aberrant, Cosmic) are wholly authored with internally consistent fictional chemistry.

This is a portfolio project. Complexity and internal consistency are markers of success. Every architectural choice should have a stateable reason.

## Stack

- **Node.js + TypeScript**
- **Fastify** for HTTP (schema validation at framework boundary)
- **Drizzle** for the DB layer (schema-first, TypeScript-native, handles join tables with data)
- **Neon** for Postgres (serverless, scale-to-zero, branching for E2E tests)
- **Vitest** for testing
- **Pino** for structured logging
- **pnpm** for package management

## Design docs live in the repo

Consult `docs/` before implementing anything mechanically non-trivial.

- `docs/design-reference.md` — master design reference, canonical. When it conflicts with anything else, it wins.
- `docs/rules/*.md` — individual rule docs with full mechanical detail. Consult when the master doc's summary isn't specific enough.
- `docs/errors.md` — error code catalogue.
- `docs/deployment.md`: deployment readiness checklist. Read before any work touching production, environments, or the Neon setup.

Seed data is the authored source of truth. Don't invent ingredient properties; look them up.

- `seed/ingredients/*.json`: one file per category (`botanical.json`, `mineral.json`, etc.), each `{ category, ingredients[] }`. 57 ingredients across 8 categories (cosmic not yet authored).
- `seed/solvents/solvents.json`: the 8 solvents (`{ solvents[] }`).
- `seed/tables/*.json`: pipeline data tables the rules query at runtime, being `tag_definitions.json`, `synergy_pairs.json`, and `effect_subtractive_equivalents.json`.

## Repo layout

```
src/
├── index.ts              # Fastify server bootstrap
├── routes/               # HTTP layer — thin, no business logic
├── db/                   # Drizzle schema, client, seed script
├── domain/               # Types, enums, PRNG utility (pure, no I/O)
├── pipeline/             # Rules pipeline
│   ├── index.ts          # Composition
│   ├── context.ts        # BrewingContext factory
│   └── rules/            # One file per rule
├── data/                 # Runtime lookup queries into DB tables (tag_definitions, synergy_pairs, etc.)
└── sensory/              # Sensory algorithm (Phase 9, not yet designed)
tests/
├── rules/                # Per-rule unit tests
├── invariants/           # Property-based tests via fast-check
└── e2e/                  # Full-pipeline tests against a Neon branch
```

Routes are thin. They handle HTTP concerns (schema validation, calling into the pipeline, returning JSON) and know nothing about the pipeline internals. The pipeline knows nothing about HTTP.

Static-feeling vocabulary (tag definitions, synergy pairs, effect transmutations) lives in **DB tables**, not in code. The rules query them at runtime. This is a deliberate choice so new tags can be added by inserting a row rather than deploying code.

## Architectural conventions

These are locked-in decisions. Don't propose alternatives without asking first.

### Pipeline composition — Result-based short-circuit

Rules return a hand-rolled `Result<Context, Failure>` type:

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
```

The pipeline runs rules in order and short-circuits on the first `Err`. Rules never see a failed context because they're never called with one. This is documented in ADR-004.

### PRNG — sub-PRNG per rule

Rules that need randomness derive a fresh PRNG from the master combination seed plus the rule name:

```ts
const prng = context.prngFor('stability-rule')
```

Each rule gets an independent stream. State pollution is structurally impossible. Master seed is derived from `hash(sorted(ingredient_ids).join('|') + '|' + solvent_id + '|' + outcome_type)`.

The PRNG implementation is mulberry32, hand-rolled in `src/domain/prng.ts`. No external randomness libraries. Documented in ADR-005.

**Never use `Math.random()` anywhere in the pipeline or domain code.**

### V1 is stateless

The pipeline computes and returns results. Nothing is persisted for combinations in v1. The read path (GET /ingredients, GET /solvents) uses the DB; the write path (POST /combinations) does not touch it. V2 will add persistence for successful combinations, using the combination_seed as a natural primary key. Documented in ADR-006.

### Error handling and observability

- Fastify's built-in error handler is overridden with a custom one that returns structured errors matching `{ error: { code, message, details? } }`
- Request IDs via `@fastify/request-id`, propagated as child logger context in Pino
- All error codes documented in `docs/errors.md`

## Testing strategy

Three layers, in order of preference:

1. **Invariant tests** (via `fast-check`) — property-based, prove general properties over generated inputs. Preferred whenever a rule has invariants that must always hold.
2. **Known-case tests** — hand-authored combinations with expected outputs. Lock in specific mechanical decisions.
3. **E2E tests** — a principled set of ~18 tests covering: one happy path per outcome group, one per failure_reason, one per fictional solvent, one Sachet case. Run against a fresh Neon test branch.

A dedicated determinism test file verifies that:
- Same input produces same output across runs (snapshot-based)
- PRNG state does not leak between combinations (run A, then B, then A again — expect identical A results)

## Neon branch management

E2E tests use Neon branches. The free tier has a **10-branch limit per project**.

Before creating a new test branch, always check current branch count. If we're at 8 or more, abort with a clear error message telling the user to run cleanup.

Test teardown always deletes the branch it created. A periodic cleanup script (`pnpm db:branch:cleanup`) deletes any test branches older than 24 hours in case a test crashed before teardown.

When working on Neon-related scripts, walk through each step with the user. This is unfamiliar territory that we want to learn together, not automate silently.

## Common commands

```bash
pnpm dev                    # Start Fastify in watch mode
pnpm test                   # Run all tests
pnpm test:unit              # Rules and invariants only (fast)
pnpm test:e2e               # E2E tests (creates and destroys a Neon branch)
pnpm db:generate            # Generate a Drizzle migration from schema changes
pnpm db:migrate             # Apply migrations to the DB pointed to by DATABASE_URL
pnpm db:seed                # Load seed/ (ingredients, solvents, tables) into the DB
pnpm db:branch:create       # Create a Neon test branch (checks 10-branch limit)
pnpm db:branch:cleanup      # Delete test branches older than 24 hours
```

## Working style

- **Sequential confirmation before execution.** Propose scope or approach, wait for confirmation, then execute. Don't produce large amounts of code without a green light on the approach.
- **Show the option landscape when there's a real choice.** For decisions with tradeoffs (naming a module, structuring a rule internally, picking a library), present 2-4 options with tradeoffs rather than a single recommendation.
- **Voice-of-apothecary lore prose. No em dashes anywhere.** This applies to lore fields in seed data, narrative wraps, and generated design docs. Aged, slightly obscure vocabulary. Doesn't over-explain.
- **Code comments are direct and plain.** Explain what the code is doing and why, using simple language. No voice-of-apothecary in comments. The no-em-dashes rule still applies here.
- **Pivots handled fluidly.** When the user redirects, don't recap the prior context; just adapt.
- **When explaining new concepts, prefer explanation over just doing.** The user is learning backend development in depth through this project. If a concept is unfamiliar (transactions, connection pooling, migration strategies, etc.), walk through it first before implementing.

## What's still open (not yet designed)

- **Sensory algorithm** — the master doc captures its current shape as a placeholder. Full design happens in its own session before implementation (Phase 9).
- **Description algorithm** — same pattern (Phase 10).
- **V2 features** — user accounts, saved combinations, emergent named variants, heat mechanic, dosage, cream outcome, and others. All deferred until v1 is running.

If a task touches these areas, stop and flag it before proceeding.

## ADRs

Architectural decisions are documented as ADRs in a local, gitignored directory (`docs/adr/` or similar per the user's setup). They're not in the public repo. When you make a non-trivial architectural decision, propose an ADR entry and let the user file it wherever they've chosen to keep them.

Existing ADRs (drafted or planned):
- ADR-001: Fastify over Express
- ADR-002: Drizzle over Prisma
- ADR-003: Neon over Supabase
- ADR-004: Result-based pipeline composition
- ADR-005: Sub-PRNG per rule
- ADR-006: V1 stateless pipeline

## Things not to do

- Don't use `Math.random()`. Ever.
- Don't add external libraries without discussing first. Especially for things with hand-rolled alternatives (PRNG, Result type).
- Don't invent ingredient properties. Look them up in `seed/ingredients/*.json`.
- Don't persist combinations in v1. The pipeline is stateless.
- Don't create Neon branches without checking the branch count first.
- Don't use em dashes anywhere, including in code comments and generated documentation.
- Don't couple domain code to HTTP or DB concerns. Rules take a context, return a context. That's it.
- Don't inline the design reference into responses. Link to the relevant section instead.