// POST /combinations. The write path. Validates the request shape at the framework
// boundary, then (once the pipeline is built) resolves a combination. For now the
// rules pipeline is stubbed, so this validates input and returns NOT_IMPLEMENTED.

import type { FastifyInstance } from 'fastify';

import { OUTCOMES } from '../domain/enums.js';
import { AppError, ERROR_CODES } from '../errors.js';

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
    ingredients: {
      type: 'array',
      items: { type: 'string' },
      minItems: 2,
      maxItems: 4,
    },
    solvent: { type: 'string' },
    outcome: { type: 'string', enum: [...OUTCOMES] },
  },
} as const;

export function registerCombinationRoutes(app: FastifyInstance): void {
  app.post<{ Body: CombinationBody }>(
    '/combinations',
    { schema: { body: bodySchema } },
    async () => {
      throw new AppError(
        501,
        ERROR_CODES.NOT_IMPLEMENTED,
        'The combination pipeline is not yet implemented. The request shape is validated; rule resolution lands next.',
      );
    },
  );
}
