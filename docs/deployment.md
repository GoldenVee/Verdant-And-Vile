# Deployment Readiness

What has to be true before this repo is deployed live. Nothing here is done yet; the project
has never been deployed and carries no deploy configuration.

This document is the checklist, not the design. Individual items become their own work when
picked up.

---

## Environments

Two Neon databases, one per environment.

| Environment | Endpoint | Purpose |
|---|---|---|
| Development | `ep-little-feather-afefuvt4-pooler` | Local work. Freely wiped and reseeded. |
| Production | `ep-billowing-cake-afr9x6if` | Deployed API. Never seeded casually. |

Production is currently **two migrations behind** (`0002` solvent taste, `0003` solvent aroma)
and has never had the sensory work applied.

### How the connection string is selected

Today `.env` holds both, with production commented out on line 9, and switching means editing
the file. That is fragile and it is how the wrong database eventually gets written to.

The target shape is that `.env` only ever holds development, and production's `DATABASE_URL`
lives in the deploy platform's environment where it never touches a developer machine.

### Pooled endpoint

The development URL uses Neon's pooled endpoint (`-pooler` suffix); the production URL does
not. Confirm which the deployed runtime needs before first deploy. Under the HTTP driver it
matters less, but any WebSocket or session-mode usage wants the pooled host.

---

## Blocking before first deploy

### Database safety

- **Guard `db:seed`.** It deletes every row in eleven tables (`seed.ts` lines 230 to 241) with
  no confirmation and no awareness of what it is pointed at. Today that is routine, because
  everything in the database is reproducible from the repo. It stops being routine the moment
  production exists, and becomes catastrophic when V2 adds persistence. It should refuse to run
  against anything not recognisably a development target unless explicitly forced.
- **Decide the migration-on-deploy story.** Migrations currently run by hand. Determine whether
  they run as a deploy step before the new code goes live, and what happens if one fails
  partway.
- **Apply `0002` and `0003` to production** before or as part of the first deploy.

### Security

- **Rate limiting.** There is none. `POST /combinations` runs a nine-rule pipeline and eleven
  database queries per call, so it is the expensive endpoint and the one worth protecting.
  `@fastify/rate-limit` is the natural fit.
- **Security headers.** No `@fastify/helmet` or equivalent.
- **CORS policy.** Not configured. Decide who is allowed to call the API before it is public.
- **Request body limits.** Fastify's default applies; confirm it is appropriate.
- **Verify errors do not leak internals.** The custom error handler returns structured
  `{ error: { code, message, details? } }`, which is right, but confirm no stack traces or
  database messages reach the client in production.
- **Dependency audit** as a routine step.

Input validation is already handled at the framework boundary by Fastify schemas, and `.env`
is gitignored. Those two are fine.

### Operational readiness

- **Health check endpoint.** Deploy platforms need one to know the instance is alive.
- **Graceful shutdown.** `index.ts` has no SIGTERM handling, so in-flight requests are dropped
  on redeploy.
- **Production log level.** Pino is wired through `buildApp(config.logLevel)`; confirm the
  production value and that request IDs are attached as child logger context.
- **Request timeouts**, so a slow database query cannot hold a connection open indefinitely.

### Performance and cost

- **Cache the static vocabulary.** `POST /combinations` issues eleven queries per request:
  four from `listIngredients()`, two from `getSolventBySlug()`, and five from
  `loadPipelineData()`. Every one of them fetches data that cannot change between deploys.
  Loading it once at boot removes almost all per-request database work. This is the single
  highest-value change on this list, for latency and for Neon compute billing alike.

  It interacts with a stated design goal. CLAUDE.md's thesis is that static vocabulary lives in
  DB tables so new tags can be added by inserting a row rather than deploying code. Caching at
  boot means a row insert requires a restart to take effect. Worth deciding deliberately: cache
  with a restart requirement, or cache with a TTL, or an explicit invalidation route.

### Continuous integration

- **No CI exists.** Typecheck, lint, and the unit suite should run on every PR.
- **E2E tests need Neon branch scripts.** CLAUDE.md documents `pnpm db:branch:create` and
  `pnpm db:branch:cleanup`, but neither exists in `package.json`. The E2E suite
  (`tests/e2e/api.test.ts`) is meant to run against a fresh branch that is torn down after.
- **Branch budget.** The free tier allows 10 branches per project. Two permanent environment
  branches would leave eight, and CLAUDE.md already says to abort test-branch creation at eight
  or more. Separate Neon projects for development and production would give each its own
  budget, at the cost of maintaining migrations in two places.

---

## Known drift to clean up

- CLAUDE.md lists `pnpm db:branch:create` and `pnpm db:branch:cleanup` as common commands. They
  do not exist.
- CLAUDE.md states request IDs come from `@fastify/request-id`. That package is not a
  dependency; Fastify's built-in request ID may be what is actually in use. Confirm and correct
  whichever is wrong.

---

## Not blocking, but decide before launch

- **`name` and `lore` still serialize as `null`.** The description algorithm is Phase 10. A
  public API returning null for both is a product decision, not a bug, but it should be a
  conscious one.
- **Texture is deferred to v2**, so `sensory_output.texture` is always null. Same reasoning.
- **V1 is stateless by ADR-006.** Nothing is persisted for combinations, so there is no user
  data to protect yet. That is why the database guard matters more than the environment split
  right now: the split protects data that does not exist, while the guard protects against the
  habit that will destroy it once it does.
