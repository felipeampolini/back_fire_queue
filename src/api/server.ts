import { loadConfig } from '../shared/config.js';
import { buildApp } from './app.js';

const config = loadConfig();

const app = buildApp({ logLevel: config.logLevel });

try {
  // 0.0.0.0 para aceitar conexões de fora do container
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
