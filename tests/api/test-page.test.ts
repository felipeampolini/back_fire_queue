import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/api/app.js';
import { TEST_API_KEY } from '../helpers/app.js';

const firebaseWeb = {
  apiKey: 'web-api-key',
  projectId: 'projeto-teste',
  messagingSenderId: '123',
  appId: '1:123:web:abc',
  vapidKey: 'vapid-publica',
};

function build(options: { firebaseWeb?: typeof firebaseWeb } = {}) {
  return buildApp({
    logLevel: 'silent',
    apiKey: TEST_API_KEY,
    publisher: { publish: vi.fn() },
    ...options,
  });
}

describe('página de teste (/test)', () => {
  const app = build({ firebaseWeb });

  afterAll(async () => {
    await app.close();
  });

  it('serve a página HTML sem exigir API key', async () => {
    const response = await app.inject({ method: 'GET', url: '/test/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('redireciona /test para /test/', async () => {
    const response = await app.inject({ method: 'GET', url: '/test' });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/test/');
  });

  it('entrega a configuração web do Firebase (valores públicos)', async () => {
    const response = await app.inject({ method: 'GET', url: '/test/config.json' });

    expect(response.json()).toMatchObject({
      firebaseConfig: { projectId: 'projeto-teste', appId: '1:123:web:abc' },
      vapidKey: 'vapid-publica',
    });
    expect(response.body).not.toContain(TEST_API_KEY);
  });

  it('gera o service worker com a mesma configuração', async () => {
    const response = await app.inject({ method: 'GET', url: '/test/firebase-messaging-sw.js' });

    expect(response.headers['content-type']).toContain('application/javascript');
    expect(response.body).toContain('"projectId":"projeto-teste"');
    expect(response.body).toContain('firebase-messaging-compat.js');
  });

  it('não aparece na documentação da API', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/json' });

    expect(Object.keys(response.json().paths).some((p) => p.startsWith('/test'))).toBe(false);
  });
});

describe('página de teste sem configuração web do Firebase', () => {
  it('não é publicada', async () => {
    const app = build();

    const response = await app.inject({ method: 'GET', url: '/test/' });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
