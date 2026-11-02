import { cert, initializeApp } from 'firebase-admin/app';
import { getMessaging, type BaseMessage, type Messaging } from 'firebase-admin/messaging';
import type { NotificationMessage } from '../shared/notification.js';

// Inicializa o Firebase Admin com a Service Account (arquivo JSON).
// Obs.: o aviso "deprecated" exibido na inicialização vem de dentro do
// firebase-admin (biblioteca de autenticação do Google), não deste código.
export function createMessaging(credentialsPath: string): Messaging {
  const app = initializeApp({ credential: cert(credentialsPath) });
  return getMessaging(app);
}

// Converte o contrato da fila nas opções do FCM. Cada plataforma tem o seu
// jeito de expressar prioridade e validade da mensagem.
export function buildFcmPayload(message: NotificationMessage, now = Date.now()): BaseMessage {
  const { notification, data, priority, ttlSeconds } = message;
  const high = priority === 'high';
  const silent = !notification; // só "data": nada aparece na tela
  const hasTtl = ttlSeconds !== undefined;

  return {
    notification,
    data,
    android: {
      priority,
      ...(hasTtl && { ttl: ttlSeconds * 1000 }), // Android usa milissegundos
    },
    apns: {
      headers: {
        // iOS: 10 = entrega imediata, 5 = econômica. Mensagem silenciosa exige 5.
        'apns-priority': high && !silent ? '10' : '5',
        // iOS: data/hora (em segundos Unix) a partir da qual a mensagem expira
        ...(hasTtl && { 'apns-expiration': String(Math.floor(now / 1000) + ttlSeconds) }),
      },
      // iOS: mensagem silenciosa precisa de content-available para acordar o app
      ...(silent && { payload: { aps: { contentAvailable: true } } }),
    },
    webpush: {
      headers: {
        Urgency: high ? 'high' : 'normal',
        ...(hasTtl && { TTL: String(ttlSeconds) }), // Web usa segundos
      },
    },
  };
}

export type SendFailure = {
  token?: string;
  code: string; // ex.: messaging/registration-token-not-registered
  message: string;
};

export type SendResult = {
  successCount: number;
  failures: SendFailure[];
};

// O worker depende desta interface: nos testes, basta um sender falso
export interface NotificationSender {
  send(message: NotificationMessage): Promise<SendResult>;
}

function toFailure(error: unknown, token?: string): SendFailure {
  const { code = 'unknown', message = String(error) } = (error ?? {}) as {
    code?: string;
    message?: string;
  };
  return { token, code, message };
}

type FcmClient = Pick<Messaging, 'send' | 'sendEachForMulticast'>;

// Envia para o FCM e devolve o resultado sem lançar erro: quem decide se
// vale tentar de novo é o worker (etapa 6), a partir do código de cada falha.
export function createFcmSender(messaging: FcmClient, { dryRun = false } = {}): NotificationSender {
  return {
    async send(message) {
      const payload = buildFcmPayload(message);
      const { target } = message;

      if (target.type === 'tokens') {
        try {
          const batch = await messaging.sendEachForMulticast(
            { ...payload, tokens: target.value },
            dryRun,
          );
          const failures = batch.responses.flatMap((response, i) =>
            response.success ? [] : [toFailure(response.error, target.value[i])],
          );
          return { successCount: batch.successCount, failures };
        } catch (error) {
          // Falha da chamada inteira (ex.: rede): todos os tokens falharam
          return { successCount: 0, failures: target.value.map((t) => toFailure(error, t)) };
        }
      }

      const destination =
        target.type === 'token' ? { token: target.value } : { topic: target.value };
      try {
        await messaging.send({ ...payload, ...destination }, dryRun);
        return { successCount: 1, failures: [] };
      } catch (error) {
        const token = target.type === 'token' ? target.value : undefined;
        return { successCount: 0, failures: [toFailure(error, token)] };
      }
    },
  };
}
