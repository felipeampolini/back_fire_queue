import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationMessageSchema } from '../../src/shared/notification.js';
import { buildTestApp, TEST_API_KEY } from '../helpers/app.js';

const publish = vi.fn();
const { app } = buildTestApp({ publish });

const validBody = {
  target: { type: 'token', value: 'device-token-123' },
  notification: { title: 'Olá', body: 'Sua notificação chegou' },
};

function post(body: unknown, headers: Record<string, string> = { 'x-api-key': TEST_API_KEY }) {
  return app.inject({ method: 'POST', url: '/notifications', payload: body as object, headers });
}

afterAll(async () => {
  await app.close();
});

describe('POST /notifications', () => {
  beforeEach(() => {
    publish.mockReset();
  });

  it('publica na fila e responde 202 com o id da notificação', async () => {
    const response = await post(validBody);

    expect(response.statusCode).toBe(202);
    const { id } = response.json();
    expect(publish).toHaveBeenCalledOnce();

    // A mensagem publicada segue o contrato da fila e tem o mesmo id da resposta
    const message = publish.mock.calls[0]![0];
    expect(notificationMessageSchema.parse(message)).toMatchObject({ ...validBody, id });
  });

  it('responde 401 sem API key e não publica nada', async () => {
    const response = await post(validBody, {});

    expect(response.statusCode).toBe(401);
    expect(publish).not.toHaveBeenCalled();
  });

  it('responde 401 com API key errada', async () => {
    const response = await post(validBody, { 'x-api-key': 'chave-errada' });

    expect(response.statusCode).toBe(401);
  });

  it('responde 400 com os detalhes quando o pedido é inválido', async () => {
    const response = await post({ target: { type: 'token', value: '' } });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Pedido inválido');
    expect(response.json().details.length).toBeGreaterThan(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it('responde 503 quando a fila está indisponível', async () => {
    publish.mockRejectedValueOnce(new Error('SQS fora do ar'));

    const response = await post(validBody);

    expect(response.statusCode).toBe(503);
  });
});

describe('Documentação', () => {
  it('expõe a especificação OpenAPI com a rota de notificações', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/json' });

    expect(response.statusCode).toBe(200);
    expect(response.json().paths).toHaveProperty('/notifications');
  });
});
