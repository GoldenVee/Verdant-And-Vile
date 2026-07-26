// API-level tests. These inject synthetic requests into the app in-process (no port,
// no network) and assert on responses: routing, validation, serialization, error shapes.
//
// The read routes query the database in DATABASE_URL, so this suite expects a seeded DB.
// It does not test chemistry logic; that belongs in the rule unit tests.

import { afterAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';

const app = buildApp('silent');

afterAll(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('reports ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /ingredients', () => {
  it('returns all seeded ingredients with assembled relations', async () => {
    const res = await app.inject({ method: 'GET', url: '/ingredients' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(57);
    expect(body.ingredients).toHaveLength(57);
    // Relations are assembled, not left as raw rows.
    const foxglove = body.ingredients.find((i: { slug: string }) => i.slug === 'foxglove');
    expect(foxglove.compoundClasses).toEqual(
      expect.arrayContaining([{ class: 'glycoside', concentration: 0.85 }]),
    );
    expect(foxglove.aromaNotes.length).toBeGreaterThan(0);
  });
});

describe('GET /ingredients/:slug', () => {
  it('returns a single ingredient', async () => {
    const res = await app.inject({ method: 'GET', url: '/ingredients/valerian' });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Valerian');
  });

  it('404s with a structured error for an unknown slug', async () => {
    const res = await app.inject({ method: 'GET', url: '/ingredients/nonexistent' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('GET /solvents', () => {
  it('returns all eight solvents including fictional signatures', async () => {
    const res = await app.inject({ method: 'GET', url: '/solvents' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(8);
    const lacuna = body.solvents.find((s: { slug: string }) => s.slug === 'lacuna');
    expect(lacuna.signatureTransformation.type).toBe('subtractive-erasure');
  });
});

describe('POST /combinations', () => {
  it('accepts a valid shape then returns 501 (pipeline stubbed)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/combinations',
      payload: { ingredients: ['foxglove', 'valerian'], solvent: 'water', outcome: 'potion' },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().error.code).toBe('NOT_IMPLEMENTED');
  });

  it('rejects fewer than two ingredients', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/combinations',
      payload: { ingredients: ['foxglove'], solvent: 'water', outcome: 'potion' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an outcome outside the enum', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/combinations',
      payload: { ingredients: ['foxglove', 'valerian'], solvent: 'water', outcome: 'nonsense' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});
