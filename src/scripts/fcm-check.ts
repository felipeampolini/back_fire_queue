import { loadConfig } from '../shared/config.js';
import { createMessaging } from '../worker/fcm.js';

// Valida a credencial do Firebase sem entregar nada a ninguém:
// envia uma mensagem em modo dry run (o FCM só valida) para um tópico.
const config = loadConfig();

if (!config.firebase.credentialsPath) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS não definida');
  process.exit(1);
}

try {
  const messaging = createMessaging(config.firebase.credentialsPath);
  const messageId = await messaging.send(
    { topic: 'fcm-check', notification: { title: 'fcm-check', body: 'dry run' } },
    true,
  );
  console.log(`Credencial do Firebase OK (dry run): ${messageId}`);
} catch (error) {
  const { code, message } = error as { code?: string; message?: string };
  console.error(`Falha ao validar a credencial do Firebase: ${code ?? ''} ${message ?? error}`);
  process.exit(1);
}
