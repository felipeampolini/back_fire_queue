// Página de teste: obtém o token deste navegador no Firebase e envia uma
// notificação para ele pela API, passando por fila → worker → Firebase.

const $ = (id) => document.getElementById(id);
const API_KEY_STORAGE = 'back_fire_queue.apiKey';

function setStatus(element, message, type = '') {
  element.textContent = message;
  element.className = `status ${type}`;
}

function readSavedApiKey() {
  try {
    return localStorage.getItem(API_KEY_STORAGE) ?? '';
  } catch {
    return ''; // armazenamento bloqueado (ex.: janela anônima)
  }
}

function saveApiKey(value) {
  try {
    localStorage.setItem(API_KEY_STORAGE, value);
  } catch {
    // sem problema: só não lembra a chave na próxima visita
  }
}

function addReceived(payload) {
  const list = $('received');
  if (list.querySelector('.muted')) list.innerHTML = '';

  const item = document.createElement('li');
  const time = new Date().toLocaleTimeString();
  const title = payload.notification?.title ?? '(mensagem silenciosa)';
  const strong = document.createElement('strong');
  strong.textContent = `${time} — ${title}`;
  item.append(strong);
  if (payload.notification?.body)
    item.append(document.createElement('br'), payload.notification.body);
  if (payload.data) {
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(payload.data, null, 2);
    item.append(pre);
  }
  list.prepend(item);
}

async function main() {
  const enableStatus = $('enable-status');
  $('api-key').value = readSavedApiKey();

  const response = await fetch('/test/config.json');
  const { firebaseConfig, vapidKey, sdkUrl } = await response.json();

  // SDK web do Firebase, carregado do CDN oficial
  const { initializeApp } = await import(`${sdkUrl}/firebase-app.js`);
  const { getMessaging, getToken, isSupported, onMessage } = await import(
    `${sdkUrl}/firebase-messaging.js`
  );

  if (!(await isSupported())) {
    setStatus(
      enableStatus,
      'Este navegador não suporta notificações push. No iPhone, adicione a página à Tela de Início.',
      'error',
    );
    $('enable').disabled = true;
    return;
  }

  const messaging = getMessaging(initializeApp(firebaseConfig));
  let registration;

  // Notificações que chegam com a página aberta e em foco: o navegador não
  // as exibe sozinho, então mostramos na lista e no sistema.
  onMessage(messaging, (payload) => {
    addReceived(payload);
    const title = payload.notification?.title ?? 'Mensagem silenciosa recebida';
    const body = payload.notification?.body ?? JSON.stringify(payload.data);
    registration?.showNotification(title, { body });
  });

  $('enable').addEventListener('click', async () => {
    try {
      setStatus(enableStatus, 'Pedindo permissão...');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(
          enableStatus,
          'Permissão negada. Libere as notificações nas configurações do site.',
          'error',
        );
        return;
      }

      // Service worker: recebe as notificações quando a página está em segundo plano
      registration = await navigator.serviceWorker.register('/test/firebase-messaging-sw.js', {
        scope: '/test/',
      });
      await navigator.serviceWorker.ready;

      const token = await getToken(messaging, {
        vapidKey,
        serviceWorkerRegistration: registration,
      });
      $('token').value = token;
      $('copy').disabled = false;
      $('send').disabled = false;
      setStatus(enableStatus, 'Pronto: este navegador já pode receber notificações.', 'ok');
    } catch (error) {
      console.error(error);
      setStatus(enableStatus, `Erro ao gerar o token: ${error.message}`, 'error');
    }
  });

  $('copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('token').value);
    setStatus(enableStatus, 'Token copiado.', 'ok');
  });

  $('send').addEventListener('click', async () => {
    const sendStatus = $('send-status');
    const apiKey = $('api-key').value.trim();
    saveApiKey(apiKey);

    const silent = $('silent').checked;
    const body = {
      target: { type: 'token', value: $('token').value },
      priority: $('priority').value,
      ...(silent
        ? { data: { origem: 'pagina-de-teste', enviadoEm: new Date().toISOString() } }
        : { notification: { title: $('title').value, body: $('body').value } }),
    };

    setStatus(sendStatus, 'Enviando...');
    try {
      const result = await fetch('/notifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify(body),
      });
      const json = await result.json();

      if (result.status === 202) {
        setStatus(
          sendStatus,
          `202 Accepted — na fila com id ${json.id}. Aguarde alguns segundos.`,
          'ok',
        );
      } else {
        const details = json.details?.map((d) => `${d.path}: ${d.message}`).join('; ');
        setStatus(
          sendStatus,
          `${result.status} — ${json.error}${details ? ` (${details})` : ''}`,
          'error',
        );
      }
    } catch (error) {
      setStatus(sendStatus, `Erro de rede: ${error.message}`, 'error');
    }
  });
}

main().catch((error) => {
  console.error(error);
  setStatus($('enable-status'), `Erro ao carregar a página: ${error.message}`, 'error');
});
