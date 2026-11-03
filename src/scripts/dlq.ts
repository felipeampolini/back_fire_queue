import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { loadConfig } from '../shared/config.js';
import { createSqsClient } from '../shared/sqs.js';

// Ferramentas da DLQ (fila de mensagens que esgotaram as tentativas):
//   list    → mostra o que está na DLQ e o motivo de cada mensagem (não remove nada)
//   redrive → devolve todas as mensagens para a fila principal, para nova tentativa
// Funcionam igual no ElasticMQ e no SQS da AWS.
const command = process.argv[2];
const config = loadConfig();
const sqs = createSqsClient(config.aws);
const { queueUrl, dlqUrl } = config.sqs;

async function receive(visibilityTimeout: number) {
  const result = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: dlqUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 1,
      VisibilityTimeout: visibilityTimeout,
      MessageAttributeNames: ['reason'],
    }),
  );
  return result.Messages ?? [];
}

function describe(body: string | undefined) {
  try {
    const message = JSON.parse(body ?? '');
    return `id=${message.id ?? '?'} destino=${message.target?.type ?? '?'}`;
  } catch {
    return `corpo inválido: ${body?.slice(0, 60)}`;
  }
}

async function list() {
  // Visibilidade 0: as mensagens são lidas e continuam disponíveis na DLQ
  const messages = await receive(0);
  if (messages.length === 0) {
    console.log('DLQ vazia');
    return;
  }
  for (const m of messages) {
    console.log(
      `- ${describe(m.Body)} | motivo: ${m.MessageAttributes?.reason?.StringValue ?? '-'}`,
    );
  }
  console.log(`(mostrando até 10 mensagens)`);
}

async function redrive() {
  // Só move o que já estava na DLQ quando o comando começou. Se uma mensagem
  // voltar para a DLQ durante o redrive (o problema continua), ela fica lá
  // em vez de ficar circulando entre as filas.
  const { Attributes } = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: dlqUrl,
      AttributeNames: ['ApproximateNumberOfMessages'],
    }),
  );
  const total = Number(Attributes?.ApproximateNumberOfMessages ?? 0);

  let moved = 0;
  // Visibilidade de 30s: enquanto uma mensagem é movida, ela não é lida de novo
  while (moved < total) {
    const batch = await receive(30);
    if (batch.length === 0) break;
    for (const m of batch.slice(0, total - moved)) {
      // Mesma regra do worker: grava na fila principal antes de apagar da DLQ
      await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: m.Body }));
      await sqs.send(
        new DeleteMessageCommand({ QueueUrl: dlqUrl, ReceiptHandle: m.ReceiptHandle }),
      );
      moved++;
    }
  }
  console.log(`${moved} mensagem(ns) devolvida(s) à fila principal`);
}

const commands: Record<string, () => Promise<void>> = { list, redrive };

if (!command || !commands[command]) {
  console.error('Uso: dlq.ts <list|redrive>');
  process.exit(1);
}

await commands[command]();
sqs.destroy();
