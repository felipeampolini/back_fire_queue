import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type { NotificationMessage } from '../shared/notification.js';

export type ReceivedMessage = {
  body: string;
  receiptHandle: string;
  // Quantas vezes o SQS já entregou esta mensagem (1 na primeira vez)
  receiveCount: number;
};

// Operações de fila que o worker usa. Nos testes unitários, um objeto falso.
export interface WorkerQueue {
  receive(options: { maxMessages: number; signal?: AbortSignal }): Promise<ReceivedMessage[]>;
  delete(receiptHandle: string): Promise<void>;
  // Devolve à fila como mensagem nova, visível só depois do atraso (backoff)
  requeue(message: NotificationMessage, delaySeconds: number): Promise<void>;
  // Manda para a DLQ, guardando o motivo como atributo da mensagem
  deadLetter(body: string, reason: string): Promise<void>;
}

type SqsWorkerQueueOptions = {
  queueUrl: string;
  dlqUrl: string;
  waitTimeSeconds?: number;
};

export function createSqsWorkerQueue(
  client: SQSClient,
  { queueUrl, dlqUrl, waitTimeSeconds = 20 }: SqsWorkerQueueOptions,
): WorkerQueue {
  return {
    async receive({ maxMessages, signal }) {
      const result = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: maxMessages,
          WaitTimeSeconds: waitTimeSeconds, // long polling
          MessageSystemAttributeNames: ['ApproximateReceiveCount'],
        }),
        { abortSignal: signal },
      );

      return (result.Messages ?? []).map((m) => ({
        body: m.Body ?? '',
        receiptHandle: m.ReceiptHandle!,
        receiveCount: Number(m.Attributes?.ApproximateReceiveCount ?? 1),
      }));
    },

    async delete(receiptHandle) {
      await client.send(
        new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }),
      );
    },

    async requeue(message, delaySeconds) {
      await client.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(message),
          DelaySeconds: delaySeconds,
        }),
      );
    },

    async deadLetter(body, reason) {
      await client.send(
        new SendMessageCommand({
          QueueUrl: dlqUrl,
          MessageBody: body,
          MessageAttributes: { reason: { DataType: 'String', StringValue: reason } },
        }),
      );
    },
  };
}
