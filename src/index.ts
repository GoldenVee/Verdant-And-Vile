// Fastify bootstrap. Wires the logger, request ids, the structured error handler, and
// the routes, then listens. HTTP concerns live here; the pipeline and data layers know
// nothing about Fastify.

import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyError } from 'fastify';

import { loadConfig } from './config.js';
import { AppError, ERROR_CODES, type ErrorBody } from './errors.js';
import { registerCombinationRoutes } from './routes/combinations.js';
import { registerIngredientRoutes } from './routes/ingredients.js';
import { registerSolventRoutes } from './routes/solvents.js';

export function buildApp(logLevel: string) {
  const app = Fastify({
    logger: { level: logLevel },
    // Fastify binds request.id to a per-request child logger. Honor an inbound
    // x-request-id header, otherwise generate one.
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });

  // Structured error handler: every error becomes { error: { code, message, details? } }.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send(error.toBody());
      return;
    }
    // Fastify schema validation failures.
    if (error.validation) {
      const body: ErrorBody = {
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: error.message,
          details: error.validation,
        },
      };
      reply.status(400).send(body);
      return;
    }
    // Anything else is unexpected: log with request context, return a generic 500.
    request.log.error({ err: error }, 'Unhandled error');
    const body: ErrorBody = {
      error: { code: ERROR_CODES.INTERNAL_ERROR, message: 'Internal server error.' },
    };
    reply.status(500).send(body);
  });

  app.get('/health', async () => ({ status: 'ok' }));

  registerIngredientRoutes(app);
  registerSolventRoutes(app);
  registerCombinationRoutes(app);

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = buildApp(config.logLevel);
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  console.error('Failed to start server:', error);
  process.exitCode = 1;
});
