import { pino } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationMessage } from '../../src/shared/notification.js';
import { isDeadToken, isRetryable } from '../../src/worker/classify.js';
import type { SendResult } from '../../src/worker/fcm.js';
import type { WorkerQueue } from '../../src/worker/queue.js';
import { createWorker, retryDelaySeconds } from '../../src/worker/worker.js';

const message: NotificationMessage = {
  id: '7d0a3e2c-1b4f-4c8e-9a6d-2f5b8c1e0d3a',
  createdAt: '2026-11-02T20:00:00.000Z',
  target: { type: 'token', value: 'token-1' },
  notification: { title: 'Olá', body: 'Teste' },
  priority: 'normal',
};

function received(body: unknown, receiveCount = 1) {
  return {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    receiptHandle: 'handle-1',
    receiveCount,
  };
}

// Imita o long polling: fica esperando até o stop() cancelar a leitura.
// (Um receive falso que devolvesse [] na hora deixaria o loop girando sem parar.)
function waitUntilAborted({ signal }: { signal: AbortSignal }) {
  return new Promise<never>((_, reject) =>
    signal.addEventListener('abort', () => reject(new Error('abort'))),
  );
}

function failure(code: string, token?: string) {
  return { token, code, message: code };
}

let queue: { [K in keyof WorkerQueue]: ReturnType<typeof vi.fn> };
let send: ReturnType<typeof vi.fn<(m: NotificationMessage) => Promise<SendResult>>>;

function worker(options = {}) {
  return createWorker({
    queue: queue as unknown as WorkerQueue,
    sender: { send },
    logger: pino({ level: 'silent' }),
    ...options,
  });
}

beforeEach(() => {
  queue = { receive: vi.fn(), delete: vi.fn(), requeue: vi.fn(), deadLetter: vi.fn() };
  send = vi.fn();
});

describe('classificação de erros do FCM', () => {
  it('não reenvia quando o problema é o token ou a mensagem', () => {
    expect(isRetryable('messaging/registration-token-not-registered')).toBe(false);
    expect(isRetryable('messaging/invalid-argument')).toBe(false);
    expect(isRetryable('messaging/payload-size-limit-exceeded')).toBe(false);
  });

  it('reenvia instabilidade, limite de envio, rede e erros desconhecidos', () => {
    expect(isRetryable('messaging/server-unavailable')).toBe(true);
    expect(isRetryable('messaging/internal-error')).toBe(true);
    expect(isRetryable('messaging/message-rate-exceeded')).toBe(true);
    expect(isRetryable('app/network-error')).toBe(true);
    expect(isRetryable('unknown')).toBe(true);
  });

  it('identifica tokens que devem ser removidos da base', () => {
    expect(isDeadToken('messaging/registration-token-not-registered')).toBe(true);
    expect(isDeadToken('messaging/server-unavailable')).toBe(false);
  });
});

describe('retryDelaySeconds (backoff exponencial)', () => {
  it('dobra a cada tentativa e respeita o limite de 15 minutos do SQS', () => {
    expect([1, 2, 3, 4].map((a) => retryDelaySeconds(a, 10))).toEqual([10, 20, 40, 80]);
    expect(retryDelaySeconds(20, 10)).toBe(900);
  });
});

describe('processMessage', () => {
  it('sucesso: apaga a mensagem da fila', async () => {
    send.mockResolvedValue({ successCount: 1, failures: [] });

    await worker().processMessage(received(message));

    expect(send).toHaveBeenCalledWith(message);
    expect(queue.delete).toHaveBeenCalledWith('handle-1');
    expect(queue.requeue).not.toHaveBeenCalled();
  });

  it('falha definitiva (token inválido): apaga e não reenvia', async () => {
    send.mockResolvedValue({
      successCount: 0,
      failures: [failure('messaging/registration-token-not-registered', 'token-1')],
    });

    await worker().processMessage(received(message));

    expect(queue.delete).toHaveBeenCalledWith('handle-1');
    expect(queue.requeue).not.toHaveBeenCalled();
    expect(queue.deadLetter).not.toHaveBeenCalled();
  });

  it('falha temporária: reenfileira com a próxima tentativa e atraso, e apaga a original', async () => {
    send.mockResolvedValue({
      successCount: 0,
      failures: [failure('messaging/server-unavailable', 'token-1')],
    });

    await worker({ retryBaseDelaySeconds: 10 }).processMessage(received(message));

    expect(queue.requeue).toHaveBeenCalledWith({ ...message, attempt: 2 }, 10);
    expect(queue.delete).toHaveBeenCalledWith('handle-1');
  });

  it('a original só é apagada depois que a nova foi gravada', async () => {
    send.mockResolvedValue({
      successCount: 0,
      failures: [failure('app/network-error', 'token-1')],
    });
    queue.requeue.mockRejectedValue(new Error('SQS fora do ar'));

    await expect(worker().processMessage(received(message))).rejects.toThrow();

    // Sem delete: a mensagem volta para a fila depois do visibility timeout
    expect(queue.delete).not.toHaveBeenCalled();
  });

  it('vários tokens com falha parcial: reenvia só para quem falhou por motivo temporário', async () => {
    const multi = { ...message, target: { type: 'tokens' as const, value: ['a', 'b', 'c'] } };
    send.mockResolvedValue({
      successCount: 1,
      failures: [
        failure('messaging/registration-token-not-registered', 'b'),
        failure('messaging/server-unavailable', 'c'),
      ],
    });

    await worker().processMessage(received(multi));

    expect(queue.requeue).toHaveBeenCalledWith(
      { ...multi, target: { type: 'tokens', value: ['c'] }, attempt: 2 },
      expect.any(Number),
    );
  });

  it('o atraso cresce a cada tentativa', async () => {
    send.mockResolvedValue({
      successCount: 0,
      failures: [failure('app/network-error', 'token-1')],
    });

    await worker({ retryBaseDelaySeconds: 10 }).processMessage(
      received({ ...message, attempt: 3 }),
    );

    expect(queue.requeue).toHaveBeenCalledWith({ ...message, attempt: 4 }, 40);
  });

  it('tentativas esgotadas: envia para a DLQ com o motivo e apaga da fila principal', async () => {
    send.mockResolvedValue({
      successCount: 0,
      failures: [failure('messaging/server-unavailable', 'token-1')],
    });

    await worker({ maxAttempts: 5 }).processMessage(received({ ...message, attempt: 5 }));

    expect(queue.requeue).not.toHaveBeenCalled();
    const [body, reason] = queue.deadLetter.mock.calls[0]!;
    expect(JSON.parse(body)).toEqual(message); // sem "attempt": se reprocessada, recomeça do zero
    expect(reason).toContain('messaging/server-unavailable');
    expect(queue.delete).toHaveBeenCalledWith('handle-1');
  });

  it('reentregas do SQS (ex.: worker caiu) contam como tentativa', async () => {
    send.mockResolvedValue({
      successCount: 0,
      failures: [failure('app/network-error', 'token-1')],
    });

    // 1ª tentativa pela API, mas o SQS já entregou 5 vezes: tentativas esgotadas
    await worker({ maxAttempts: 5 }).processMessage(received(message, 5));

    expect(queue.deadLetter).toHaveBeenCalled();
  });

  it('mensagem fora do contrato vai direto para a DLQ, sem tentar enviar', async () => {
    await worker().processMessage(received('isto não é json'));
    await worker().processMessage(received({ id: 'sem-o-resto' }));

    expect(send).not.toHaveBeenCalled();
    expect(queue.deadLetter).toHaveBeenCalledTimes(2);
    expect(queue.delete).toHaveBeenCalledTimes(2);
  });
});

describe('loop do worker', () => {
  it('processa o que recebe e para quando stop() é chamado', async () => {
    send.mockResolvedValue({ successCount: 1, failures: [] });
    queue.receive.mockResolvedValueOnce([received(message)]).mockImplementation(waitUntilAborted);

    const w = worker();
    const loop = w.start();
    await vi.waitFor(() => expect(queue.delete).toHaveBeenCalled());

    await w.stop();
    await expect(loop).resolves.toBeUndefined();
    expect(queue.receive).toHaveBeenCalledWith(expect.objectContaining({ maxMessages: 10 }));
  });

  it('continua funcionando se a leitura da fila falhar', async () => {
    send.mockResolvedValue({ successCount: 1, failures: [] });
    queue.receive
      .mockRejectedValueOnce(new Error('SQS fora do ar'))
      .mockResolvedValueOnce([received(message)])
      .mockImplementation(waitUntilAborted);

    const w = worker({ receiveErrorDelayMs: 1 });
    w.start();
    await vi.waitFor(() => expect(queue.delete).toHaveBeenCalled());
    await w.stop();
  });
});
