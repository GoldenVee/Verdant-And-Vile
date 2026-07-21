// GET /ingredients and GET /ingredients/:slug. Thin: it calls the data layer and
// returns JSON, knowing nothing about the pipeline.

import type { FastifyInstance } from 'fastify';

import { getIngredientBySlug, listIngredients } from '../data/ingredients.js';
import { AppError } from '../errors.js';

export function registerIngredientRoutes(app: FastifyInstance): void {
  app.get('/ingredients', async () => {
    const items = await listIngredients();
    return { ingredients: items, count: items.length };
  });

  app.get<{ Params: { slug: string } }>('/ingredients/:slug', async (request) => {
    const ingredient = await getIngredientBySlug(request.params.slug);
    if (!ingredient) {
      throw AppError.notFound(`No ingredient with slug '${request.params.slug}'.`);
    }
    return ingredient;
  });
}
