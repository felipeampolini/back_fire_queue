import { z } from 'zod';

// Variáveis de ambiente usadas pela API e pelo worker.
// Validadas na inicialização: se algo estiver faltando ou errado, o processo
// para com uma mensagem clara, em vez de quebrar no meio de um envio.
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  AWS_REGION: z.string().min(1),
  // Só existe em desenvolvimento (ElasticMQ). Vazia = usar o endpoint padrão da AWS.
  AWS_ENDPOINT_URL: z
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  SQS_QUEUE_URL: z.url(),
  SQS_DLQ_URL: z.url(),
});

export type Config = {
  port: number;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  aws: { region: string; endpoint?: string };
  sqs: { queueUrl: string; dlqUrl: string };
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
  };
}
