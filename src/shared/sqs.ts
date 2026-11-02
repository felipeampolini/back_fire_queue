import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { Config } from './config.js';
import type { NotificationMessage } from './notification.js';

// Em desenvolvimento, "endpoint" aponta para o ElasticMQ. Em produção fica
// undefined e o SDK usa o SQS real. As credenciais são lidas pelo próprio SDK
// (variáveis AWS_ACCESS_KEY_ID/SECRET em dev, IAM Role da EC2 em produção).
export function createSqsClient(aws: Config['aws']) {
  return new SQSClient({ region: aws.region, endpoint: aws.endpoint });
}

// A API depende desta interface, não do SQS diretamente: nos testes,
// basta passar um publisher falso.
export interface NotificationPublisher {
  publish(message: NotificationMessage): Promise<void>;
}

export function createSqsPublisher(client: SQSClient, queueUrl: string): NotificationPublisher {
  return {
    async publish(message) {
      await client.send(
        new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }),
      );
    },
  };
}
