import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/shared/config.js';

const validEnv = {
  AWS_REGION: 'us-east-1',
  AWS_ENDPOINT_URL: 'http://elasticmq:9324',
  SQS_QUEUE_URL: 'http://elasticmq:9324/000000000000/notifications-queue',
  SQS_DLQ_URL: 'http://elasticmq:9324/000000000000/notifications-dlq',
  API_KEY: 'chave-de-teste-com-mais-de-16',
};

describe('loadConfig', () => {
  it('monta a configuração a partir das variáveis de ambiente', () => {
    const config = loadConfig({ ...validEnv, PORT: '4000', LOG_LEVEL: 'debug' });

    expect(config).toEqual({
      port: 4000,
      logLevel: 'debug',
      aws: { region: 'us-east-1', endpoint: 'http://elasticmq:9324' },
      sqs: { queueUrl: validEnv.SQS_QUEUE_URL, dlqUrl: validEnv.SQS_DLQ_URL },
      apiKey: validEnv.API_KEY,
      firebase: { credentialsPath: undefined, dryRun: false },
      worker: { batchSize: 10, maxAttempts: 5 },
      firebaseWeb: undefined,
    });
  });

  it('usa valores padrão para PORT e LOG_LEVEL', () => {
    const config = loadConfig(validEnv);

    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe('info');
  });

  it('trata AWS_ENDPOINT_URL vazia como ausente (produção usa o endpoint da AWS)', () => {
    const config = loadConfig({ ...validEnv, AWS_ENDPOINT_URL: '' });

    expect(config.aws.endpoint).toBeUndefined();
  });

  it('falha informando a variável que está faltando', () => {
    const env = { ...validEnv, SQS_QUEUE_URL: undefined };

    expect(() => loadConfig(env)).toThrow(/SQS_QUEUE_URL/);
  });

  it('falha quando a URL da fila é inválida', () => {
    expect(() => loadConfig({ ...validEnv, SQS_QUEUE_URL: 'nao-e-url' })).toThrow(/SQS_QUEUE_URL/);
  });

  it('exige API_KEY com pelo menos 16 caracteres', () => {
    expect(() => loadConfig({ ...validEnv, API_KEY: 'curta' })).toThrow(/API_KEY/);
  });

  it('lê a credencial do Firebase e o modo dry run', () => {
    const config = loadConfig({
      ...validEnv,
      GOOGLE_APPLICATION_CREDENTIALS: '/app/secrets/firebase-sa.json',
      FCM_DRY_RUN: 'true',
    });

    expect(config.firebase).toEqual({
      credentialsPath: '/app/secrets/firebase-sa.json',
      dryRun: true,
    });
  });

  it('limita o lote do worker a 10 mensagens (máximo do SQS)', () => {
    expect(() => loadConfig({ ...validEnv, WORKER_BATCH_SIZE: '11' })).toThrow(/WORKER_BATCH_SIZE/);
  });

  it('habilita a página de teste só com toda a configuração web do Firebase', () => {
    const web = {
      FIREBASE_WEB_API_KEY: 'api-key',
      FIREBASE_WEB_PROJECT_ID: 'projeto',
      FIREBASE_WEB_MESSAGING_SENDER_ID: '123',
      FIREBASE_WEB_APP_ID: '1:123:web:abc',
      FIREBASE_WEB_VAPID_KEY: 'vapid',
    };

    expect(loadConfig({ ...validEnv, ...web }).firebaseWeb).toEqual({
      apiKey: 'api-key',
      projectId: 'projeto',
      messagingSenderId: '123',
      appId: '1:123:web:abc',
      vapidKey: 'vapid',
    });
    expect(
      loadConfig({ ...validEnv, ...web, FIREBASE_WEB_VAPID_KEY: '' }).firebaseWeb,
    ).toBeUndefined();
  });
});
