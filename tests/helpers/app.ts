import { vi } from 'vitest';
import { buildApp } from '../../src/api/app.js';
import type { NotificationPublisher } from '../../src/shared/sqs.js';

export const TEST_API_KEY = 'chave-de-teste-com-mais-de-16';

// App com um publisher falso: os testes da API não dependem do SQS
export function buildTestApp(publisher: NotificationPublisher = { publish: vi.fn() }) {
  const app = buildApp({ logLevel: 'silent', apiKey: TEST_API_KEY, publisher });
  return { app, publisher };
}
