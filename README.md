# Verdant & Vile
**Verdant & Vile** is a portfolio backend project that models an apothecary shop where users combine ingredients with solvents to produce various apothecary outcomes. The system is grounded in real chemistry (extraction, pH, solubility, compound interactions) with fictional elements layered on top.

## Core design values

- **Solvent-agnostic naming** — v1 outcomes use generic terms; specialized named variants emerge in v2 as users discover solvent-specific paths
- **Scalable architecture over premature complexity** — the schema is forward-compatible; v1 ships lean, v2+ additions are additive
- **Fictional mechanics grounded in real chemistry** — real chemistry rules drive the algorithm; fictional ingredients bend those rules through their data values, not through special-case logic
- **Portfolio-worthy and interview-explainable** — every architectural choice has a defensible reason

### Approach

- **All ingredient data is hand-authored and locally stored.** Real ingredients are grounded in actual chemistry and history; fictional ingredients are wholly authored with internally consistent fictional chemistry.
- **Normalized relational schema** with tables for ingredients, tags, compound classes, aroma notes, and interaction rules
- **Pluggable rules pipeline** — chemistry mechanics are individual rule modules registered to a pipeline; adding a new mechanic means writing a new rule, not refactoring
- **Rules as pluggable modules** — extensibility without refactoring; new mechanic = new rule
- **Forward-compatible schema** — v2 hook fields present in v1 schema, unread by v1 rules
- **Fictional ingredients use same algorithm as real ones** — no special-casing; weirdness lives in data values, not code branches
- **Solvent-agnostic v1 outcomes** — specialized variants as v2 discovery feature
- **Compulsion constrained to work only along existing seams** — amplifies what's there rather than manufacturing action from nothing
- **Failure states are informative, not silent** — `failure_reason` enum split into three toxicity dimensions, plus stability and extraction failures
- **Deterministic seeded randomness** — reproducible per-combination outputs; testable against known seeds; each combination varied

---
## Technologies
Node.js + TypeScript, Fastify, Drizzle, Neon Postgres, Vitest.

## Prerequisites

- **Node.js 22 or newer** (developed on 24).
- **pnpm**, activated through Corepack (ships with Node): `corepack enable pnpm`.
- A **Neon Postgres** database. The free tier is enough. You need its connection string.

## First-time setup (fresh clone)

```bash
# 1. Activate pnpm (once per machine)
corepack enable pnpm

# 2. Install dependencies
pnpm install

# 3. Create your local env file and fill in DATABASE_URL
cp .env.example .env
#    Then edit .env and paste your Neon connection string into DATABASE_URL.
#    Use the pooled connection string from the Neon console.

# 4. Create the schema in your database
pnpm db:migrate

# 5. Load the seed data (ingredients, solvents, pipeline tables)
pnpm db:seed

# 6. Start the server in watch mode
pnpm dev
```

The server listens on `http://localhost:3000`. Confirm it is up:

```bash
curl http://localhost:3000/health          # {"status":"ok"}
curl http://localhost:3000/ingredients      # 57 ingredients
curl http://localhost:3000/solvents         # 8 solvents
```

`.env` is gitignored. Never commit real credentials.

## Running after setup

Day to day, you only need:

```bash
pnpm dev
```

Re-run the data steps only when something changed:

- **Seed data changed** (files under `seed/`): `pnpm db:seed` reloads it (the seed clears and reinserts, so it is safe to re-run).
- **Schema changed** (`src/db/schema.ts`): `pnpm db:generate` to create a new migration, then `pnpm db:migrate` to apply it.

## Common commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start Fastify in watch mode |
| `pnpm typecheck` | Type-check without emitting |
| `pnpm lint` | Lint with ESLint |
| `pnpm format` | Format with Prettier |
| `pnpm test` | Run all tests |
| `pnpm test:unit` | Run fast rule, invariant, and domain tests |
| `pnpm db:generate` | Generate a Drizzle migration from schema changes |
| `pnpm db:migrate` | Apply migrations to the database in `DATABASE_URL` |
| `pnpm db:seed` | Load `seed/` into the database |

## Project layout

See `CLAUDE.md` for the full architecture and conventions, and `docs/` for the design
reference and per-rule specifications.
