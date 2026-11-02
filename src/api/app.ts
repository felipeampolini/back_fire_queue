import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { Config, FirebaseWebConfig } from '../shared/config.js';
import type { NotificationPublisher } from '../shared/sqs.js';
import { errorHandler } from './errors.js';
import { notificationRoutes } from './routes/notifications.js';
import { testPageRoutes } from './routes/test-page.js';

type AppOptions = {
  logLevel: Config['logLevel'];
  apiKey: string;
  publisher: NotificationPublisher;
  // Sem a configuração web do Firebase, a página de teste (/test) não é publicada
  firebaseWeb?: FirebaseWebConfig;
};

// Cria e configura o app sem abrir porta: o server.ts sobe o servidor,
// e os testes usam app.inject() para simular requisições.
export function buildApp({ logLevel, apiKey, publisher, firebaseWeb }: AppOptions) {
  const app = Fastify({ logger: { level: logLevel } });

  // Faz o Fastify validar entradas e serializar respostas usando os schemas do Zod
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);

  // Documentação OpenAPI gerada a partir dos schemas das rotas
  app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'back_fire_queue',
        description: 'Fila de envio de notificações Firebase (FCM) com SQS',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/health', { schema: { tags: ['health'] } }, async () => ({ status: 'ok' }));
  app.register(notificationRoutes, { apiKey, publisher });
  if (firebaseWeb) app.register(testPageRoutes, { firebaseWeb });

  return app;
}
