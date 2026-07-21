// GET /solvents and GET /solvents/:slug. Thin read-path route.

import type { FastifyInstance } from 'fastify';

import { getSolventBySlug, listSolvents } from '../data/solvents.js';
import { AppError } from '../errors.js';

export function registerSolventRoutes(app: FastifyInstance): void {
  app.get('/solvents', async () => {
    const items = await listSolvents();
    return { solvents: items, count: items.length };
  });

  app.get<{ Params: { slug: string } }>('/solvents/:slug', async (request) => {
    const solvent = await getSolventBySlug(request.params.slug);
    if (!solvent) {
      throw AppError.notFound(`No solvent with slug '${request.params.slug}'.`);
    }
    return solvent;
  });
}
