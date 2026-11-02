import { randomUUID } from 'node:crypto';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import { pino } from 'pino';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationMessage } from '../../src/shared/notification.js';
import { createSqsClient, createSqsPublisher } from '../../src/shared/sqs.js';
import type { SendResult } from '../../src/worker/fcm.js';
import { createSqsWorkerQueue } from '../../src/worker/queue.js';
import { createWorker } from '../../src/worker/worker.js';

// Worker de verdade + ElasticMQ de verdade; só o Firebase é falso.
const endpoint = process.env.AWS_ENDPOINT_URL;

describe.skipIf(!endpoint)('worker (integração com ElasticMQ)', () => {
  const client = createSqsClient({ region: process.env.AWS_REGION ?? 'us-east-1', endpoint });
  let queueUrl: string;
  let dlqUrl: string;

  async function createQueue(prefix: string) {
    const result = await client.send(
      new CreateQueueCommand({ QueueName: `${prefix}-${randomUUID()}` }),
    );
    return result.QueueUrl!;
  }

  async function countMessages(url: string) {
    const { Attributes } = await client.send(
      new GetQueueAttributesCommand({
        QueueUrl: url,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
      }),
    );
    return (
      Number(Attributes?.ApproximateNumberOfMessages) +
      Number(Attributes?.ApproximateNumberOfMessagesNotVisible)
    );
  }

  function newMessage(): NotificationMessage {
    return {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      target: { type: 'token', value: 'token-1' },
      notification: { title: 'Olá', body: 'Integração' },
      priority: 'normal',
    };
  }

  function startWorker(send: (m: NotificationMessage) => Promise<SendResult>) {
    const worker = createWorker({
      queue: createSqsWorkerQueue(client, { queueUrl, dlqUrl, waitTimeSeconds: 1 }),
      sender: { send },
      logger: pino({ level: process.env.TEST_LOG ?? 'silent' }),
      maxAttempts: 3,
      retryBaseDelaySeconds: 0, // sem atraso, para o teste ser rápido
    });
    worker.start();
    return worker;
  }

  // Filas novas a cada teste. Motivo: o stop() cancela o long polling do lado do
  // cliente, mas o servidor pode entregar a próxima mensagem a essa leitura já
  // abandonada — ela fica invisível até o visibility timeout e só então volta.
  // Não há perda, mas o teste seguinte ficaria esperando por ela.
  beforeEach(async () => {
    queueUrl = await createQueue('test-worker');
    dlqUrl = await createQueue('test-worker-dlq');
  });

  afterEach(async () => {
    await client.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
    await client.send(new DeleteQueueCommand({ QueueUrl: dlqUrl }));
  });

  afterAll(() => {
    client.destroy();
  });

  it('envia a notificação publicada pela API e a remove da fila', async () => {
    const send = vi.fn().mockResolvedValue({ successCount: 1, failures: [] });
    const message = newMessage();

    await createSqsPublisher(client, queueUrl).publish(message);
    const worker = startWorker(send);

    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(message), { timeout: 5000 });
    await worker.stop();

    expect(await countMessages(queueUrl)).toBe(0);
  });

  it('com o Firebase sempre fora do ar: tenta 3 vezes e manda para a DLQ com o motivo', async () => {
    const send = vi.fn().mockResolvedValue({
      successCount: 0,
      failures: [{ token: 'token-1', code: 'messaging/server-unavailable', message: 'fora' }],
    });
    const message = newMessage();

    await createSqsPublisher(client, queueUrl).publish(message);
    const worker = startWorker(send);

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3), { timeout: 10000 });
    await worker.stop();

    // Cada tentativa recebeu o número certo
    expect(send.mock.calls.map(([m]) => m.attempt)).toEqual([undefined, 2, 3]);
    expect(await countMessages(queueUrl)).toBe(0);

    const dlq = await client.send(
      new ReceiveMessageCommand({
        QueueUrl: dlqUrl,
        WaitTimeSeconds: 2,
        MessageAttributeNames: ['reason'],
      }),
    );
    expect(JSON.parse(dlq.Messages![0]!.Body!).id).toBe(message.id);
    expect(dlq.Messages![0]!.MessageAttributes?.reason?.StringValue).toContain(
      'messaging/server-unavailable',
    );
  }, 15_000); // 3 tentativas passando pela fila real levam alguns segundos

  it('stop() encerra rápido mesmo durante o long polling', async () => {
    const worker = startWorker(vi.fn());
    await new Promise((resolve) => setTimeout(resolve, 200)); // worker esperando mensagens

    const startedAt = Date.now();
    await worker.stop();

    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});
