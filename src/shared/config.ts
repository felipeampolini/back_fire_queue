import { z } from 'zod';

// Variável vazia (ex.: "FCM_DRY_RUN=") é tratada como não definida
const emptyAsUndefined = (value: unknown) => (value === '' ? undefined : value);

// Variáveis de ambiente usadas pela API e pelo worker.
// Validadas na inicialização: se algo estiver faltando ou errado, o processo
// para com uma mensagem clara, em vez de quebrar no meio de um envio.
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  AWS_REGION: z.string().min(1),
  // Só existe em desenvolvimento (ElasticMQ). Vazia = usar o endpoint padrão da AWS.
  AWS_ENDPOINT_URL: z.preprocess(emptyAsUndefined, z.url().optional()),
  SQS_QUEUE_URL: z.url(),
  SQS_DLQ_URL: z.url(),
  // Chave exigida no header x-api-key do POST /notifications
  API_KEY: z.string().min(16, { error: 'API_KEY deve ter pelo menos 16 caracteres' }),
  // Caminho do JSON da Service Account do Firebase. Usado só pelo worker
  // (a API não envia ao Firebase, então não precisa da credencial).
  GOOGLE_APPLICATION_CREDENTIALS: z.preprocess(emptyAsUndefined, z.string().optional()),
  // true = o FCM só valida a mensagem, sem entregar (útil sem dispositivo real)
  FCM_DRY_RUN: z.preprocess(emptyAsUndefined, z.stringbool().default(false)),
  // Worker: mensagens por leitura da fila (máximo do SQS: 10)
  WORKER_BATCH_SIZE: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().int().min(1).max(10).default(10),
  ),
  // Worker: tentativas de envio antes de mandar para a DLQ
  WORKER_MAX_ATTEMPTS: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).default(5)),
});

export type Config = {
  port: number;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  aws: { region: string; endpoint?: string };
  sqs: { queueUrl: string; dlqUrl: string };
  apiKey: string;
  firebase: { credentialsPath?: string; dryRun: boolean };
  worker: { batchSize: number; maxAttempts: number };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    throw new Error(`Variáveis de ambiente inválidas:\n${z.prettifyError(result.error)}`);
  }

  const e = result.data;
  return {
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    aws: { region: e.AWS_REGION, endpoint: e.AWS_ENDPOINT_URL },
    sqs: { queueUrl: e.SQS_QUEUE_URL, dlqUrl: e.SQS_DLQ_URL },
    apiKey: e.API_KEY,
    firebase: { credentialsPath: e.GOOGLE_APPLICATION_CREDENTIALS, dryRun: e.FCM_DRY_RUN },
    worker: { batchSize: e.WORKER_BATCH_SIZE, maxAttempts: e.WORKER_MAX_ATTEMPTS },
  };
}
