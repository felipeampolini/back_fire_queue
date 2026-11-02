import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync } from 'fastify';
import type { FirebaseWebConfig } from '../../shared/config.js';

// Versão do SDK web do Firebase carregada do CDN oficial (gstatic).
// Usada pela página e pelo service worker: as duas precisam ser iguais.
const FIREBASE_JS_VERSION = '12.19.0';
const FIREBASE_CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_JS_VERSION}`;

// public/test fica na raiz do projeto (mesmo caminho relativo em src/ e em dist/)
const publicDir = fileURLToPath(new URL('../../../public/test', import.meta.url));

type TestPageOptions = { firebaseWeb: FirebaseWebConfig };

// Página para receber notificações no navegador: pede permissão, mostra o
// token do dispositivo e permite disparar uma notificação para ele mesmo.
export const testPageRoutes: FastifyPluginAsync<TestPageOptions> = async (app, { firebaseWeb }) => {
  const { vapidKey, ...firebaseConfig } = firebaseWeb;

  app.register(fastifyStatic, { root: publicDir, prefix: '/test/', decorateReply: false });
  app.get('/test', { schema: { hide: true } }, async (_request, reply) => reply.redirect('/test/'));

  // Configuração lida pela página (valores públicos)
  app.get('/test/config.json', { schema: { hide: true } }, async () => ({
    firebaseConfig,
    vapidKey,
    sdkUrl: FIREBASE_CDN,
  }));

  // Service worker: roda em segundo plano e exibe as notificações quando a
  // página não está em foco. Gerado aqui para receber a mesma configuração.
  app.get('/test/firebase-messaging-sw.js', { schema: { hide: true } }, async (_request, reply) => {
    reply.type('application/javascript').header('cache-control', 'no-cache');
    return `
importScripts('${FIREBASE_CDN}/firebase-app-compat.js');
importScripts('${FIREBASE_CDN}/firebase-messaging-compat.js');

firebase.initializeApp(${JSON.stringify(firebaseConfig)});
const messaging = firebase.messaging();

// Mensagens com "notification" são exibidas automaticamente pelo SDK.
// Mensagens silenciosas (só "data") não aparecem sozinhas: exibimos uma
// notificação para que o teste mostre que elas chegaram.
messaging.onBackgroundMessage((payload) => {
  if (!payload.notification) {
    self.registration.showNotification('Mensagem silenciosa recebida', {
      body: JSON.stringify(payload.data),
    });
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/test/'));
});
`;
  });
};
