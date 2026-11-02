import Fastify from 'fastify';

// Cria e configura o app sem abrir porta: o server.ts sobe o servidor,
// e os testes usam app.inject() para simular requisições.
export function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
