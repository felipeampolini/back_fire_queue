import { randomUUID } from 'node:crypto';
import { CreateQueueCommand, DeleteQueueCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSqsClient, createSqsPublisher } from '../../src/shared/sqs.js';
import type { NotificationMessage } from '../../src/shared/notification.js';

// Teste de integração: usa o ElasticMQ de verdade (sobe junto com `make test`).
// Sem AWS_ENDPOINT_URL (ex.: fora do Docker), o teste é pulado.
const endpoint = process.env.AWS_ENDPOINT_URL;

describe.skipIf(!endpoint)('SQS publisher (integração com ElasticMQ)', () => {
  const client = createSqsClient({ region: process.env.AWS_REGION ?? 'us-east-1', endpoint });
  let queueUrl: string;

  // Fila temporária e exclusiva deste teste: não interfere na fila usada pelo worker
  beforeAll(async () => {
    const result = await client.send(new CreateQueueCommand({ QueueName: `test-${randomUUID()}` }));
    queueUrl = result.QueueUrl!;
  });

  afterAll(async () => {
    await client.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
    client.destroy();
  });

  it('publica a notificação como JSON na fila', async () => {
    const message: NotificationMessage = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      target: { type: 'token', value: 'device-token-123' },
      notification: { title: 'Olá', body: 'Teste de integração' },
      priority: 'high',
    };

    await createSqsPublisher(client, queueUrl).publish(message);

    const received = await client.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 5 }),
    );
    expect(received.Messages).toHaveLength(1);
    expect(JSON.parse(received.Messages![0]!.Body!)).toEqual(message);
  });
});
