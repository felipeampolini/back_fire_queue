import { describe, expect, it, vi } from 'vitest';
import type { NotificationMessage } from '../../src/shared/notification.js';
import { buildFcmPayload, createFcmSender } from '../../src/worker/fcm.js';

const baseMessage: NotificationMessage = {
  id: '7d0a3e2c-1b4f-4c8e-9a6d-2f5b8c1e0d3a',
  createdAt: '2026-11-02T20:00:00.000Z',
  target: { type: 'token', value: 'token-1' },
  notification: { title: 'Olá', body: 'Teste' },
  priority: 'high',
};

function firebaseError(code: string) {
  return Object.assign(new Error(`erro ${code}`), { code });
}

function fakeMessaging() {
  return {
    send: vi.fn().mockResolvedValue('projects/x/messages/1'),
    sendEachForMulticast: vi.fn(),
  };
}

describe('buildFcmPayload', () => {
  it('traduz prioridade alta para cada plataforma', () => {
    const payload = buildFcmPayload(baseMessage);

    expect(payload.android?.priority).toBe('high');
    expect(payload.apns?.headers?.['apns-priority']).toBe('10');
    expect(payload.webpush?.headers?.Urgency).toBe('high');
  });

  it('traduz prioridade normal para cada plataforma', () => {
    const payload = buildFcmPayload({ ...baseMessage, priority: 'normal' });

    expect(payload.android?.priority).toBe('normal');
    expect(payload.apns?.headers?.['apns-priority']).toBe('5');
    expect(payload.webpush?.headers?.Urgency).toBe('normal');
  });

  it('converte o TTL para a unidade de cada plataforma', () => {
    const now = Date.parse('2026-11-02T20:00:00.000Z');
    const payload = buildFcmPayload({ ...baseMessage, ttlSeconds: 3600 }, now);

    expect(payload.android?.ttl).toBe(3_600_000); // milissegundos
    expect(payload.webpush?.headers?.TTL).toBe('3600'); // segundos
    expect(payload.apns?.headers?.['apns-expiration']).toBe(String(now / 1000 + 3600)); // instante Unix
  });

  it('não define TTL quando não informado (o FCM usa o padrão de 4 semanas)', () => {
    const payload = buildFcmPayload(baseMessage);

    expect(payload.android?.ttl).toBeUndefined();
    expect(payload.apns?.headers).not.toHaveProperty('apns-expiration');
  });

  it('mensagem silenciosa usa content-available e prioridade 5 no iOS', () => {
    const payload = buildFcmPayload({
      ...baseMessage,
      notification: undefined,
      data: { sync: 'orders' },
    });

    expect(payload.notification).toBeUndefined();
    expect(payload.apns?.payload?.aps.contentAvailable).toBe(true);
    expect(payload.apns?.headers?.['apns-priority']).toBe('5');
  });
});

describe('createFcmSender', () => {
  it('envia para um token e reporta sucesso', async () => {
    const messaging = fakeMessaging();

    const result = await createFcmSender(messaging).send(baseMessage);

    expect(result).toEqual({ successCount: 1, failures: [] });
    expect(messaging.send).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'token-1', notification: baseMessage.notification }),
      false,
    );
  });

  it('envia para um tópico', async () => {
    const messaging = fakeMessaging();

    await createFcmSender(messaging).send({
      ...baseMessage,
      target: { type: 'topic', value: 'novidades' },
    });

    expect(messaging.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'novidades' }),
      false,
    );
  });

  it('repassa o modo dry run ao Firebase', async () => {
    const messaging = fakeMessaging();

    await createFcmSender(messaging, { dryRun: true }).send(baseMessage);

    expect(messaging.send).toHaveBeenCalledWith(expect.anything(), true);
  });

  it('devolve o código do erro do Firebase em vez de lançar exceção', async () => {
    const messaging = fakeMessaging();
    messaging.send.mockRejectedValue(firebaseError('messaging/registration-token-not-registered'));

    const result = await createFcmSender(messaging).send(baseMessage);

    expect(result).toEqual({
      successCount: 0,
      failures: [
        {
          token: 'token-1',
          code: 'messaging/registration-token-not-registered',
          message: expect.any(String),
        },
      ],
    });
  });

  it('em envio para vários tokens, reporta só os que falharam', async () => {
    const messaging = fakeMessaging();
    messaging.sendEachForMulticast.mockResolvedValue({
      successCount: 2,
      failureCount: 1,
      responses: [
        { success: true, messageId: '1' },
        { success: false, error: firebaseError('messaging/invalid-registration-token') },
        { success: true, messageId: '3' },
      ],
    });

    const result = await createFcmSender(messaging).send({
      ...baseMessage,
      target: { type: 'tokens', value: ['a', 'b', 'c'] },
    });

    expect(result.successCount).toBe(2);
    expect(result.failures).toEqual([
      { token: 'b', code: 'messaging/invalid-registration-token', message: expect.any(String) },
    ]);
  });

  it('se a chamada inteira falhar (ex.: rede), marca todos os tokens como falha', async () => {
    const messaging = fakeMessaging();
    messaging.sendEachForMulticast.mockRejectedValue(firebaseError('app/network-error'));

    const result = await createFcmSender(messaging).send({
      ...baseMessage,
      target: { type: 'tokens', value: ['a', 'b'] },
    });

    expect(result.successCount).toBe(0);
    expect(result.failures.map((f) => [f.token, f.code])).toEqual([
      ['a', 'app/network-error'],
      ['b', 'app/network-error'],
    ]);
  });
});
