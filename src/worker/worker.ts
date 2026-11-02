import { setTimeout as sleep } from 'node:timers/promises';
import type { Logger } from '../shared/logger.js';
import { notificationMessageSchema, type NotificationMessage } from '../shared/notification.js';
import { isDeadToken, isRetryable } from './classify.js';
import type { NotificationSender, SendFailure } from './fcm.js';
import type { ReceivedMessage, WorkerQueue } from './queue.js';

const MAX_DELAY_SECONDS = 900; // limite do DelaySeconds do SQS (15 minutos)

export type WorkerOptions = {
  queue: WorkerQueue;
  sender: NotificationSender;
  logger: Logger;
  batchSize?: number; // mensagens por leitura (o SQS permite até 10)
  maxAttempts?: number; // tentativas de envio antes de ir para a DLQ
  retryBaseDelaySeconds?: number; // atraso da 1ª retentativa; dobra a cada nova falha
  receiveErrorDelayMs?: number; // espera quando a própria leitura da fila falha
};

// Backoff exponencial: 10s, 20s, 40s, 80s... (limitado a 15 minutos)
export function retryDelaySeconds(attempt: number, baseSeconds: number) {
  return Math.min(baseSeconds * 2 ** (attempt - 1), MAX_DELAY_SECONDS);
}

// Nos logs, só o final do token: suficiente para rastrear, sem expor o token inteiro
function maskToken(token?: string) {
  return token ? `...${token.slice(-8)}` : undefined;
}

function parseMessage(body: string): NotificationMessage | undefined {
  try {
    const result = notificationMessageSchema.safeParse(JSON.parse(body));
    return result.success ? result.data : undefined;
  } catch {
    return undefined; // não é JSON
  }
}

// Na retentativa vão só os destinos que falharam por motivo temporário:
// quem já recebeu não recebe de novo.
function retryTarget(message: NotificationMessage, failures: SendFailure[]) {
  if (message.target.type !== 'tokens') return message.target;
  return { type: 'tokens' as const, value: failures.map((f) => f.token!) };
}

export function createWorker({
  queue,
  sender,
  logger,
  batchSize = 10,
  maxAttempts = 5,
  retryBaseDelaySeconds = 10,
  receiveErrorDelayMs = 5000,
}: WorkerOptions) {
  const controller = new AbortController();
  let running = false;
  let loop: Promise<void> | undefined;

  async function processMessage(received: ReceivedMessage) {
    const message = parseMessage(received.body);

    // Mensagem fora do contrato nunca vai dar certo: vai direto para a DLQ
    if (!message) {
      logger.error(
        { body: received.body.slice(0, 200) },
        'mensagem fora do contrato: enviada para a DLQ',
      );
      await queue.deadLetter(received.body, 'mensagem fora do contrato');
      await queue.delete(received.receiptHandle);
      return;
    }

    // Reentregas do SQS (worker caiu, timeout) também contam como tentativa
    const attempt = (message.attempt ?? 1) + received.receiveCount - 1;
    const log = logger.child({ notificationId: message.id, attempt });

    const result = await sender.send(message);
    const retryable = result.failures.filter((f) => isRetryable(f.code));
    const permanent = result.failures.filter((f) => !isRetryable(f.code));

    for (const failure of permanent) {
      log.warn(
        { token: maskToken(failure.token), code: failure.code },
        isDeadToken(failure.code)
          ? 'token inválido: deve ser removido da base'
          : 'falha definitiva: não será reenviada',
      );
    }

    if (retryable.length === 0) {
      log.info(
        { successCount: result.successCount, permanentFailures: permanent.length },
        'notificação processada',
      );
      await queue.delete(received.receiptHandle);
      return;
    }

    const codes = [...new Set(retryable.map((f) => f.code))];
    const target = retryTarget(message, retryable);

    if (attempt >= maxAttempts) {
      log.error({ codes, pending: retryable.length }, 'tentativas esgotadas: enviada para a DLQ');
      // Sem "attempt": se for reprocessada a partir da DLQ, recomeça do zero
      await queue.deadLetter(
        JSON.stringify({ ...message, target, attempt: undefined }),
        `tentativas esgotadas (${attempt}): ${codes.join(', ')}`,
      );
    } else {
      const delay = retryDelaySeconds(attempt, retryBaseDelaySeconds);
      log.warn(
        {
          codes,
          successCount: result.successCount,
          pending: retryable.length,
          retryInSeconds: delay,
        },
        'falha temporária: reenfileirada',
      );
      await queue.requeue({ ...message, target, attempt: attempt + 1 }, delay);
    }

    // A original só é apagada depois que a nova (ou a da DLQ) foi gravada.
    // Se algo falhar no meio, o pior caso é uma duplicata — nunca uma perda.
    await queue.delete(received.receiptHandle);
  }

  async function run() {
    while (running) {
      let messages: ReceivedMessage[];
      try {
        messages = await queue.receive({ maxMessages: batchSize, signal: controller.signal });
      } catch (err) {
        if (!running) break; // leitura cancelada pelo stop()
        logger.error({ err }, `falha ao ler a fila; nova tentativa em ${receiveErrorDelayMs}ms`);
        await sleep(receiveErrorDelayMs, undefined, { signal: controller.signal }).catch(() => {});
        continue;
      }

      // O lote é processado em paralelo; o erro de uma mensagem não afeta as outras.
      // Mensagem que deu erro inesperado não é apagada: volta à fila após o visibility timeout.
      const results = await Promise.allSettled(messages.map(processMessage));
      for (const r of results) {
        if (r.status === 'rejected') {
          logger.error({ err: r.reason }, 'erro ao processar mensagem; ela voltará para a fila');
        }
      }
    }
  }

  return {
    start() {
      running = true;
      loop = run();
      return loop;
    },
    // Para de ler a fila (cancela o long polling) e espera o lote em andamento terminar
    async stop() {
      running = false;
      controller.abort();
      await loop;
    },
    processMessage,
  };
}
