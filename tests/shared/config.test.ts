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
});
