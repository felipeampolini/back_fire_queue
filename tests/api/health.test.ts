import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api/app.js';

describe('GET /health', () => {
  const app = buildApp({ logLevel: 'silent' });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 com status ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
