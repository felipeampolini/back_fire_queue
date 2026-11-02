import { afterAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../helpers/app.js';

describe('GET /health', () => {
  const { app } = buildTestApp();

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 com status ok, sem exigir API key', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
