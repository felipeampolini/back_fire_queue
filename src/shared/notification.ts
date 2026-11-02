import { z } from 'zod';

// Limites do FCM
const MAX_TOKENS_PER_REQUEST = 500; // sendEachForMulticast
const MAX_PAYLOAD_BYTES = 4096; // notification + data
const MAX_TTL_SECONDS = 28 * 24 * 60 * 60; // 28 dias
const TOPIC_PATTERN = /^[a-zA-Z0-9-_.~%]+$/;

const token = z.string().min(1);

// Para quem a notificação vai: um dispositivo, vários ou um tópico
const targetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('token'), value: token }),
  z.object({ type: z.literal('tokens'), value: z.array(token).min(1).max(MAX_TOKENS_PER_REQUEST) }),
  z.object({ type: z.literal('topic'), value: z.string().regex(TOPIC_PATTERN) }),
]);

// O que a API recebe no POST /notifications
export const notificationRequestSchema = z
  .object({
    target: targetSchema,
    notification: z
      .object({
        title: z.string().min(1),
        body: z.string().min(1),
      })
      .optional(),
    // O FCM só aceita valores string no campo data
    data: z.record(z.string(), z.string()).optional(),
    priority: z.enum(['high', 'normal']).default('normal'),
    ttlSeconds: z.number().int().min(0).max(MAX_TTL_SECONDS).optional(),
  })
  .refine((n) => n.notification || n.data, {
    error: 'Informe "notification" e/ou "data"',
  })
  .refine(
    (n) => Buffer.byteLength(JSON.stringify({ n: n.notification, d: n.data })) <= MAX_PAYLOAD_BYTES,
    { error: `"notification" + "data" devem ter no máximo ${MAX_PAYLOAD_BYTES} bytes` },
  );

// O que trafega na fila: o pedido + dados gerados pela API
export const notificationMessageSchema = notificationRequestSchema.and(
  z.object({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
  }),
);

export type NotificationRequest = z.infer<typeof notificationRequestSchema>;
export type NotificationMessage = z.infer<typeof notificationMessageSchema>;
