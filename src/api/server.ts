import { loadConfig } from '../shared/config.js';
import { createSqsClient, createSqsPublisher } from '../shared/sqs.js';
import { buildApp } from './app.js';

const config = loadConfig();

const sqs = createSqsClient(config.aws);

const app = buildApp({
  logLevel: config.logLevel,
  apiKey: config.apiKey,
  publisher: createSqsPublisher(sqs, config.sqs.queueUrl),
  firebaseWeb: config.firebaseWeb,
});

// Encerramento limpo (ex.: docker stop): para de aceitar conexões
// e espera as requisições em andamento terminarem.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'encerrando a API');
    await app.close();
    sqs.destroy();
    process.exit(0);
  });
}

try {
  // 0.0.0.0 para aceitar conexões de fora do container
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
