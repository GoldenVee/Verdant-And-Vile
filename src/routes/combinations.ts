// POST /combinations. The write path. Validates the request at the framework boundary,
// resolves ingredients and solvent, runs the rules pipeline, and serializes the resolved
// preparation. A combination that fails a rule is a valid informative result (failed:true
// with a failure reason), not an HTTP error.

import type { FastifyInstance } from 'fastify';

import { listIngredients } from '../data/ingredients.js';
import { loadPipelineData } from '../data/pipeline-data.js';
import { getSolventBySlug } from '../data/solvents.js';
import { OUTCOMES } from '../domain/enums.js';
import type { Outcome } from '../domain/enums.js';
import { AppError } from '../errors.js';
import type { BrewingContext } from '../pipeline/index.js';
import { buildRules, createContext, runPipeline } from '../pipeline/index.js';

interface CombinationBody {
  ingredients: string[];
  solvent: string;
  outcome: string;
}

const bodySchema = {
  type: 'object',
  required: ['ingredients', 'solvent', 'outcome'],
  additionalProperties: false,
  properties: {
    ingredients: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
    solvent: { type: 'string' },
    outcome: { type: 'string', enum: [...OUTCOMES] },
  },
} as const;

// Serializes the resolved (or failed) combination. sensoryOutput carries colour and
// luminosity; its remaining fields are null pending the rest of Phase 9. name and lore are
// null pending the description algorithm (Phase 10).
function serialize(
  context: BrewingContext,
  request: CombinationBody,
  failureReason: string | null,
) {
  return {
    failed: failureReason !== null,
    failureReason,
    outcome: request.outcome,
    solvent: request.solvent,
    ingredients: request.ingredients,
    effects: context.effects,
    stability: context.stability,
    stabilityState: context.stabilityState,
    toxicity: context.toxicity,
    toxicityState: context.toxicityState,
    marks: context.marks,
    narrativeWrap: context.narrativeWrap,
    warnings: context.warnings,
    sensoryOutput: context.sensoryOutput,
    name: null,
    lore: null,
  };
}

export function registerCombinationRoutes(app: FastifyInstance): void {
  app.post<{ Body: CombinationBody }>(
    '/combinations',
    { schema: { body: bodySchema } },
    async (request) => {
      const body = request.body;

      // Resolve ingredients by slug.
      const all = await listIngredients();
      const bySlug = new Map(all.map((i) => [i.slug, i]));
      const resolved = [];
      const missing: string[] = [];
      for (const slug of body.ingredients) {
        const ingredient = bySlug.get(slug);
        if (ingredient) resolved.push(ingredient);
        else missing.push(slug);
      }
      if (missing.length > 0) {
        throw AppError.validation(`Unknown ingredient slug(s): ${missing.join(', ')}.`, {
          missing,
        });
      }

      const solvent = await getSolventBySlug(body.solvent);
      if (!solvent) {
        throw AppError.validation(`Unknown solvent slug: ${body.solvent}.`, {
          solvent: body.solvent,
        });
      }

      const data = await loadPipelineData();
      const context = createContext({
        ingredients: resolved,
        solvent,
        outcome: body.outcome as Outcome,
      });
      const result = runPipeline(context, buildRules(data));

      return serialize(context, body, result.ok ? null : result.error.reason);
    },
  );
}
