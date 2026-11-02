import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notificationRequestSchema, type NotificationMessage } from '../../shared/notification.js';
import type { NotificationPublisher } from '../../shared/sqs.js';
import { errorResponseSchema } from '../errors.js';

type NotificationRoutesOptions = {
  apiKey: string;
  publisher: NotificationPublisher;
};

const acceptedResponseSchema = z.object({
  id: z.uuid().describe('Identificador da notificação, para rastreio nos logs'),
});

const requestExample = {
  target: { type: 'token', value: '<device-token>' },
  notification: { title: 'Pedido enviado', body: 'Seu pedido #42 saiu para entrega' },
  data: { orderId: '42' },
  priority: 'high',
};

// Compara em tempo constante, para não revelar pela demora da resposta
// quantos caracteres da chave estavam certos (ataque de timing).
function isValidApiKey(received: unknown, expected: string) {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const notificationRoutes: FastifyPluginAsync<NotificationRoutesOptions> = async (
  app,
  { apiKey, publisher },
) => {
  // Hook registrado dentro deste plugin: vale só para as rotas daqui
  // (o /health e o /docs continuam públicos).
  app.addHook('onRequest', async (request, reply) => {
    if (!isValidApiKey(request.headers['x-api-key'], apiKey)) {
      return reply.code(401).send({ error: 'API key ausente ou inválida' });
    }
  });

  app.withTypeProvider<ZodTypeProvider>().post(
    '/notifications',
    {
      schema: {
        summary: 'Enfileira uma notificação para envio via Firebase',
        description:
          'Valida o pedido, publica na fila e responde imediatamente com 202. ' +
          'O envio ao Firebase é feito depois, pelo worker.',
        tags: ['notifications'],
        security: [{ apiKey: [] }],
        body: notificationRequestSchema.meta({ examples: [requestExample] }),
        response: {
          202: acceptedResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const message: NotificationMessage = {
        ...request.body,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };

      try {
        await publisher.publish(message);
      } catch (err) {
        request.log.error({ err, notificationId: message.id }, 'falha ao publicar na fila');
        return reply.code(503).send({ error: 'Fila indisponível, tente novamente em instantes' });
      }

      request.log.info({ notificationId: message.id }, 'notificação enfileirada');
      return reply.code(202).send({ id: message.id });
    },
  );
};
