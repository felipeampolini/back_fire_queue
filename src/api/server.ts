import Fastify from 'fastify';

const port = Number(process.env.PORT ?? 3000);

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

app.get('/health', async () => ({ status: 'ok' }));

try {
  // 0.0.0.0 para aceitar conexões de fora do container
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
