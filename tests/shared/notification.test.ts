import { describe, expect, it } from 'vitest';
import {
  notificationMessageSchema,
  notificationRequestSchema,
} from '../../src/shared/notification.js';

const validRequest = {
  target: { type: 'token', value: 'device-token-123' },
  notification: { title: 'Olá', body: 'Sua notificação chegou' },
};

describe('notificationRequestSchema', () => {
  it('aceita um pedido válido e aplica priority "normal" por padrão', () => {
    const result = notificationRequestSchema.parse(validRequest);

    expect(result.priority).toBe('normal');
  });

  it('aceita os três tipos de destino: token, tokens e topic', () => {
    const targets = [
      { type: 'token', value: 'abc' },
      { type: 'tokens', value: ['abc', 'def'] },
      { type: 'topic', value: 'promocoes' },
    ];

    for (const target of targets) {
      expect(notificationRequestSchema.safeParse({ ...validRequest, target }).success).toBe(true);
    }
  });

  it('aceita só "data", sem "notification" (mensagem silenciosa)', () => {
    const result = notificationRequestSchema.safeParse({
      target: validRequest.target,
      data: { orderId: '42' },
    });

    expect(result.success).toBe(true);
  });

  it('rejeita pedido sem "notification" e sem "data"', () => {
    const result = notificationRequestSchema.safeParse({ target: validRequest.target });

    expect(result.success).toBe(false);
  });

  it('rejeita tipo de destino desconhecido', () => {
    const result = notificationRequestSchema.safeParse({
      ...validRequest,
      target: { type: 'email', value: 'a@b.com' },
    });

    expect(result.success).toBe(false);
  });

  it('rejeita mais de 500 tokens (limite do FCM por envio)', () => {
    const value = Array.from({ length: 501 }, (_, i) => `token-${i}`);
    const result = notificationRequestSchema.safeParse({
      ...validRequest,
      target: { type: 'tokens', value },
    });

    expect(result.success).toBe(false);
  });

  it('rejeita nome de tópico com caracteres inválidos', () => {
    const result = notificationRequestSchema.safeParse({
      ...validRequest,
      target: { type: 'topic', value: 'tópico com espaço' },
    });

    expect(result.success).toBe(false);
  });

  it('rejeita valores não-string em "data" (o FCM só aceita string)', () => {
    const result = notificationRequestSchema.safeParse({ ...validRequest, data: { count: 1 } });

    expect(result.success).toBe(false);
  });

  it('rejeita payload acima de 4 KB', () => {
    const result = notificationRequestSchema.safeParse({
      ...validRequest,
      data: { big: 'x'.repeat(5000) },
    });

    expect(result.success).toBe(false);
  });
});

describe('notificationMessageSchema', () => {
  it('exige id (UUID) e createdAt (data ISO) além do pedido', () => {
    const message = {
      ...validRequest,
      id: '7d0a3e2c-1b4f-4c8e-9a6d-2f5b8c1e0d3a',
      createdAt: '2026-11-02T20:00:00.000Z',
    };

    expect(notificationMessageSchema.safeParse(message).success).toBe(true);
    expect(notificationMessageSchema.safeParse(validRequest).success).toBe(false);
  });
});
