import Fastify from 'fastify';
import type { Config } from '../shared/config.js';

type AppOptions = {
  logLevel: Config['logLevel'];
};

// Cria e configura o app sem abrir porta: o server.ts sobe o servidor,
// e os testes usam app.inject() para simular requisições.
export function buildApp({ logLevel }: AppOptions) {
  const app = Fastify({ logger: { level: logLevel } });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
