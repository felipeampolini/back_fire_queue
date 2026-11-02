import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);

const app = buildApp();

try {
  // 0.0.0.0 para aceitar conexões de fora do container
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
