import { loadConfig } from '../shared/config.js';
import { createLogger } from '../shared/logger.js';
import { createSqsClient } from '../shared/sqs.js';
import { createFcmSender, createMessaging } from './fcm.js';
import { createSqsWorkerQueue } from './queue.js';
import { createWorker } from './worker.js';

// Valida as variáveis já na inicialização (falha rápido se faltar algo)
const config = loadConfig();
const logger = createLogger(config.logLevel, 'worker');

if (!config.firebase.credentialsPath) {
  logger.fatal(
    'GOOGLE_APPLICATION_CREDENTIALS não definida: o worker precisa da credencial do Firebase',
  );
  process.exit(1);
}

const sqs = createSqsClient(config.aws);

const worker = createWorker({
  queue: createSqsWorkerQueue(sqs, { queueUrl: config.sqs.queueUrl, dlqUrl: config.sqs.dlqUrl }),
  sender: createFcmSender(createMessaging(config.firebase.credentialsPath), {
    dryRun: config.firebase.dryRun,
  }),
  logger,
  batchSize: config.worker.batchSize,
  maxAttempts: config.worker.maxAttempts,
});

// Encerramento limpo (ex.: docker stop): para de ler a fila e termina
// as mensagens em andamento antes de sair. Nada fica pela metade.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    logger.info({ signal }, 'encerrando: terminando as mensagens em andamento');
    await worker.stop();
    sqs.destroy();
    logger.info('worker encerrado');
    process.exit(0);
  });
}

logger.info(
  {
    queueUrl: config.sqs.queueUrl,
    dryRun: config.firebase.dryRun,
    batchSize: config.worker.batchSize,
  },
  'worker iniciado',
);
await worker.start();
